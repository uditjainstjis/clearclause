import { describe, expect, it } from 'vitest';
import { truncateQuote, verifyQuote } from '../src/lib/grounding';

const CLAUSE =
  '14. LOCK-IN PERIOD: The Licensee shall not vacate the premises before expiry of eleven (11) months. ' +
  'In the event the Licensee vacates prior thereto, the Security Deposit shall stand forfeited in its entirety.';

describe('verifyQuote', () => {
  it('accepts an exact substring', () => {
    const result = verifyQuote('the Security Deposit shall stand forfeited', CLAUSE);
    expect(result.grounded).toBe(true);
    expect(result.spans).toHaveLength(1);
  });

  it('returns spans that index back to the original text', () => {
    const quote = 'shall stand forfeited in its entirety';
    const { spans } = verifyQuote(quote, CLAUSE);
    const span = spans[0]!;
    expect(CLAUSE.slice(span.start, span.end)).toBe(quote);
  });

  it('tolerates differences in case', () => {
    expect(verifyQuote('THE SECURITY DEPOSIT SHALL STAND FORFEITED', CLAUSE).grounded).toBe(true);
  });

  it('tolerates collapsed or expanded whitespace, including newlines', () => {
    expect(verifyQuote('the   Security\n  Deposit shall stand forfeited', CLAUSE).grounded).toBe(
      true,
    );
  });

  it('tolerates curly quotes and dash width', () => {
    const source = 'The Company may vary the “Service” — at its discretion — without notice.';
    expect(verifyQuote('the "Service" - at its discretion - without notice', source).grounded).toBe(
      true,
    );
  });

  it('rejects a paraphrase, which is the entire point', () => {
    expect(verifyQuote('the deposit will be completely forfeited', CLAUSE).grounded).toBe(false);
  });

  it('rejects a quote from a different document', () => {
    expect(
      verifyQuote('the Employee shall serve a notice period of ninety days', CLAUSE).grounded,
    ).toBe(false);
  });

  it('rejects an empty or whitespace-only quote', () => {
    expect(verifyQuote('', CLAUSE).grounded).toBe(false);
    expect(verifyQuote('   \n ', CLAUSE).grounded).toBe(false);
  });

  it('accepts an elided quote when both fragments appear in order', () => {
    const result = verifyQuote(
      'The Licensee shall not vacate the premises … the Security Deposit shall stand forfeited',
      CLAUSE,
    );
    expect(result.grounded).toBe(true);
    expect(result.spans).toHaveLength(2);
  });

  it('rejects an elided quote whose fragments appear out of order', () => {
    const result = verifyQuote(
      'the Security Deposit shall stand forfeited … The Licensee shall not vacate the premises',
      CLAUSE,
    );
    expect(result.grounded).toBe(false);
  });

  it('rejects a fabricated fragment appended to a real one', () => {
    const result = verifyQuote(
      'The Licensee shall not vacate the premises … and shall pay a penalty of one lakh rupees',
      CLAUSE,
    );
    expect(result.grounded).toBe(false);
  });

  it('returns non-overlapping spans in document order for elided quotes', () => {
    const { spans } = verifyQuote(
      'The Licensee shall not vacate … shall stand forfeited in its entirety',
      CLAUSE,
    );
    expect(spans[0]!.end).toBeLessThanOrEqual(spans[1]!.start);
  });
});

describe('truncateQuote', () => {
  it('leaves a short quote untouched', () => {
    expect(truncateQuote('short quote', 240)).toBe('short quote');
  });

  it('cuts on a word boundary and marks the elision', () => {
    const out = truncateQuote('alpha beta gamma delta epsilon zeta', 20);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(21);
    expect(out).not.toContain('delt…');
  });
});
