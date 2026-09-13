import { describe, expect, it } from 'vitest';
import { normalizeDocument, segmentClauses } from '../src/lib/segment';

describe('normalizeDocument', () => {
  it('normalises line endings without disturbing paragraph structure', () => {
    expect(normalizeDocument('a\r\nb\r\n\r\nc')).toBe('a\nb\n\nc');
  });

  it('rejoins words hyphenated across a line break by PDF extraction', () => {
    expect(normalizeDocument('the termi-\nnation clause')).toBe('the termination clause');
  });

  it('leaves a genuine hyphenated compound alone', () => {
    expect(normalizeDocument('a lock-in period')).toContain('lock-in period');
  });

  it('collapses horizontal whitespace runs', () => {
    expect(normalizeDocument('a    b\tc')).toBe('a b c');
  });

  it('caps consecutive blank lines at one', () => {
    expect(normalizeDocument('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('is idempotent', () => {
    const once = normalizeDocument('  a\r\n\r\n\r\n   b-\ncd  ');
    expect(normalizeDocument(once)).toBe(once);
  });
});

describe('segmentClauses', () => {
  it('returns nothing for empty input', () => {
    expect(segmentClauses('')).toEqual([]);
    expect(segmentClauses('   \n  ')).toEqual([]);
  });

  it('splits on decimal clause numbers and captures the label', () => {
    const doc = normalizeDocument(
      '1. RENT: The Tenant shall pay rent monthly without demand.\n' +
        '2. DEPOSIT: The Tenant has paid a refundable security deposit.\n' +
        '3. TERM: This agreement runs for eleven months from commencement.',
    );
    const clauses = segmentClauses(doc);
    expect(clauses).toHaveLength(3);
    expect(clauses.map((c) => c.label)).toEqual(['1', '2', '3']);
    expect(clauses[0]!.text).toContain('RENT');
    expect(clauses[2]!.text).toContain('eleven months');
  });

  it('splits on word-headed markers in preference to inner numbering', () => {
    const doc = normalizeDocument(
      'ARTICLE I — DEFINITIONS\nIn this agreement the following words have the meanings given.\n' +
        'ARTICLE II — PAYMENT\nThe Client shall pay each invoice within thirty days of receipt.',
    );
    const clauses = segmentClauses(doc);
    expect(clauses).toHaveLength(2);
    expect(clauses[1]!.text).toContain('PAYMENT');
  });

  it('does not split a sub-list away from its parent clause', () => {
    const doc = normalizeDocument(
      '1. The Tenant shall be responsible for the following items of maintenance.\n' +
        '(a) Repairs to plumbing and sanitary fittings within the premises.\n' +
        '(b) Repairs to electrical wiring, switches and fixtures.\n' +
        '2. The Landlord shall be responsible for structural repairs only.',
    );
    const clauses = segmentClauses(doc);
    // Two top-level clauses; the (a)/(b) items stay with clause 1.
    expect(clauses).toHaveLength(2);
    expect(clauses[0]!.text).toContain('(a)');
    expect(clauses[0]!.text).toContain('(b)');
  });

  it('falls back to paragraph splitting when the document has no numbering', () => {
    const doc = normalizeDocument(
      'This letter confirms the terms of your engagement with the company.\n\n' +
        'You will be paid monthly in arrears on the last working day of each month.\n\n' +
        'Either party may end this arrangement on one month of written notice.',
    );
    const clauses = segmentClauses(doc);
    expect(clauses).toHaveLength(3);
    expect(clauses.every((c) => c.label === null)).toBe(true);
  });

  it('does not treat a year at the start of a line as a clause number', () => {
    const doc = normalizeDocument(
      '1. The term commences on the date stated in the schedule to this agreement.\n' +
        '1998 was the year the original lease over these premises was first granted.\n' +
        '2. The rent is payable monthly in advance without deduction or set-off.',
    );
    const clauses = segmentClauses(doc);
    expect(clauses).toHaveLength(2);
    expect(clauses[0]!.text).toContain('1998');
  });

  it('merges a fragment shorter than the minimum into the clause before it', () => {
    const doc = normalizeDocument(
      '1. The first clause contains enough text to stand on its own comfortably.\n' +
        '2. Short.\n' +
        '3. The third clause also contains a sufficient quantity of text here.',
    );
    const clauses = segmentClauses(doc);
    expect(clauses).toHaveLength(2);
    expect(clauses[0]!.text).toContain('Short.');
  });

  it('keeps a preamble that appears before the first numbered clause', () => {
    const doc = normalizeDocument(
      'THIS AGREEMENT is made between the Licensor and the Licensee on the date below.\n' +
        '1. The Licensee shall pay the licence fee monthly in advance without demand.\n' +
        '2. The Licensor shall permit quiet enjoyment of the premises by the Licensee.',
    );
    const clauses = segmentClauses(doc);
    expect(clauses).toHaveLength(3);
    expect(clauses[0]!.label).toBeNull();
    expect(clauses[0]!.text).toContain('THIS AGREEMENT');
  });

  it('assigns offsets that index back into the source text', () => {
    const doc = normalizeDocument(
      '1. RENT: The Tenant shall pay rent monthly without any demand whatsoever.\n' +
        '2. DEPOSIT: The Tenant has paid a refundable security deposit in advance.',
    );
    for (const clause of segmentClauses(doc)) {
      expect(doc.slice(clause.start, clause.end).trim()).toBe(clause.text.trim());
    }
  });

  it('numbers clauses consecutively from zero', () => {
    const doc = normalizeDocument(
      '1. Alpha clause text that is long enough to survive the merge threshold.\n' +
        '2. Beta clause text that is also long enough to survive the threshold.\n' +
        '3. Gamma clause text that is long enough as well to survive the merge.',
    );
    expect(segmentClauses(doc).map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it('breaks up a clause too large for a single model call', () => {
    const paragraph = 'This sentence is repeated to build an oversized clause body. '.repeat(20);
    const doc = normalizeDocument(
      `1. HUGE:\n${Array.from({ length: 8 }, () => paragraph).join('\n\n')}\n2. SMALL: A short following clause with sufficient length.`,
    );
    const clauses = segmentClauses(doc);
    expect(clauses.length).toBeGreaterThan(2);
    expect(clauses.every((c) => c.text.length <= 6000)).toBe(true);
  });
});
