import { extractJson, FALLBACK_MODEL, PRIMARY_MODEL, type Env } from './ai';
import { alignClauses, type AlignedPair } from './align';
import { cacheGet, cachePut, contentKey } from './cache';
import { mapConcurrent } from './concurrent';
import { verifyQuote } from './grounding';
import { makeNonce, scanForInjection } from './guard';
import { InputError, MAX_CLAUSES, validateInput } from './pipeline';
import { redactPII } from './redact';
import { normalizeDocument, segmentClauses } from './segment';
import {
  buildComparePrompt,
  buildOneSidedPrompt,
  COMPARE_PROMPT_VERSION,
  COMPARE_SCHEMA,
  COMPARE_SYSTEM_PROMPT,
} from '../prompts/compare';
import type {
  ChangeDirection,
  Clause,
  ClauseDifference,
  ComparisonReport,
  RunStats,
} from './types';

/**
 * Compare two versions of an agreement.
 *
 * The division of labour is the point. Which clause corresponds to which is
 * decided deterministically in {@link alignClauses}. Whether a matched pair
 * differs at all is a string comparison. Which document treats the reader
 * better is arithmetic over the results, done in {@link summarise}. The model
 * is asked exactly one question, once per genuine difference: what changed here
 * and which way does it cut?
 *
 * That keeps the expensive part proportional to how much actually changed
 * rather than to document length — two eighty-clause drafts differing in three
 * places cost three model calls — and it keeps the headline verdict reproducible,
 * because no model votes on it.
 */

/** Concurrent in-flight model calls. Matches the analysis pipeline. */
const CONCURRENCY = 10;
/** Ceiling on explained differences, so two wholly unrelated documents cannot
 *  turn into eighty model calls. Beyond this the documents are not two drafts
 *  of one agreement, and the report says so. */
export const MAX_DIFFERENCES = 40;

const VALID_DIRECTIONS: readonly ChangeDirection[] = [
  'better-for-you',
  'worse-for-you',
  'no-material-change',
];

function asString(v: unknown, max = 600): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** One unit of work: either an aligned pair that differs, or a one-sided clause. */
type DiffTask =
  | { kind: 'changed'; a: Clause; b: Clause; similarity: number }
  | { kind: 'only-in-a'; clause: Clause }
  | { kind: 'only-in-b'; clause: Clause };

/**
 * Turn a model reply into a difference, enforcing grounding on both sides.
 *
 * Each quote is checked against its own source clause — `quoteA` against the
 * old text, `quoteB` against the new. A difference whose quotes do not verify
 * keeps its summary but is marked ungrounded and forced to
 * `no-material-change`, so an unverifiable claim can never move the verdict.
 */
export function coerceDifference(raw: Record<string, unknown>, task: DiffTask): ClauseDifference {
  const textA =
    task.kind === 'only-in-b' ? '' : task.kind === 'changed' ? task.a.text : task.clause.text;
  const textB =
    task.kind === 'only-in-a' ? '' : task.kind === 'changed' ? task.b.text : task.clause.text;

  const quoteA = asString(raw.quoteA, 600);
  const quoteB = asString(raw.quoteB, 600);

  // A side with no text needs no quote; a side with text must produce one that
  // verifies. Both conditions are checked here rather than trusted.
  const okA = textA === '' ? quoteA === '' : verifyQuote(quoteA, textA).grounded;
  const okB = textB === '' ? quoteB === '' : verifyQuote(quoteB, textB).grounded;
  const grounded = okA && okB;

  const rawDirection = asString(raw.direction, 24) as ChangeDirection;
  const direction: ChangeDirection =
    grounded && VALID_DIRECTIONS.includes(rawDirection) ? rawDirection : 'no-material-change';

  return {
    heading: asString(raw.heading, 80) || 'Changed term',
    kind: task.kind,
    direction,
    summary: asString(raw.summary, 800),
    quoteA: grounded ? quoteA : '',
    quoteB: grounded ? quoteB : '',
    indexA:
      task.kind === 'only-in-b' ? null : task.kind === 'changed' ? task.a.index : task.clause.index,
    indexB:
      task.kind === 'only-in-a' ? null : task.kind === 'changed' ? task.b.index : task.clause.index,
    similarity: task.kind === 'changed' ? task.similarity : 0,
    grounded,
  };
}

