import { describe, expect, it } from 'vitest';
import { buildNextSteps, whereToGetHelp } from '../src/lib/nextsteps';
import type { ClauseAnalysis } from '../src/lib/types';

/**
 * The "assistance" half of the brief. The property that matters most is what
 * these steps are NOT: they never assert what the law gives the reader, only
 * what they can ask for. That line is what keeps the product on the right side
 * of "information and assistance, rather than legal advice".
 */

function clause(partial: Partial<ClauseAnalysis>): ClauseAnalysis {
  return {
    index: 0,
    label: '1',
    heading: 'A term',
    plain: 'Something happens.',
    risk: 'medium',
    why: '',
    ask: '',
    quote: 'q',
    obligations: [],
    grounded: true,
    cached: false,
    ...partial,
  };
}

describe('buildNextSteps', () => {
  it('suggests shortening a lock-in when one is flagged', () => {
    const steps = buildNextSteps(
      [
        clause({
          risk: 'high',
          heading: 'Lock-in period',
          plain: 'You shall not vacate before eleven months.',
        }),
      ],
      'rental',
    );
    const lockIn = steps.find((s) => s.kind === 'lock-in');
    expect(lockIn?.step).toMatch(/shortened/i);
    expect(lockIn?.clauseLabel).toBe('1');
  });

  it('suggests checking notice symmetry', () => {
    const steps = buildNextSteps(
      [
        clause({
          risk: 'high',
          heading: 'Termination',
          plain: 'They may end this on fifteen days notice; you need ninety.',
        }),
      ],
      'rental',
    );
    // "Termination" matches the notice rule first because notice is the more
    // specific thing wrong with this clause.
    expect(steps.some((s) => s.step.includes('same for both sides'))).toBe(true);
  });

  it('ignores routine clauses — a reader should not be handed busywork', () => {
    const steps = buildNextSteps(
      [
        clause({
          risk: 'low',
          heading: 'Lock-in period',
          plain: 'You shall not vacate before eleven months.',
        }),
        clause({ risk: 'info', index: 1, heading: 'Indemnity', plain: 'You indemnify them.' }),
      ],
      'rental',
    );
    expect(steps.filter((s) => s.kind !== 'document-type')).toEqual([]);
  });

  it('ignores an ungrounded finding, because the move would rest on an unverified claim', () => {
    const steps = buildNextSteps(
      [
        clause({
          risk: 'high',
          grounded: false,
          heading: 'Lock-in period',
          plain: 'You shall not vacate.',
        }),
      ],
      'rental',
    );
    expect(steps.some((s) => s.kind === 'lock-in')).toBe(false);
  });

  it('gives at most one step per kind, however many clauses match', () => {
    const steps = buildNextSteps(
      [0, 1, 2, 3].map((i) =>
        clause({
          index: i,
          risk: 'high',
          heading: 'Indemnity',
          plain: 'You shall indemnify them for everything.',
        }),
      ),
      'rental',
    );
    expect(steps.filter((s) => s.kind === 'indemnity')).toHaveLength(1);
  });

  it('puts the most severe clause first', () => {
    const steps = buildNextSteps(
      [
        clause({
          index: 0,
          risk: 'medium',
          heading: 'Repairs',
          plain: 'You pay for all repairs and maintenance.',
        }),
        clause({
          index: 1,
          risk: 'high',
          heading: 'Forfeiture',
          plain: 'The deposit shall stand forfeited.',
        }),
      ],
      'rental',
    );
    expect(steps[0]?.kind).toBe('forfeiture');
  });

  it('always adds the steps that apply to the document type', () => {
    for (const type of [
      'rental',
      'employment',
      'loan',
      'service',
      'nda',
      'terms',
      'other',
    ] as const) {
      const steps = buildNextSteps([], type);
      expect(steps.filter((s) => s.kind === 'document-type').length).toBeGreaterThan(0);
    }
  });

  it('never tells the reader what the law entitles them to', () => {
    const steps = buildNextSteps(
      [
        clause({
          index: 0,
          risk: 'high',
          heading: 'Lock-in',
          plain: 'You shall not vacate before eleven months.',
        }),
        clause({
          index: 1,
          risk: 'high',
          heading: 'Indemnity',
          plain: 'You indemnify them for all claims.',
        }),
        clause({
          index: 2,
          risk: 'high',
          heading: 'Escalation',
          plain: 'The fee increases by not less than 12%.',
        }),
      ],
      'rental',
    );
    // The boundary this product is built on, asserted rather than assumed.
    const forbidden =
      /\b(illegal|unenforceable|void|your right to|you are entitled|the law (?:says|requires|provides)|under section|the Act\b|is not permitted by law)\b/i;
    for (const s of steps) {
      expect(forbidden.test(s.step), `step: ${s.step}`).toBe(false);
      expect(forbidden.test(s.because), `because: ${s.because}`).toBe(false);
    }
  });
});

describe('whereToGetHelp', () => {
  it('points at the legal aid authority and names its source', () => {
    const help = whereToGetHelp('rental');
    expect(help.freeLegalAid).toMatch(/National Legal Services Authority/);
    expect(help.freeLegalAidUrl).toBe('https://nalsa.gov.in');
  });

  it('describes eligibility as something to check, not something it asserts', () => {
    // The product points at the door; it does not tell anyone they get in.
    expect(whereToGetHelp('rental').freeLegalAid).toMatch(/check it directly/i);
  });

  it('names a relevant kind of professional for every document type', () => {
    for (const type of [
      'rental',
      'employment',
      'loan',
      'service',
      'nda',
      'terms',
      'other',
    ] as const) {
      expect(whereToGetHelp(type).professional.length).toBeGreaterThan(10);
    }
  });
});
