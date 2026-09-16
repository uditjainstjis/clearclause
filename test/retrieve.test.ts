import { describe, expect, it } from 'vitest';
import { TOP_K, queryTerms, retrieveClauses, stem, tokenize } from '../src/lib/retrieve';
import { normalizeDocument, segmentClauses } from '../src/lib/segment';

/**
 * Retrieval decides which clauses a question is answered from, so its failure
 * modes are the product's failure modes: miss the relevant clause and the
 * answer becomes "the document does not say" when it does.
 */

const DOC = normalizeDocument(`
1. RENT: The Tenant shall pay rent of Rs. 41,500 per month, payable by the 5th of each month.

2. SECURITY DEPOSIT: The Tenant has paid a refundable deposit of Rs. 4,15,000, refundable within ninety days of vacating the premises.

3. NOTICE: Either party may terminate this Agreement by giving sixty days written notice to the other party.

4. PETS: No animals of any kind may be kept on the premises without the prior written consent of the Landlord.

5. GOVERNING LAW: This Agreement shall be governed by the laws of India and the courts at Bengaluru shall have jurisdiction.
`);

const CLAUSES = segmentClauses(DOC);

describe('tokenize', () => {
  it('drops stopwords and legal boilerplate but keeps numbers', () => {
    const tokens = tokenize('The Tenant shall pay rent of Rs. 41,500 per month');
    expect(tokens).toContain('tenant');
    expect(tokens).toContain('rent');
    expect(tokens).toContain('41');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('shall');
    expect(tokens).not.toContain('of');
  });

  it('drops single characters left behind by punctuation', () => {
    expect(tokenize('a b cd')).toEqual(['cd']);
  });
});

describe('stem', () => {
  it('collapses the inflections that matter in a contract', () => {
    expect(stem('termination')).toBe(stem('terminate'));
    expect(stem('payments')).toBe(stem('payment'));
  });

  it('leaves short words alone rather than mangling them', () => {
    expect(stem('is')).toBe('is');
    expect(stem('gas')).toBe('gas');
  });
});

describe('retrieveClauses', () => {
  it('finds the deposit clause for a question about the deposit', () => {
    const hits = retrieveClauses('when do I get my security deposit back?', CLAUSES);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.clause.label).toBe('2');
  });

  it('finds the notice clause for a question about leaving', () => {
    const hits = retrieveClauses('how much notice must I give to terminate?', CLAUSES);
    expect(hits[0]?.clause.label).toBe('3');
  });

  it('reports which question terms actually matched, for auditability', () => {
    const hits = retrieveClauses('can I keep pets on the premises?', CLAUSES);
    expect(hits[0]?.clause.label).toBe('4');
    expect(hits[0]?.matched).toContain('pet');
  });

  it('returns nothing when the document shares no vocabulary with the question', () => {
    expect(retrieveClauses('what is the wifi password?', CLAUSES)).toEqual([]);
  });

  it('returns nothing for a question made entirely of stopwords', () => {
    expect(retrieveClauses('what is it that of the', CLAUSES)).toEqual([]);
  });

  it('never returns more than the top-k limit', () => {
    // "shall" and "agreement" are stopped, so use a term spread across clauses.
    const hits = retrieveClauses('tenant landlord premises notice deposit rent', CLAUSES);
    expect(hits.length).toBeLessThanOrEqual(TOP_K);
  });

  it('orders by score, highest first', () => {
    const hits = retrieveClauses('deposit refundable vacating', CLAUSES);
    const scores = hits.map((h) => h.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('still surfaces the answering clause when a query word collides with the title', () => {
    // "LEAVE AND LICENCE AGREEMENT" makes the preamble score highly for the
    // ordinary sense of "leave". The clause that answers must survive that.
    const doc = normalizeDocument(`
LEAVE AND LICENCE AGREEMENT

This Agreement is made at Bengaluru between the Licensor and the undersigned occupant.

1. RENT: The Licensee shall pay a monthly fee of Rs. 38,000 on or before the 5th day.

2. ENTRY: The Licensor shall endeavour to give prior intimation before entering the premises.

3. PAINTING: The Licensee shall bear the cost of complete repainting of the premises on vacation.
`);
    const hits = retrieveClauses('who pays for repainting when I leave?', segmentClauses(doc));
    expect(hits.map((h) => h.clause.label)).toContain('3');
  });

  it('handles an empty document without throwing', () => {
    expect(retrieveClauses('anything at all', [])).toEqual([]);
  });

  it('prefers the clause that uses a rare term over one that merely mentions a common one', () => {
    // "jurisdiction" appears once; "tenant" appears in several clauses.
    const hits = retrieveClauses('which courts have jurisdiction?', CLAUSES);
    expect(hits[0]?.clause.label).toBe('5');
  });
});

describe('everyday vocabulary reaching legal terms of art', () => {
  // The document a reader is holding almost never uses the words they would.
  const LEASE = segmentClauses(
    normalizeDocument(`
1. LICENCE FEE: The Licensee shall pay a monthly licence fee of Rs. 38,000 on or before the 5th day of each calendar month.

2. ESCALATION: Upon any renewal, the licence fee shall stand increased by not less than 12% over the fee then prevailing.

3. TERMINATION: The Licensor may terminate this Agreement upon fifteen days written notice without assigning any reason.

4. ALTERATIONS: The Licensee shall make no alteration, addition or fixture to the premises, including the installation of air conditioning units, without prior written consent.

5. INDEMNITY: The Licensee shall indemnify the Licensor against all claims arising out of occupation of the premises.
`),
  );

  it('finds the Licensor clause when the reader says "landlord"', () => {
    const hits = retrieveClauses('how much notice must the landlord give me?', LEASE);
    expect(hits.map((h) => h.clause.label)).toContain('3');
  });

  it('finds the licence-fee clause when the reader says "rent"', () => {
    const hits = retrieveClauses('how much can the rent go up on renewal?', LEASE);
    expect(hits.map((h) => h.clause.label)).toContain('2');
  });

  it('finds the alterations clause when the reader says "air conditioner"', () => {
    const hits = retrieveClauses('can I install an air conditioner?', LEASE);
    expect(hits.map((h) => h.clause.label)).toContain('4');
  });

  it('finds the Licensee clause when the reader says "tenant"', () => {
    const hits = retrieveClauses('what must the tenant pay each month?', LEASE);
    expect(hits.map((h) => h.clause.label)).toContain('1');
  });

  it('expands a query without rewriting the document', () => {
    // The guarantee that makes expansion safe: quotes still come from the real
    // text, because only the search widened.
    const expanded = queryTerms('what does the landlord owe me?');
    expect(expanded).toContain(stem('landlord'));
    expect(expanded).toContain(stem('licensor'));
  });

  it('leaves a question with no everyday synonyms untouched', () => {
    expect(queryTerms('indemnify arbitration jurisdiction')).toEqual([
      stem('indemnify'),
      stem('arbitration'),
      stem('jurisdiction'),
    ]);
  });

  it('finds the occupancy clause when the reader asks about a friend staying over', () => {
    const withGuests = segmentClauses(
      normalizeDocument(`
1. LICENCE FEE: The Licensee shall pay a monthly licence fee of Rs. 38,000 by the 5th day.

2. OCCUPANCY: No guest shall stay overnight for more than three consecutive nights without the written permission of the Licensor.
`),
    );
    const hits = retrieveClauses('can my friend stay over?', withGuests);
    expect(hits.map((h) => h.clause.label)).toContain('2');
  });

  it('still returns nothing for a question the document has no words for', () => {
    expect(retrieveClauses('what is the wifi password?', LEASE)).toEqual([]);
  });
});
