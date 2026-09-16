import { cacheGet, cachePut, contentKey } from './cache';
import { verifyQuote } from './grounding';
import {
  buildClausePrompt,
  buildDocTypePrompt,
  CLAUSE_SCHEMA,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
} from '../prompts/clause';
import type { Clause, ClauseAnalysis, DocType, Obligation, RiskLevel } from './types';

/**
 * Workers AI client.
 *
 * Model selection was measured, not assumed (see README "Model selection"):
 * llama-4-scout returned schema-clean JSON in ~3s and graded a punitive lock-in
 * clause "high", where a larger model graded the same clause "medium". Speed
 * and calibration both favoured it, so it is primary; llama-3.3-70b is the
 * fallback for the case where the primary is unavailable or returns unusable
 * JSON. No API key exists anywhere in this project — inference is reached
 * through a Cloudflare binding, so there is no credential to leak.
 */

export const PRIMARY_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
export const FALLBACK_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Bindings this Worker requires. `AI` is the only external dependency. */
export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
  RATE_LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

const VALID_RISKS: readonly RiskLevel[] = ['high', 'medium', 'low', 'info'];
const VALID_WHO = new Set(['you', 'other-party', 'both']);

/**
 * Extract a JSON object from a model reply.
 *
 * Schema-constrained decoding is requested, but a fallback model under load can
 * still wrap its output in prose or a fenced code block. Recovering here costs
 * nothing and avoids discarding an otherwise good answer.
 */
export function extractJson(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if ('response' in obj) return extractJson(obj.response);
    // Any of the three schemas this project asks for, recognised by a field
    // unique to each: clause analysis, a question answer, a compared
    // difference. Without this an already-parsed reply would be thrown away.
    if ('risk' in obj || 'answered' in obj || 'direction' in obj) return obj;
    return null;
  }
  if (typeof raw !== 'string') return null;
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function asString(v: unknown, max = 600): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Coerce a raw model object into a validated analysis.
 *
 * Anything the model returns that is not in the schema is dropped, and every
 * quote is checked against the clause before it is allowed to carry weight.
 * A model reply is untrusted input like any other.
 */
export function coerceAnalysis(
  raw: Record<string, unknown>,
  clause: Clause,
  cached: boolean,
): ClauseAnalysis {
  const riskRaw = asString(raw.risk, 12).toLowerCase() as RiskLevel;
  const risk: RiskLevel = VALID_RISKS.includes(riskRaw) ? riskRaw : 'info';
  const quote = asString(raw.quote, 800);
  const { grounded } = verifyQuote(quote, clause.text);

  const obligations: Obligation[] = Array.isArray(raw.obligations)
    ? raw.obligations
        .slice(0, 8)
        .map((o): Obligation | null => {
          if (!o || typeof o !== 'object') return null;
          const rec = o as Record<string, unknown>;
          const what = asString(rec.what, 300);
          const oQuote = asString(rec.quote, 400);
          if (!what || !verifyQuote(oQuote, clause.text).grounded) return null;
          const who = asString(rec.who, 20);
          const when = asString(rec.when, 120);
          return {
            who: (VALID_WHO.has(who) ? who : 'you') as Obligation['who'],
            what,
            when: when || null,
            quote: oQuote,
          };
        })
        .filter((o): o is Obligation => o !== null)
    : [];

  return {
    index: clause.index,
    label: clause.label,
    heading: asString(raw.heading, 80) || 'Clause',
    plain: asString(raw.plain, 1200),
    // An ungrounded claim is never allowed to present as severe.
    risk: grounded ? risk : 'info',
    why: asString(raw.why, 600),
    ask: asString(raw.ask, 300),
    quote,
    obligations: grounded ? obligations : [],
    grounded,
    cached,
  };
}

interface RunResult {
  analysis: ClauseAnalysis;
  usedFallback: boolean;
  fromCache: boolean;
}

async function callModel(env: Env, model: string, clause: Clause, docType: DocType, nonce: string) {
  return env.AI.run(model, {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildClausePrompt(clause.text, docType, nonce) },
    ],
    response_format: { type: 'json_schema', json_schema: CLAUSE_SCHEMA },
    max_tokens: 900,
    temperature: 0.1,
  } as never);
}

/**
 * Analyse one clause, using cache then primary model then fallback model.
 *
 * @param env     Worker bindings
 * @param clause  the clause to analyse (PII already redacted)
 * @param docType document archetype
 * @param nonce   per-request fence delimiter
 */
export async function analyzeClause(
  env: Env,
  clause: Clause,
  docType: DocType,
  nonce: string,
): Promise<RunResult> {
  const key = await contentKey([clause.text, docType, PROMPT_VERSION, PRIMARY_MODEL]);
  const hit = await cacheGet<Record<string, unknown>>(key);
  if (hit) {
    return { analysis: coerceAnalysis(hit, clause, true), usedFallback: false, fromCache: true };
  }

  for (const [i, model] of [PRIMARY_MODEL, FALLBACK_MODEL].entries()) {
    try {
      const raw = await callModel(env, model, clause, docType, nonce);
      const obj = extractJson(raw);
      if (!obj) continue;
      const analysis = coerceAnalysis(obj, clause, false);
      // Only cache answers that grounded — a bad answer should not be durable.
      if (analysis.grounded) await cachePut(key, obj);
      return { analysis, usedFallback: i > 0, fromCache: false };
    } catch {
      continue;
    }
  }

  // Both models failed. Degrade to a truthful placeholder rather than an error:
  // one unreadable clause must not discard the rest of the document.
  return {
    analysis: {
      index: clause.index,
      label: clause.label,
      heading: 'Could not be analysed',
      plain: 'This clause could not be analysed automatically. Please read it yourself.',
      risk: 'info',
      why: '',
      ask: '',
      quote: '',
      obligations: [],
      grounded: false,
      cached: false,
    },
    usedFallback: true,
    fromCache: false,
  };
}

const DOC_TYPES: readonly DocType[] = [
  'rental',
  'employment',
  'loan',
  'service',
  'nda',
  'terms',
  'other',
];

/** Classify the document with a single cheap call over a leading sample. */
export async function classifyDocType(env: Env, sample: string, nonce: string): Promise<DocType> {
  try {
    const res = (await env.AI.run(
      PRIMARY_MODEL as Parameters<Ai['run']>[0],
      {
        messages: [{ role: 'user', content: buildDocTypePrompt(sample.slice(0, 3000), nonce) }],
        max_tokens: 10,
        temperature: 0,
      } as never,
    )) as { response?: unknown };
    const word = typeof res.response === 'string' ? res.response.toLowerCase().trim() : '';
    return DOC_TYPES.find((t) => word.includes(t)) ?? 'other';
  } catch {
    return 'other';
  }
}
