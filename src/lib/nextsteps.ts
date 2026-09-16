import type { ClauseAnalysis, DocType, NextStep, WhereToGetHelp } from './types';

/**
 * What a reader can actually do next.
 *
 * This is the "assistance" half of the brief, and it is the half that is easy to
 * either skip or overreach on. Overreaching means telling someone what the law
 * entitles them to; skipping means handing them a list of problems and no
 * handle. Both fail the person holding the contract.
 *
 * The line taken here is **procedural, not substantive**. Every step below is a
 * move available to anyone in a negotiation — ask for a cap, ask for symmetry,
 * ask for it in writing, ask what happens if — and every one is derived in
 * TypeScript from a clause's severity and its own text. Nothing here asserts
 * what the law says, what a court would do, or what the reader ought to choose.
 * That distinction is the brief's own: provide information and assistance,
 * rather than replace professional legal advice.
 *
 * Deterministic for the same reason the risk score is: a suggestion a reader may
 * act on should be reproducible and explainable, and should not vary between two
 * runs over the same document.
 */

/** Phrases that identify what kind of term a clause is, from its own words. */
interface StepRule {
  kind: string;
  /** Matched against the clause heading and plain-language restatement. */
  test: RegExp;
  /** The move available to the reader. Second person, concrete, procedural. */
  step: string;
  /** Why this is worth doing, in the reader's terms. */
  because: string;
}

/**
 * Ordered most specific first: a clause matching several rules yields the
 * narrowest advice, not a pile of generic ones.
 */
const STEP_RULES: readonly StepRule[] = [
  {
    kind: 'lock-in',
    test: /lock[- ]?in|shall not vacate|minimum (?:term|period)|before expiry/i,
    step: 'Ask for the lock-in to be shortened, or for an exit with notice instead of forfeiture.',
    because:
      'A lock-in is the term that most often costs people money they did not expect, because it binds you to a home or a job you may need to leave for reasons nobody can foresee.',
  },
  {
    kind: 'forfeiture',
    test: /forfeit|shall stand forfeited|non[- ]?refundable/i,
    step: 'Ask for this to be capped at the actual loss, and for that loss to be evidenced.',
    because:
      'A sum that is forfeited "in its entirety" is not connected to what the other side actually lost. Asking for the cap is a normal thing to ask for.',
  },
  {
    kind: 'deposit',
    test: /deposit|advance|security amount/i,
    step: 'Ask when exactly the deposit comes back, and for deductions to require receipts.',
    because:
      'Deposits are usually the largest sum you hand over. A refund window with no receipts requirement is where disputes start.',
  },
  {
    kind: 'notice-asymmetry',
    test: /notice/i,
    step: 'Check whether the notice period is the same for both sides. If not, ask for it to be.',
    because:
      'Asymmetric notice — fifteen days for them, ninety for you — is one of the most common one-sided terms, and one of the easiest to get changed.',
  },
  {
    kind: 'indemnity',
    test: /indemnif|hold harmless|liabilit/i,
    step: 'Ask for this to be limited to losses your own actions actually caused.',
    because:
      'An indemnity written "whether or not attributable to any act of" you is open-ended exposure. Narrowing it to your own acts is a standard request.',
  },
  {
    kind: 'unilateral-discretion',
    test: /sole discretion|as the \w+ (?:may|deems)|without assigning any reason|solely at the discretion/i,
    step: 'Ask for an objective standard here, or for the decision to be made jointly.',
    because:
      'A term that depends on one side’s "sole discretion" cannot be planned around, because it is not yet decided.',
  },
  {
    kind: 'escalation',
    test: /escalat|increas|revision of (?:rent|fee)|not less than \d+%/i,
    step: 'Ask for the increase to be a ceiling rather than a floor, and tied to a published index.',
    because:
      '"Not less than 12%" sets a minimum with no maximum. A ceiling is the version of the same clause that you can budget against.',
  },
  {
    kind: 'repairs',
    test: /repair|maintenance|structural|seepage|waterproof|repaint/i,
    step: 'Ask for structural and pre-existing problems to stay with the owner.',
    because:
      'Taking on "all repairs of every nature" means inheriting problems that existed before you arrived.',
  },
  {
    kind: 'dispute-forum',
    test: /arbitrat|jurisdiction|dispute|courts? at/i,
    step: 'Ask who appoints the arbitrator, and whether you would have to travel to raise a dispute.',
    because:
      'A forum you cannot reach, or a decider chosen entirely by the other side, can make a right you hold impractical to use.',
  },
  {
    kind: 'termination',
    test: /terminat|cancel|end this agreement/i,
    step: 'Ask what happens to money already paid if this is ended early.',
    because:
      'Contracts often say who may end the agreement without saying what you get back when they do.',
  },
];

