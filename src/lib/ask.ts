import { cacheGet, cachePut, contentKey } from './cache';
import { extractJson, FALLBACK_MODEL, PRIMARY_MODEL, type Env } from './ai';
import { salvageQuote } from './grounding';
import { makeNonce, scanForInjection } from './guard';
import { InputError, MAX_CLAUSES, validateInput } from './pipeline';
import { redactPII } from './redact';
import { retrieveClauses } from './retrieve';
import { normalizeDocument, segmentClauses } from './segment';
import { ASK_PROMPT_VERSION, ASK_SCHEMA, ASK_SYSTEM_PROMPT, buildAskPrompt } from '../prompts/ask';
import type { AnswerCitation, Clause, ConsultedClause, DocumentAnswer } from './types';

/**
 * Question-answering over a supplied document.
 *
 * The pipeline is the analysis pipeline's shape, and its ordering is a security
 * property for the same reason: normalise, screen for injection, redact, and
 * only then segment and retrieve. The question travels the same path as the
 * document — it is screened and redacted too, because a question is untrusted
 * text arriving from the network exactly like a contract is.
 *
 * What makes this answer trustworthy is not the prompt. It is that the model's
 * citation is checked here, in code, against the clause it claims to come from.
 * A model that cannot produce a verifiable quote does not get to claim it
 * answered: {@link groundAnswer} rewrites the result to "not addressed". That
 * inversion — silence is a valid answer, an unverifiable citation is not — is
 * the whole design.
 */

const MIN_QUESTION_CHARS = 8;
const MAX_QUESTION_CHARS = 400;

/**
 * Validate a question.
 *
 * @throws InputError with a code the UI maps to a specific message
 */
export function validateQuestion(question: unknown): string {
  if (typeof question !== 'string') {
    throw new InputError('No question was provided.', 'missing_question');
  }
  const trimmed = question.trim().replace(/\s+/g, ' ');
  if (trimmed.length < MIN_QUESTION_CHARS) {
    throw new InputError(
      'That question is too short. Ask in a full sentence, for example "how much notice must I give?"',
      'question_too_short',
    );
  }
  if (trimmed.length > MAX_QUESTION_CHARS) {
    throw new InputError(
      `That question is ${trimmed.length} characters. Keep it under ${MAX_QUESTION_CHARS}.`,
      'question_too_long',
    );
  }
  return trimmed;
}

/** The answer returned when nothing in the document addresses the question. */
function notAddressed(
  question: string,
  reason: string,
): Pick<DocumentAnswer, 'question' | 'answered' | 'answer' | 'citation'> {
  return { question, answered: false, answer: reason, citation: null };
}

/**
 * Enforce grounding on a model reply.
 *
 * An answer is allowed to stand only if its quote is verbatim in the clause it
 * cites. Everything else — a missing quote, a paraphrased one, a citation to a
 * clause that was never supplied — collapses to "not addressed". The model's
 * own `answered` flag is advisory; this is the decision.
 */
export function groundAnswer(
  raw: Record<string, unknown>,
  question: string,
  consulted: readonly Clause[],
): Pick<DocumentAnswer, 'question' | 'answered' | 'answer' | 'citation'> {
  const answer = typeof raw.answer === 'string' ? raw.answer.trim().slice(0, 1200) : '';
  // The schema asks for the string "yes"/"no" rather than a boolean, for the
  // decoder reasons set out in prompts/ask.ts. A real boolean is still accepted
  // so a model that ignores the schema and does the obvious thing still works.
  const claimed = raw.answered === true || raw.answered === 'yes';
  const quote = typeof raw.quote === 'string' ? raw.quote.trim().slice(0, 800) : '';

  if (!claimed || !quote) {
    return notAddressed(
      question,
      answer || 'This document does not appear to address that question.',
    );
  }

  // Prefer the clause the model cited, but accept the quote if it is verbatim
  // in any clause that was supplied: a correct quote attributed to the wrong
  // index is a citation error, not a hallucination, and the user is shown the
  // clause the words actually came from.
  const citedIndex = Number(raw.clauseIndex);
  const cited = consulted.find((c) => c.index === citedIndex);
  const ordered = cited ? [cited, ...consulted.filter((c) => c !== cited)] : consulted;

  for (const clause of ordered) {
    // salvageQuote returns the quote unchanged when it already verifies, and
    // otherwise the longest run of its sentences that does — which rescues the
    // common case of a model appending its reasoning to an otherwise perfect
    // citation. Anything it returns has passed verbatim verification.
    const verified = salvageQuote(quote, clause.text);
    if (verified) {
      const citation: AnswerCitation = {
        clauseIndex: clause.index,
        label: clause.label,
        quote: verified,
        clauseText: clause.text,
      };
      return { question, answered: true, answer, citation };
    }
  }

  // The model answered but could not point at the document. Say so plainly
  // rather than showing an unsupported answer.
  return notAddressed(
    question,
    'The document does not clearly answer that. Nothing in the clauses searched states it directly, so it is worth putting to the other party or to a lawyer.',
  );
}

