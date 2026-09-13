import { describe, expect, it } from 'vitest';
import {
  attentionScore,
  buildReport,
  collectObligations,
  collectQuestions,
  countByRisk,
  readFirst,
  RISK_WEIGHT,
} from '../src/lib/risk';
import { analysis, obligation } from './helpers';

describe('attentionScore', () => {
  it('is zero for a document with nothing flagged', () => {
    expect(attentionScore([analysis(0, 'info'), analysis(1, 'low')])).toBe(0);
  });

  it('does not grow with document length when the extra clauses are ordinary', () => {
    const short = [analysis(0, 'high')];
    const long = [
      analysis(0, 'high'),
      ...Array.from({ length: 40 }, (_, i) => analysis(i + 1, 'low')),
    ];
    expect(attentionScore(long)).toBe(attentionScore(short));
  });

  it('rises monotonically as severity rises', () => {
    const one = attentionScore([analysis(0, 'high')]);
    const two = attentionScore([analysis(0, 'high'), analysis(1, 'high')]);
    const three = attentionScore([analysis(0, 'high'), analysis(1, 'high'), analysis(2, 'high')]);
    expect(one).toBeLessThan(two);
    expect(two).toBeLessThan(three);
  });

  it('saturates below 100 so no document is ever "finished"', () => {
    const many = Array.from({ length: 200 }, (_, i) => analysis(i, 'high'));
    expect(attentionScore(many)).toBeLessThan(100);
  });

  it('separates a fair document from a predatory one', () => {
    const fair = [
      analysis(0, 'info'),
      ...Array.from({ length: 10 }, (_, i) => analysis(i + 1, 'low')),
    ];
    const predatory = Array.from({ length: 6 }, (_, i) => analysis(i, 'high'));
    expect(attentionScore(predatory) - attentionScore(fair)).toBeGreaterThan(40);
  });

  it('excludes ungrounded findings, so an unverifiable claim cannot inflate it', () => {
    const grounded = [analysis(0, 'high')];
    const withUngrounded = [analysis(0, 'high'), analysis(1, 'high', { grounded: false })];
    expect(attentionScore(withUngrounded)).toBe(attentionScore(grounded));
  });

  it('weights low and info at zero by design', () => {
    expect(RISK_WEIGHT.low).toBe(0);
    expect(RISK_WEIGHT.info).toBe(0);
  });
});

describe('countByRisk', () => {
  it('counts every level including those with no members', () => {
    const counts = countByRisk([analysis(0, 'high'), analysis(1, 'high'), analysis(2, 'medium')]);
    expect(counts).toEqual({ high: 2, medium: 1, low: 0, info: 0 });
  });

  it('counts ungrounded clauses too, since they are still displayed', () => {
    expect(countByRisk([analysis(0, 'info', { grounded: false })]).info).toBe(1);
  });
});

describe('readFirst', () => {
  it('orders by severity, then by document order', () => {
    const list = [
      analysis(0, 'medium'),
      analysis(1, 'high'),
      analysis(2, 'medium'),
      analysis(3, 'high'),
    ];
    expect(readFirst(list)).toEqual([1, 3, 0, 2]);
  });

  it('omits clauses that need no attention', () => {
    expect(readFirst([analysis(0, 'low'), analysis(1, 'info')])).toEqual([]);
  });

  it('omits ungrounded clauses', () => {
    expect(readFirst([analysis(0, 'high', { grounded: false })])).toEqual([]);
  });

  it('respects the limit', () => {
    const list = Array.from({ length: 20 }, (_, i) => analysis(i, 'high'));
    expect(readFirst(list, 3)).toHaveLength(3);
  });
});

describe('collectObligations', () => {
  it('gathers obligations across clauses', () => {
    const list = [
      analysis(0, 'high', { obligations: [obligation('Pay rent by the 5th')] }),
      analysis(1, 'low', { obligations: [obligation('Give 60 days notice')] }),
    ];
    expect(collectObligations(list)).toHaveLength(2);
  });

  it('removes near-duplicates that differ only in punctuation or case', () => {
    const list = [
      analysis(0, 'high', { obligations: [obligation('Pay rent by the 5th')] }),
      analysis(1, 'low', { obligations: [obligation('pay rent by the 5th.')] }),
    ];
    expect(collectObligations(list)).toHaveLength(1);
  });

  it('puts dated obligations first, because those are the ones people miss', () => {
    const list = [
      analysis(0, 'low', { obligations: [obligation('Keep the premises clean')] }),
      analysis(1, 'low', {
        obligations: [obligation('Give notice', { when: '60 days before expiry' })],
      }),
    ];
    expect(collectObligations(list)[0]!.when).toBe('60 days before expiry');
  });

  it('drops obligations from ungrounded clauses', () => {
    const list = [
      analysis(0, 'high', { grounded: false, obligations: [obligation('Pay a penalty')] }),
    ];
    expect(collectObligations(list)).toEqual([]);
  });

  it('ignores an obligation with no text', () => {
    expect(collectObligations([analysis(0, 'high', { obligations: [obligation('  ')] })])).toEqual(
      [],
    );
  });
});

describe('collectQuestions', () => {
  it('orders questions by the severity of the clause they came from', () => {
    const list = [
      analysis(0, 'medium', { ask: 'Medium question?' }),
      analysis(1, 'high', { ask: 'High question?' }),
    ];
    expect(collectQuestions(list)[0]).toBe('High question?');
  });

  it('omits questions from clauses needing no attention', () => {
    expect(collectQuestions([analysis(0, 'low', { ask: 'Low question?' })])).toEqual([]);
  });

  it('deduplicates questions asked about several clauses', () => {
    const list = [
      analysis(0, 'high', { ask: 'Can this be negotiated?' }),
      analysis(1, 'high', { ask: 'Can this be negotiated?' }),
    ];
    expect(collectQuestions(list)).toHaveLength(1);
  });

  it('caps the sheet at the limit, because nobody finishes a list of thirty', () => {
    const list = Array.from({ length: 30 }, (_, i) =>
      analysis(i, 'high', { ask: `Question ${i}?` }),
    );
    expect(collectQuestions(list, 8)).toHaveLength(8);
  });
});

describe('buildReport', () => {
  it('assembles a complete report', () => {
    const list = [
      analysis(0, 'high', { obligations: [obligation('Pay rent')] }),
      analysis(1, 'low'),
      analysis(2, 'medium', { grounded: false }),
    ];
    const report = buildReport(list, 'rental');
    expect(report.docType).toBe('rental');
    expect(report.clauseCount).toBe(3);
    expect(report.ungroundedCount).toBe(1);
    expect(report.readFirst).toEqual([0]);
    expect(report.obligations).toHaveLength(1);
    expect(report.riskScore).toBeGreaterThan(0);
  });

  it('handles an empty document without throwing', () => {
    const report = buildReport([], 'other');
    expect(report.clauseCount).toBe(0);
    expect(report.riskScore).toBe(0);
    expect(report.questions).toEqual([]);
  });
});
