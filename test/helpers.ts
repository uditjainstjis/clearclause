import type { Clause, ClauseAnalysis, Obligation, RiskLevel } from '../src/lib/types';

/** Build a clause analysis for aggregation tests. */
export function analysis(
  index: number,
  risk: RiskLevel,
  extra: Partial<ClauseAnalysis> = {},
): ClauseAnalysis {
  return {
    index,
    label: String(index + 1),
    heading: `Clause ${index + 1}`,
    plain: 'Plain explanation.',
    risk,
    why: 'Why it matters.',
    ask: `Question about clause ${index + 1}?`,
    quote: 'quoted text',
    obligations: [],
    grounded: true,
    cached: false,
    ...extra,
  };
}

export function obligation(what: string, extra: Partial<Obligation> = {}): Obligation {
  return { who: 'you', what, when: null, quote: 'quoted text', ...extra };
}

export function clause(index: number, text: string): Clause {
  return { index, label: String(index + 1), text, start: 0, end: text.length };
}