async function callAskModel(
  env: Env,
  model: string,
  question: string,
  clauses: readonly Clause[],
  nonce: string,
): Promise<unknown> {
  return env.AI.run(model, {
    messages: [
      { role: 'system', content: ASK_SYSTEM_PROMPT },
      { role: 'user', content: buildAskPrompt(question, clauses, nonce) },
    ],
    response_format: { type: 'json_schema', json_schema: ASK_SCHEMA },
    // Generous, because the reply has to carry a verbatim quote and contract
    // clauses are long. Measured 2026-09-17 against the shipped rental sample:
    // at 700 the reply was truncated mid-JSON for every question whose answer
    // lived in a long clause — repainting, lock-in, alterations — and arrived
    // as unparseable output that looked, from the outside, exactly like a model
    // refusing to answer. Only questions answered by short clauses worked.
    max_tokens: 1600,
    temperature: 0,
  } as never);
}

/**
 * Answer a question about a document.
 *
 * @param env      Worker bindings
 * @param rawDoc   untrusted document text from the client
 * @param rawQuestion untrusted question text from the client
 * @throws InputError when either input is unusable
 */
export async function answerQuestion(
  env: Env,
  rawDoc: string,
  rawQuestion: string,
): Promise<DocumentAnswer> {
  const startedAt = Date.now();
  const text = validateInput(rawDoc);
  const question = validateQuestion(rawQuestion);

  const normalized = normalizeDocument(text);

  // Screen the document and the question together: an injection attempt in
  // either one is the same class of event and is reported the same way.
  const injectionFindings = [
    ...scanForInjection(normalized),
    ...scanForInjection(question).map((f) => ({
      ...f,
      detail: `${f.detail} (found in the question, not the document)`,
    })),
  ];

  const { text: safeDoc, count: docRedactions } = redactPII(normalized);
  const { text: safeQuestion, count: questionRedactions } = redactPII(question);

  const clauses = segmentClauses(safeDoc).slice(0, MAX_CLAUSES);
  const guard = { injectionFindings, redactions: docRedactions + questionRedactions };
  const baseStats = {
    clausesSearched: clauses.length,
    clausesConsulted: 0,
    modelCalls: 0,
    fallbackCalls: 0,
    elapsedMs: 0,
    cached: false,
  };

  const retrieved = retrieveClauses(safeQuestion, clauses);
  const consulted: ConsultedClause[] = retrieved.map((r) => ({
    index: r.clause.index,
    label: r.clause.label,
    matched: r.matched,
  }));

  // Nothing in the document shares vocabulary with the question. Answering that
  // deterministically costs no inference and is more honest than asking a model
  // to look at three irrelevant clauses.
  if (retrieved.length === 0) {
    return {
      ...notAddressed(
        safeQuestion,
        'No clause in this document mentions anything from that question. It may simply not be covered — which is itself worth knowing before you sign.',
      ),
      consulted,
      guard,
      stats: { ...baseStats, elapsedMs: Date.now() - startedAt },
    };
  }

  const clauseTexts = retrieved.map((r) => r.clause);
  const key = await contentKey([
    safeQuestion.toLowerCase(),
    ...clauseTexts.map((c) => c.text),
    ASK_PROMPT_VERSION,
    PRIMARY_MODEL,
  ]);

  const hit = await cacheGet<Record<string, unknown>>(key);
  if (hit) {
    return {
      ...groundAnswer(hit, safeQuestion, clauseTexts),
      consulted,
      guard,
      stats: {
        ...baseStats,
        clausesConsulted: clauseTexts.length,
        cached: true,
        elapsedMs: Date.now() - startedAt,
      },
    };
  }

  const nonce = makeNonce();
  const stats = { ...baseStats, clausesConsulted: clauseTexts.length };

  /**
   * Best result seen so far.
   *
   * A model that claims an answer but paraphrases its quote fails grounding,
   * and that is the single most common failure here — measured against the
   * shipped rental sample, where "who pays for repainting?" is plainly answered
   * by clause 7 and was refused because the quote came back reworded. Returning
   * the primary's refusal in that case throws away a question the document
   * genuinely answers, so the fallback gets a turn before we give up. Its
   * ungrounded reply is kept only as the thing to return if it also fails.
   */
  let best: ReturnType<typeof groundAnswer> | null = null;

  for (const [i, model] of [PRIMARY_MODEL, FALLBACK_MODEL].entries()) {
    try {
      const raw = await callAskModel(env, model, safeQuestion, clauseTexts, nonce);
      const obj = extractJson(raw);
      if (!obj) continue;
      stats.modelCalls++;
      if (i > 0) stats.fallbackCalls++;
      const grounded = groundAnswer(obj, safeQuestion, clauseTexts);

      if (grounded.answered) {
        // Only a grounded answer is durable. Caching a refusal would freeze a
        // transient model failure into a permanent "not addressed".
        await cachePut(key, obj);
        return {
          ...grounded,
          consulted,
          guard,
          stats: { ...stats, elapsedMs: Date.now() - startedAt },
        };
      }
      // A model that says the document is silent is more informative than one
      // whose citation merely failed to verify, so prefer the former.
      if (best === null || (obj.answered !== true && obj.answered !== 'yes')) best = grounded;
    } catch {
      continue;
    }
  }

  if (best !== null) {
    return {
      ...best,
      consulted,
      guard,
      stats: { ...stats, elapsedMs: Date.now() - startedAt },
    };
  }

  return {
    ...notAddressed(
      safeQuestion,
      'That question could not be answered just now. Please try again in a moment.',
    ),
    consulted,
    guard,
    stats: { ...stats, fallbackCalls: 1, elapsedMs: Date.now() - startedAt },
  };
}
