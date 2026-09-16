import { describe, expect, it } from 'vitest';
import { findInconsistencies } from '../src/lib/consistency';
import { normalizeDocument, segmentClauses } from '../src/lib/segment';

/**
 * Contradiction detection is the one finding in this project that carries no
 * model risk at all — every quote is a span that provably exists. The risk it
 * does carry is false positives, so most of these tests are about staying quiet.
 */

function clausesOf(text: string) {
  return segmentClauses(normalizeDocument(text));
}

describe('findInconsistencies', () => {
  it('finds a notice period stated two different ways', () => {
    const found = findInconsistencies(
      clausesOf(`
1. TERM: This Agreement runs for eleven months from the date of commencement.

2. TERMINATION: Either party may end this Agreement on thirty days written notice.

3. EXIT: The Tenant shall vacate only after giving ninety days written notice to the Landlord.
`),
    );
    const notice = found.find((f) => f.kind === 'notice-period');
    expect(notice).toBeDefined();
    expect(notice?.values).toHaveLength(2);
    expect(notice?.values.map((v) => v.display)).toEqual([
      'thirty days notice',
      'ninety days notice',
    ]);
    // Every quote must be a real span of the clause it is attributed to.
    expect(notice?.values[0]?.clauseLabel).toBe('2');
  });

  it('treats sixty days and two months as the same period', () => {
    const found = findInconsistencies(
      clausesOf(`
1. NOTICE: Either party may terminate on sixty days written notice to the other party.

2. NOTICE AGAIN: The same two months notice applies to the Landlord in all cases.
`),
    );
    expect(found.find((f) => f.kind === 'notice-period')).toBeUndefined();
  });

  it('recognises 3% per month and 36% per annum as the same rate', () => {
    const found = findInconsistencies(
      clausesOf(`
1. INTEREST: Late payment shall attract interest at 3% per month on the outstanding sum.

2. RESTATEMENT: For the avoidance of doubt the said interest is 36% per annum on arrears.
`),
    );
    expect(found.find((f) => f.kind === 'interest-rate')).toBeUndefined();
  });

  it('finds two different courts named as having jurisdiction', () => {
    const found = findInconsistencies(
      clausesOf(`
1. DISPUTES: Any dispute shall be subject to the courts at Bengaluru and no other forum.

2. GOVERNING LAW: The parties submit to the exclusive jurisdiction of the courts at Mumbai.
`),
    );
    const j = found.find((f) => f.kind === 'jurisdiction');
    expect(j?.values.map((v) => v.display)).toEqual(['Bengaluru', 'Mumbai']);
  });

  it('finds two different security deposit figures', () => {
    const found = findInconsistencies(
      clausesOf(`
1. DEPOSIT: The Tenant has paid a refundable deposit of Rs. 4,15,000 to the Landlord.

2. SCHEDULE: The said deposit of Rs. 2,50,000 shall be returned on vacating the premises.
`),
    );
    expect(found.find((f) => f.kind === 'deposit-amount')?.values).toHaveLength(2);
  });

  it('stays silent on a document that states each term once', () => {
    const found = findInconsistencies(
      clausesOf(`
1. RENT: The Tenant shall pay Rs. 38,000 per month by the 5th day of each month.

2. NOTICE: Either party may terminate on sixty days written notice to the other party.

3. DISPUTES: The courts at Pune shall have exclusive jurisdiction over any dispute.
`),
    );
    expect(found).toEqual([]);
  });

  it('stays silent when the same term is repeated verbatim', () => {
    const found = findInconsistencies(
      clausesOf(`
1. NOTICE: Either party may terminate on sixty days written notice to the other party.

2. REPETITION: Either party may terminate on sixty days written notice to the other party.

3. AGAIN: Either party may terminate on sixty days written notice to the other party.
`),
    );
    expect(found).toEqual([]);
  });

  it('returns nothing for an empty document', () => {
    expect(findInconsistencies([])).toEqual([]);
  });

  it('reports each distinct value once, not once per occurrence', () => {
    const found = findInconsistencies(
      clausesOf(`
1. NOTICE: Either party may terminate on thirty days written notice to the other party.

2. REPEAT: Again, thirty days written notice is required from either party hereunder.

3. CONFLICT: The Landlord may however act upon seven days written notice at any time.
`),
    );
    expect(found.find((f) => f.kind === 'notice-period')?.values).toHaveLength(2);
  });
});

describe('findInconsistencies — edge cases', () => {
  it('finds two different lock-in periods', () => {
    const found = findInconsistencies(
      clausesOf(`
1. LOCK-IN: The Tenant agrees to a lock-in period of eleven (11) months from commencement.

2. SCHEDULE: Notwithstanding the above, the lock-in period of six months shall apply to this tenancy.
`),
    );
    expect(found.find((f) => f.kind === 'lock-in')?.values).toHaveLength(2);
  });

  it('ignores a number word it does not know rather than guessing', () => {
    const found = findInconsistencies(
      clausesOf(`
1. NOTICE: Either party may terminate on umpteen days written notice to the other party.

2. NOTICE AGAIN: Either party may terminate on thirty days written notice to the other party.
`),
    );
    expect(found.find((f) => f.kind === 'notice-period')).toBeUndefined();
  });

  it('matches a two-word place name for jurisdiction', () => {
    const found = findInconsistencies(
      clausesOf(`
1. DISPUTES: The courts at New Delhi shall have exclusive jurisdiction over any dispute hereunder.

2. GOVERNING LAW: The parties submit to the courts at Bengaluru for all purposes whatsoever.
`),
    );
    expect(found.find((f) => f.kind === 'jurisdiction')?.values.map((v) => v.display)).toEqual([
      'New Delhi',
      'Bengaluru',
    ]);
  });

  it('marks a clause with no printed number as having a null label', () => {
    const found = findInconsistencies(
      clausesOf(`
This Agreement provides for thirty days written notice to be given by either party hereunder.

The parties further agree that ninety days written notice shall apply to the Landlord alone.
`),
    );
    const notice = found.find((f) => f.kind === 'notice-period');
    expect(notice).toBeDefined();
    for (const v of notice?.values ?? []) expect(v.clauseLabel).toBeNull();
  });

  it('quotes a span that genuinely exists in the clause it names', () => {
    const clauses = clausesOf(`
1. NOTICE: Either party may terminate on thirty days written notice to the other party.

2. CONFLICT: The Landlord may however act upon seven days written notice at any time.
`);
    for (const finding of findInconsistencies(clauses)) {
      for (const v of finding.values) {
        const source = clauses.find((c) => c.index === v.clauseIndex);
        // Strip the ellipses the quote adds when it is a window into the clause.
        const bare = v.quote.replace(/^…/, '').replace(/…$/, '');
        expect(source?.text).toContain(bare);
      }
    }
  });

  it('treats a rate with no stated period as its own value', () => {
    const found = findInconsistencies(
      clausesOf(`
1. INTEREST: Late payment shall attract interest at 18% on the outstanding sum until paid.

2. PENALTY: A further charge of 24% shall be levied upon continued default by the Tenant.
`),
    );
    expect(found.find((f) => f.kind === 'interest-rate')?.values).toHaveLength(2);
  });
});
