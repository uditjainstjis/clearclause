import { analyzeClause, classifyDocType, type Env } from './ai';
import { makeNonce, scanForInjection } from './guard';
import { redactPII } from './redact';
import { buildReport } from './risk';
import { normalizeDocument, segmentClauses } from './segment';
import type { AnalyzeEvent, Clause, ClauseAnalysis, DocType, RunStats } from './types';

/**
 * End-to-end analysis pipeline.
 *
 * Ordering is a security property, not a style choice: text is normalised,
 * then screened, then PII-stripped, and only then does any of it reach a
 * model. Nothing downstream can re-introduce raw input.
 *
 * Results are streamed as they complete rather than batched, so the reader sees
 * the first clause in about a second instead of waiting for the whole document.
 */

/**
 * Concurrent in-flight model calls.
 *
 * Measured, not guessed: at 6 a fifteen-clause agreement took 27.6s, at 10 it
 * takes 11.9s. Above 10 the gain flattens and the subrequest budget for a long
 * document starts to bind, so 10 is where it sits.
 */
const CONCURRENCY = 10;

/** Hard ceiling on input size. Rejected before any work is done. */
export const MAX_INPUT_CHARS = 120_000;
/** Clause ceiling, so one pathological document cannot exhaust the budget. */
export const MAX_CLAUSES = 80;

export class InputError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'InputError';
  }
}

/**
 * Validate raw user input.
 *
 * @throws InputError when the text is unusable, with a code the UI maps to a
 *   specific, actionable message.
 */
export function validateInput(text: unknown): string {
  if (typeof text !== 'string') throw new InputError('No document text was provided.', 'missing');
  const trimmed = text.trim();
  if (trimmed.length < 200) {
    throw new InputError(
      'That is too short to be a contract. Paste at least a few clauses (about 200 characters).',
      'too_short',
    );
  }
  if (trimmed.length > MAX_INPUT_CHARS) {
    throw new InputError(
      `That document is ${trimmed.length.toLocaleString()} characters. The limit is ${MAX_INPUT_CHARS.toLocaleString()} — try the section you care about.`,
      'too_long',
    );
  }
  return trimmed;
}

/**
 * Map over clauses with bounded concurrency, yielding each result the moment
 * it is ready.
 *
 * A worker pool rather than fixed-size batches: batching would idle on the
 * slowest clause in each batch, which for contracts (clause lengths vary by an
 * order of magnitude) is most of the time.
 */
async function* mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): AsyncGenerator<R> {
  const executing = new Map<number, Promise<{ slot: number; value: R }>>();
  let next = 0;

  const start = (slot: number): void => {
    const item = items[next];
    if (item === undefined) return;
    next++;
    executing.set(
      slot,
      fn(item).then((value) => ({ slot, value })),
    );
  };

  for (let slot = 0; slot < Math.min(limit, items.length); slot++) start(slot);

  while (executing.size > 0) {
    const { slot, value } = await Promise.race(executing.values());
    executing.delete(slot);
    yield value;
    if (next < items.length) start(slot);
  }
}

export interface AnalyzeOptions {
  docType?: DocType;
}

/**
 * Run the full pipeline, emitting events in stream order.
 *
 * @param env  Worker bindings
 * @param raw  untrusted document text from the client
 * @param opts caller-supplied overrides
 */
export async function* analyzeDocument(
  env: Env,
  raw: string,
  opts: AnalyzeOptions = {},
): AsyncGenerator<AnalyzeEvent> {
  const startedAt = Date.now();
  const normalized = normalizeDocument(raw);

  // Screen the document as the human sees it, before anything is stripped.
  const injectionFindings = scanForInjection(normalized);
  const { text: safeText, count: redactions } = redactPII(normalized);

  const allClauses = segmentClauses(safeText);
  const clauses: Clause[] = allClauses.slice(0, MAX_CLAUSES);
  if (clauses.length === 0) {
    yield {
      type: 'error',
      message: 'No readable clauses were found in that document.',
      code: 'no_clauses',
    };
    return;
  }

  const nonce = makeNonce();
  const docType = opts.docType ?? (await classifyDocType(env, safeText.slice(0, 3000), nonce));

  yield {
    type: 'meta',
    docType,
    clauseCount: clauses.length,
    guard: { injectionFindings, redactions },
  };

  const analyses: ClauseAnalysis[] = [];
  const stats: RunStats = {
    clauses: clauses.length,
    cacheHits: 0,
    modelCalls: 0,
    fallbackCalls: 0,
    elapsedMs: 0,
  };

  for await (const result of mapConcurrent(clauses, CONCURRENCY, (clause) =>
    analyzeClause(env, clause, docType, nonce),
  )) {
    if (result.fromCache) stats.cacheHits++;
    else stats.modelCalls++;
    if (result.usedFallback) stats.fallbackCalls++;
    analyses.push(result.analysis);
    yield { type: 'clause', analysis: result.analysis };
  }

  analyses.sort((a, b) => a.index - b.index);
  stats.elapsedMs = Date.now() - startedAt;
  yield { type: 'report', report: buildReport(analyses, docType), stats };
}