/**
 * Count the verdict.
 *
 * Deliberately pure arithmetic over grounded differences: the same two
 * documents always produce the same headline, and no single fluent explanation
 * can swing it. A cosmetic difference counts for nothing, which is why
 * `no-material-change` is offered so readily in the prompt.
 */
export function summarise(differences: readonly ClauseDifference[]): {
  counts: Record<ChangeDirection, number>;
  favours: 'a' | 'b' | null;
} {
  const counts: Record<ChangeDirection, number> = {
    'better-for-you': 0,
    'worse-for-you': 0,
    'no-material-change': 0,
  };
  for (const d of differences) {
    if (d.grounded || d.direction === 'no-material-change') counts[d.direction]++;
  }
  const better = counts['better-for-you'];
  const worse = counts['worse-for-you'];
  // `direction` describes moving from A to B, so a majority of changes that are
  // worse for the reader means the OLDER document treated them better.
  const favours = worse > better ? 'a' : better > worse ? 'b' : null;
  return { counts, favours };
}

async function callCompareModel(
  env: Env,
  model: string,
  task: DiffTask,
  labelA: string,
  labelB: string,
  nonce: string,
): Promise<unknown> {
  const user =
    task.kind === 'changed'
      ? buildComparePrompt(task.a.text, task.b.text, labelA, labelB, nonce)
      : buildOneSidedPrompt(
          task.clause.text,
          task.kind === 'only-in-a' ? 'old' : 'new',
          labelA,
          labelB,
          nonce,
        );

  return env.AI.run(model, {
    messages: [
      { role: 'system', content: COMPARE_SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_schema', json_schema: COMPARE_SCHEMA },
    max_tokens: 700,
    temperature: 0.1,
  } as never);
}

interface TaskResult {
  difference: ClauseDifference;
  usedFallback: boolean;
  fromCache: boolean;
}

async function explainTask(
  env: Env,
  task: DiffTask,
  labelA: string,
  labelB: string,
  nonce: string,
): Promise<TaskResult> {
  const parts =
    task.kind === 'changed' ? [task.a.text, task.b.text] : [task.clause.text, task.kind];
  const key = await contentKey([...parts, COMPARE_PROMPT_VERSION, PRIMARY_MODEL]);

  const hit = await cacheGet<Record<string, unknown>>(key);
  if (hit) {
    return { difference: coerceDifference(hit, task), usedFallback: false, fromCache: true };
  }

  for (const [i, model] of [PRIMARY_MODEL, FALLBACK_MODEL].entries()) {
    try {
      const raw = await callCompareModel(env, model, task, labelA, labelB, nonce);
      const obj = extractJson(raw);
      if (!obj) continue;
      const difference = coerceDifference(obj, task);
      if (difference.grounded) await cachePut(key, obj);
      return { difference, usedFallback: i > 0, fromCache: false };
    } catch {
      continue;
    }
  }

  // Both models failed on this one difference. Report it as present but
  // unexplained rather than discarding it — the reader still needs to know the
  // clause changed.
  return {
    difference: {
      heading: 'Changed term',
      kind: task.kind,
      direction: 'no-material-change',
      summary:
        'This term differs between the two documents, but the change could not be explained automatically. Please read both versions yourself.',
      quoteA: '',
      quoteB: '',
      indexA:
        task.kind === 'only-in-b'
          ? null
          : task.kind === 'changed'
            ? task.a.index
            : task.clause.index,
      indexB:
        task.kind === 'only-in-a'
          ? null
          : task.kind === 'changed'
            ? task.b.index
            : task.clause.index,
      similarity: task.kind === 'changed' ? task.similarity : 0,
      grounded: false,
    },
    usedFallback: true,
    fromCache: false,
  };
}

export interface CompareOptions {
  labelA?: string | undefined;
  labelB?: string | undefined;
}

function cleanLabel(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  return trimmed || fallback;
}

/**
 * Compare two documents and explain what changed.
 *
 * @param env  Worker bindings
 * @param rawA untrusted text of the older document
 * @param rawB untrusted text of the newer document
 * @param opts display labels for each side
 * @throws InputError when either document is unusable
 */
export async function compareDocuments(
  env: Env,
  rawA: string,
  rawB: string,
  opts: CompareOptions = {},
): Promise<ComparisonReport> {
  const startedAt = Date.now();
  let textA: string;
  let textB: string;
  try {
    textA = validateInput(rawA);
  } catch (err) {
    const e = err as InputError;
    throw new InputError(`First document: ${e.message}`, e.code);
  }
  try {
    textB = validateInput(rawB);
  } catch (err) {
    const e = err as InputError;
    throw new InputError(`Second document: ${e.message}`, e.code);
  }

  const labelA = cleanLabel(opts.labelA, 'Version A');
  const labelB = cleanLabel(opts.labelB, 'Version B');

  const normA = normalizeDocument(textA);
  const normB = normalizeDocument(textB);

  // Same ordering as every other entry point: screen before redacting, redact
  // before anything reaches a model.
  const injectionFindings = [
    ...scanForInjection(normA).map((f) => ({ ...f, detail: `${f.detail} (in ${labelA})` })),
    ...scanForInjection(normB).map((f) => ({ ...f, detail: `${f.detail} (in ${labelB})` })),
  ];
  const { text: safeA, count: redactionsA } = redactPII(normA);
  const { text: safeB, count: redactionsB } = redactPII(normB);

  const clausesA = segmentClauses(safeA).slice(0, MAX_CLAUSES);
  const clausesB = segmentClauses(safeB).slice(0, MAX_CLAUSES);
  const guard = { injectionFindings, redactions: redactionsA + redactionsB };

  const stats: RunStats = {
    clauses: clausesA.length + clausesB.length,
    cacheHits: 0,
    modelCalls: 0,
    fallbackCalls: 0,
    elapsedMs: 0,
    concurrency: CONCURRENCY,
  };

  if (clausesA.length === 0 || clausesB.length === 0) {
    throw new InputError('No readable clauses were found in one of those documents.', 'no_clauses');
  }

  const { pairs, onlyInA, onlyInB } = alignClauses(clausesA, clausesB);
  const changed: AlignedPair[] = pairs.filter((p) => !p.identical);
  const unchangedCount = pairs.length - changed.length;

  const tasks: DiffTask[] = [
    ...changed.map((p): DiffTask => ({
      kind: 'changed',
      a: p.a,
      b: p.b,
      similarity: p.similarity,
    })),
    ...onlyInA.map((clause): DiffTask => ({ kind: 'only-in-a', clause })),
    ...onlyInB.map((clause): DiffTask => ({ kind: 'only-in-b', clause })),
  ].slice(0, MAX_DIFFERENCES);

  const nonce = makeNonce();
  const differences: ClauseDifference[] = [];

  for await (const result of mapConcurrent(tasks, CONCURRENCY, (task) =>
    explainTask(env, task, labelA, labelB, nonce),
  )) {
    if (result.fromCache) stats.cacheHits++;
    else stats.modelCalls++;
    if (result.usedFallback) stats.fallbackCalls++;
    differences.push(result.difference);
  }

  // Present in document order, worse-for-the-reader first within that: the
  // thing a reader most needs to see should not be buried at clause 40.
  const rank: Record<ChangeDirection, number> = {
    'worse-for-you': 0,
    'better-for-you': 1,
    'no-material-change': 2,
  };
  differences.sort(
    (x, y) =>
      rank[x.direction] - rank[y.direction] ||
      (x.indexA ?? x.indexB ?? 0) - (y.indexA ?? y.indexB ?? 0),
  );

  const { counts, favours } = summarise(differences);
  stats.elapsedMs = Date.now() - startedAt;

  return {
    labelA,
    labelB,
    differences,
    counts,
    favours,
    clauseCountA: clausesA.length,
    clauseCountB: clausesB.length,
    unchangedCount,
    guard,
    stats,
  };
}