/** Advice that applies to the document as a whole, by archetype. */
const DOC_TYPE_STEPS: Record<DocType, readonly string[]> = {
  rental: [
    'Photograph the property and its fittings on the day you move in, and send the photographs to the owner so the date is recorded.',
    'Ask for the agreement to be registered if it runs beyond the period your state requires registration for — the registrar’s office can tell you which applies.',
  ],
  employment: [
    'Ask for the full salary breakdown in writing, including anything described as variable or discretionary.',
    'Ask what happens to unvested benefits, notice pay and accrued leave if you resign rather than are dismissed.',
  ],
  loan: [
    'Ask for the total amount repayable over the full term, in rupees, not only the interest rate.',
    'Ask what the prepayment charge is, and whether it changes after a certain period.',
  ],
  service: [
    'Ask what the service level actually guarantees, and what you receive if it is missed.',
    'Ask who owns what is produced, and what happens to it if the agreement ends.',
  ],
  nda: [
    'Ask how long the obligation lasts after the relationship ends, and whether it is limited to information that is genuinely confidential.',
    'Check whether the obligation runs both ways or only against you.',
  ],
  terms: [
    'Check whether the other side may change these terms unilaterally, and whether you are told when they do.',
    'Check what happens to your data and your account if the service closes your access.',
  ],
  other: [
    'Read the clauses flagged above against what you were told verbally — a mismatch between the two is worth raising before you sign.',
  ],
};

/**
 * Where a person can get real help.
 *
 * Procedural facts about where assistance exists, with the authoritative source
 * named so the reader can check eligibility themselves rather than take this
 * page's word for it. Deliberately not a statement of entitlement: the product
 * points at the door, it does not tell anyone they will be let through.
 */
const HELP_BY_TYPE: Record<DocType, string> = {
  rental: 'An advocate who handles tenancy matters, or your local rent authority.',
  employment: 'An advocate who handles employment and labour matters.',
  loan: 'An advocate who handles consumer credit, or the lender’s grievance officer.',
  service: 'A commercial advocate, or the consumer grievance route if you are a consumer.',
  nda: 'An advocate who handles commercial contracts.',
  terms: 'The consumer grievance route, or an advocate who handles consumer matters.',
  other: 'An advocate who handles contract matters.',
};

export function whereToGetHelp(docType: DocType): WhereToGetHelp {
  return {
    freeLegalAid:
      'Free legal aid is available in India through the National Legal Services Authority and your District Legal Services Authority. Who qualifies and how to apply is set out at nalsa.gov.in — check it directly rather than relying on this page.',
    freeLegalAidUrl: 'https://nalsa.gov.in',
    professional: HELP_BY_TYPE[docType],
    takeWithYou:
      'Take the obligations list, the questions, and the clauses marked as needing attention. Someone reading a contract cold will get to the point faster with those in hand.',
  };
}

/** Severities that warrant a suggested move. Routine terms do not. */
const ACTIONABLE = new Set(['high', 'medium']);

/**
 * Derive the moves available to the reader.
 *
 * @param analyses per-clause analyses, after grounding verification
 * @param docType  archetype, used for the whole-document steps
 * @returns at most one step per clause, most severe first, plus the steps that
 *   apply to a document of this kind
 */
export function buildNextSteps(analyses: readonly ClauseAnalysis[], docType: DocType): NextStep[] {
  const steps: NextStep[] = [];
  const seen = new Set<string>();

  const ordered = [...analyses].sort((a, b) => {
    const rank = (r: string): number => (r === 'high' ? 0 : r === 'medium' ? 1 : 2);
    return rank(a.risk) - rank(b.risk) || a.index - b.index;
  });

  for (const analysis of ordered) {
    // Only grounded findings earn a suggestion: a move proposed off the back of
    // a claim we could not verify against the document is a move built on sand.
    if (!ACTIONABLE.has(analysis.risk) || !analysis.grounded) continue;
    const haystack = `${analysis.heading} ${analysis.plain}`;
    const rule = STEP_RULES.find((r) => r.test.test(haystack));
    if (!rule || seen.has(rule.kind)) continue;
    seen.add(rule.kind);
    steps.push({
      kind: rule.kind,
      clauseIndex: analysis.index,
      clauseLabel: analysis.label,
      step: rule.step,
      because: rule.because,
    });
  }

  for (const step of DOC_TYPE_STEPS[docType]) {
    steps.push({
      kind: 'document-type',
      clauseIndex: null,
      clauseLabel: null,
      step,
      because: '',
    });
  }

  return steps;
}
