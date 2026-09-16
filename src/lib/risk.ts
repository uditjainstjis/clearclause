import { findInconsistencies } from './consistency';
import { buildNextSteps, whereToGetHelp } from './nextsteps';
import type {
  Clause,
  ClauseAnalysis,
  DocType,
  DocumentReport,
  Obligation,
  RiskLevel,
} from './types';

/**
 * Aggregation of per-clause analyses into a document-level report.
 *
 * Every function here is pure and deterministic. Aggregation is deliberately
 * *not* delegated to the model: a number the user is asked to act on should be
 * reproducible and explainable, and a second generative pass would make it
 * neither. See ADR-0004.
 */

/**
 * Relative attention weight per severity.
 *
 * `low` weighs zero, deliberately. "Low" means ordinary and expected for this
 * kind of agreement — a duty worth knowing about, not a term worth worrying
 * about. Giving it weight made the score a function of document length: a long,
 * entirely fair contract accumulated more points than a short predatory one,
 * which is the opposite of what the number is for. Only terms that actually
 * need attention move it.
 */
export const RISK_WEIGHT: Record<RiskLevel, number> = {
  high: 10,
  medium: 4,
  low: 0,
  info: 0,
};

/**
 * Saturation constant for the attention score.
 *
 * Chosen so one high-risk clause lands near 29/100 and three near 55/100:
 * a single bad term is worth noticing, several compound, and no document can
 * reach 100 — there is always something a reader could still check.
 */
const SATURATION = 25;

/**
 * Score how much of a document needs the reader's attention, 0-100.
 *
 * Only grounded findings count, so an unverifiable model claim can never
 * inflate the headline number.
 */
export function attentionScore(analyses: readonly ClauseAnalysis[]): number {
  const raw = analyses.filter((a) => a.grounded).reduce((sum, a) => sum + RISK_WEIGHT[a.risk], 0);
  if (raw === 0) return 0;
  return Math.round((100 * raw) / (raw + SATURATION));
}

/** Count clauses at each severity. */
export function countByRisk(analyses: readonly ClauseAnalysis[]): Record<RiskLevel, number> {
  const counts: Record<RiskLevel, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const a of analyses) counts[a.risk]++;
  return counts;
}

/**
 * Order clauses by what deserves attention first.
 *
 * Ties break on document order so the result is stable and the reader can
 * follow the ordering without it appearing arbitrary.
 */
export function readFirst(analyses: readonly ClauseAnalysis[], limit = 5): number[] {
  return [...analyses]
    .filter((a) => a.grounded && RISK_WEIGHT[a.risk] > 0)
    .sort((a, b) => RISK_WEIGHT[b.risk] - RISK_WEIGHT[a.risk] || a.index - b.index)
    .slice(0, limit)
    .map((a) => a.index);
}

/** Normalise a sentence for near-duplicate detection. */
function dedupeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Collect obligations across clauses, dropping ungrounded and duplicate entries. */
export function collectObligations(analyses: readonly ClauseAnalysis[]): Obligation[] {
  const seen = new Set<string>();
  const out: Obligation[] = [];
  for (const a of analyses) {
    if (!a.grounded) continue;
    for (const ob of a.obligations) {
      const key = `${ob.who}|${dedupeKey(ob.what)}`;
      if (seen.has(key) || !ob.what.trim()) continue;
      seen.add(key);
      out.push(ob);
    }
  }
  // Dated obligations first — those are the ones a reader can miss.
  return out.sort((a, b) => Number(Boolean(b.when)) - Number(Boolean(a.when)));
}

/**
 * Build the "questions to ask" sheet from clauses that warrant one.
 *
 * @param limit maximum questions to return; a sheet nobody finishes is no help
 */
export function collectQuestions(analyses: readonly ClauseAnalysis[], limit = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of [...analyses].sort(
    (x, y) => RISK_WEIGHT[y.risk] - RISK_WEIGHT[x.risk] || x.index - y.index,
  )) {
    const q = a.ask?.trim();
    if (!q || !a.grounded || RISK_WEIGHT[a.risk] === 0) continue;
    const key = dedupeKey(q);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= limit) break;
  }
  return out;
}

/** Assemble the complete document report. */
export function buildReport(
  analyses: readonly ClauseAnalysis[],
  docType: DocType,
  clauses: readonly Clause[] = [],
): DocumentReport {
  return {
    docType,
    clauseCount: analyses.length,
    riskScore: attentionScore(analyses),
    counts: countByRisk(analyses),
    readFirst: readFirst(analyses),
    obligations: collectObligations(analyses),
    questions: collectQuestions(analyses),
    ungroundedCount: analyses.filter((a) => !a.grounded).length,
    // Computed from the clause text, not from the analyses: a contradiction is
    // a property of what the document says, and must not depend on whether a
    // model happened to notice it.
    inconsistencies: findInconsistencies(clauses),
    // The brief asks for help with "options and potential next steps". These are
    // derived in TypeScript from severity and clause text, so they are
    // reproducible and contain nothing a model invented.
    nextSteps: buildNextSteps(analyses, docType),
    help: whereToGetHelp(docType),
  };
}
