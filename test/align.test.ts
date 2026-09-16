import { describe, expect, it } from 'vitest';
import { alignClauses, cosine } from '../src/lib/align';
import { normalizeDocument, segmentClauses } from '../src/lib/segment';

/**
 * Alignment decides which clause in one draft corresponds to which in another.
 * Getting it wrong is worse than reporting nothing: a mispaired clause produces
 * a fluent, confident explanation of a difference that does not exist.
 */

function clausesOf(text: string) {
  return segmentClauses(normalizeDocument(text));
}

const OLD = clausesOf(`
1. RENT: The Tenant shall pay rent of Rs. 40,000 per month, payable by the 5th day of each month.

2. DEPOSIT: The Tenant shall pay a refundable security deposit of two months rent, returned within thirty days of vacating.

3. NOTICE: Either party may terminate this Agreement by giving sixty days written notice.

4. PETS: No animals may be kept on the premises without written consent of the Landlord.
`);

describe('cosine', () => {
  it('is 1 for identical vectors', () => {
    const v = new Map([
      ['rent', 2],
      ['tenant', 1],
    ]);
    expect(cosine(v, v)).toBeCloseTo(1);
  });

  it('is 0 when no terms are shared', () => {
    expect(cosine(new Map([['rent', 1]]), new Map([['pets', 1]]))).toBe(0);
  });

  it('is 0 when either side is empty', () => {
    expect(cosine(new Map(), new Map([['rent', 1]]))).toBe(0);
  });

  it('is symmetric', () => {
    const a = new Map([
      ['rent', 3],
      ['notice', 1],
    ]);
    const b = new Map([
      ['rent', 1],
      ['deposit', 2],
    ]);
    expect(cosine(a, b)).toBeCloseTo(cosine(b, a));
  });
});

describe('alignClauses', () => {
  it('pairs every clause with itself when the documents are identical', () => {
    const { pairs, onlyInA, onlyInB } = alignClauses(OLD, OLD);
    expect(pairs).toHaveLength(OLD.length);
    expect(onlyInA).toEqual([]);
    expect(onlyInB).toEqual([]);
    expect(pairs.every((p) => p.identical)).toBe(true);
  });

  it('marks a reworded clause as paired but not identical', () => {
    const NEW = clausesOf(`
1. RENT: The Tenant shall pay rent of Rs. 46,000 per month, payable by the 3rd day of each month.

2. DEPOSIT: The Tenant shall pay a refundable security deposit of two months rent, returned within thirty days of vacating.

3. NOTICE: Either party may terminate this Agreement by giving sixty days written notice.

4. PETS: No animals may be kept on the premises without written consent of the Landlord.
`);
    const { pairs } = alignClauses(OLD, NEW);
    const rent = pairs.find((p) => p.a.label === '1');
    expect(rent).toBeDefined();
    expect(rent?.b.label).toBe('1');
    expect(rent?.identical).toBe(false);
    // Every other clause is untouched.
    expect(pairs.filter((p) => p.identical)).toHaveLength(3);
  });

  it('reports a removed clause as only-in-a', () => {
    const NEW = clausesOf(`
1. RENT: The Tenant shall pay rent of Rs. 40,000 per month, payable by the 5th day of each month.

2. DEPOSIT: The Tenant shall pay a refundable security deposit of two months rent, returned within thirty days of vacating.

3. NOTICE: Either party may terminate this Agreement by giving sixty days written notice.
`);
    const { onlyInA, onlyInB } = alignClauses(OLD, NEW);
    expect(onlyInA.map((c) => c.label)).toEqual(['4']);
    expect(onlyInB).toEqual([]);
  });

  it('reports an added clause as only-in-b', () => {
    const NEW = clausesOf(`
1. RENT: The Tenant shall pay rent of Rs. 40,000 per month, payable by the 5th day of each month.

2. DEPOSIT: The Tenant shall pay a refundable security deposit of two months rent, returned within thirty days of vacating.

3. NOTICE: Either party may terminate this Agreement by giving sixty days written notice.

4. PETS: No animals may be kept on the premises without written consent of the Landlord.

5. LOCK-IN: The Tenant shall not vacate the premises before eleven months, failing which the deposit stands forfeited.
`);
    const { onlyInA, onlyInB } = alignClauses(OLD, NEW);
    expect(onlyInA).toEqual([]);
    expect(onlyInB.map((c) => c.label)).toEqual(['5']);
  });

  it('still pairs clauses correctly when an insertion has renumbered them', () => {
    // A new clause 2 pushes deposit/notice/pets down by one. Numbering no
    // longer agrees, so the pairing has to come from the text.
    const NEW = clausesOf(`
1. RENT: The Tenant shall pay rent of Rs. 40,000 per month, payable by the 5th day of each month.

2. UTILITIES: The Tenant shall pay all electricity and water charges as billed.

3. DEPOSIT: The Tenant shall pay a refundable security deposit of two months rent, returned within thirty days of vacating.

4. NOTICE: Either party may terminate this Agreement by giving sixty days written notice.

5. PETS: No animals may be kept on the premises without written consent of the Landlord.
`);
    const { pairs, onlyInA, onlyInB } = alignClauses(OLD, NEW);
    const byOldLabel = Object.fromEntries(pairs.map((p) => [p.a.label, p.b.label]));
    expect(byOldLabel).toEqual({ '1': '1', '2': '3', '3': '4', '4': '5' });
    expect(onlyInA).toEqual([]);
    expect(onlyInB.map((c) => c.label)).toEqual(['2']);
  });

  it('refuses to pair clauses that merely share the same number', () => {
    const UNRELATED = clausesOf(`
1. CONFIDENTIALITY: The Receiving Party shall not disclose any Confidential Information to third parties.

2. INTELLECTUAL PROPERTY: All inventions conceived during the engagement vest in the Company.
`);
    const { pairs } = alignClauses(OLD, UNRELATED);
    expect(pairs).toEqual([]);
  });

  it('handles an empty document on either side', () => {
    expect(alignClauses([], OLD).onlyInB).toHaveLength(OLD.length);
    expect(alignClauses(OLD, []).onlyInA).toHaveLength(OLD.length);
    expect(alignClauses([], []).pairs).toEqual([]);
  });

  it('returns pairs in document order', () => {
    const { pairs } = alignClauses(OLD, OLD);
    const indices = pairs.map((p) => p.a.index);
    expect(indices).toEqual([...indices].sort((x, y) => x - y));
  });
});
