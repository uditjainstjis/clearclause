import { describe, expect, it } from 'vitest';
import { isVerhoeffValid, redactPII } from '../src/lib/redact';
import { normalizeDocument } from '../src/lib/segment';
import { MAX_INPUT_CHARS } from '../src/lib/pipeline';

describe('isVerhoeffValid', () => {
  // 234123412346 is the canonical valid example used in UIDAI documentation.
  it('accepts a number with a correct Verhoeff check digit', () => {
    expect(isVerhoeffValid('234123412346')).toBe(true);
  });

  it('rejects the same number with a corrupted check digit', () => {
    expect(isVerhoeffValid('234123412347')).toBe(false);
  });

  it('rejects anything that is not twelve digits', () => {
    expect(isVerhoeffValid('23412341234')).toBe(false);
    expect(isVerhoeffValid('2341234123466')).toBe(false);
    expect(isVerhoeffValid('23412341234a')).toBe(false);
    expect(isVerhoeffValid('')).toBe(false);
  });
});

describe('redactPII', () => {
  it('redacts a checksum-valid Aadhaar number, spaced or unspaced', () => {
    expect(redactPII('Aadhaar 2341 2341 2346 held').text).toContain('[REDACTED:AADHAAR]');
    expect(redactPII('Aadhaar 234123412346 held').text).toContain('[REDACTED:AADHAAR]');
  });

  it('leaves a twelve-digit money amount alone because it fails the checksum', () => {
    const out = redactPII('The consideration is Rs. 100000000000 payable on completion.');
    expect(out.text).toContain('100000000000');
    expect(out.count).toBe(0);
  });

  it('redacts email addresses', () => {
    const out = redactPII('Notices to tenant.name+legal@example.co.in shall suffice.');
    expect(out.text).toContain('[REDACTED:EMAIL]');
    expect(out.text).not.toContain('example.co.in');
  });

  it('redacts a PAN', () => {
    expect(redactPII('PAN ABCDE1234F on record').text).toContain('[REDACTED:PAN]');
  });

  it('redacts an IFSC code', () => {
    expect(redactPII('Remit to HDFC0001234 branch').text).toContain('[REDACTED:IFSC]');
  });

  it('redacts Indian mobile numbers with or without country code', () => {
    expect(redactPII('Call 9876543210 for access.').text).toContain('[REDACTED:PHONE]');
    expect(redactPII('Call +91 9876543210 for access.').text).toContain('[REDACTED:PHONE]');
  });

  it('does not redact a landline-shaped number starting below 6', () => {
    const out = redactPII('Reference 1234567890 in correspondence.');
    expect(out.text).toContain('1234567890');
  });

  it('redacts a labelled bank account number', () => {
    expect(redactPII('A/c No. 001234567890 with the said bank').text).toContain(
      '[REDACTED:ACCOUNT]',
    );
  });

  it('counts every redaction and groups them by kind', () => {
    const out = redactPII('Mail a@b.co and c@d.co, PAN ABCDE1234F.');
    expect(out.count).toBe(3);
    expect(out.kinds.EMAIL).toBe(2);
    expect(out.kinds.PAN).toBe(1);
  });

  it('leaves ordinary contract prose completely untouched', () => {
    const clause = 'The Licensee shall pay Rs. 38,000 on or before the 5th day of each month.';
    const out = redactPII(clause);
    expect(out.text).toBe(clause);
    expect(out.count).toBe(0);
  });

  it('leaves clause numbering and dates alone', () => {
    const clause = '14.2 On 1st August 2026 the term of eleven (11) months commences.';
    expect(redactPII(clause).count).toBe(0);
  });
});

/**
 * Regression test for an unauthenticated CPU-exhaustion vulnerability.
 *
 * The account-number rule previously used three unbounded whitespace
 * quantifiers separated by two optional groups. Over a long whitespace run the
 * engine enumerates every partition of that run across the three, re-testing
 * the digit class each time - polynomial backtracking, measured at roughly
 * cubic.
 *
 * It was reachable without authentication on /api/analyze, /api/ask and
 * /api/compare. Measured 2026-09-17 before the fix: "Account" followed by 4,000
 * vertical tabs and a trailing sentence - a 4 KB body, about 3% of the allowed
 * input size - took 11.0 seconds of CPU. After the fix, 0 ms.
 *
 * Normalisation did not save it, and that was the root cause rather than the
 * regex alone: normalizeDocument collapsed only space, tab and NBSP, while the
 * matcher's whitespace class also covers vertical tab, form feed, U+2028 and
 * U+2029. Those survived normalisation and reached the matcher. Both halves are
 * fixed, and this test fails if either regresses.
 */
describe('redactPII is not vulnerable to catastrophic backtracking', () => {
  const EXOTIC_WHITESPACE: readonly (readonly [string, string])[] = [
    ['vertical tab', String.fromCharCode(0x0b)],
    ['form feed', String.fromCharCode(0x0c)],
    ['line separator', String.fromCharCode(0x2028)],
    ['paragraph separator', String.fromCharCode(0x2029)],
  ];

  for (const [name, char] of EXOTIC_WHITESPACE) {
    it(`survives a long run of ${name} after an account keyword`, () => {
      const hostile = `Account${char.repeat(4000)}The Tenant shall pay rent of Rs. 38,000.`;
      const started = Date.now();
      redactPII(normalizeDocument(hostile));
      // Before the fix this took about 11,000ms. A generous ceiling still fails
      // loudly if the backtracking ever returns.
      expect(Date.now() - started).toBeLessThan(1000);
    });
  }

  it('survives the same attack at the full input limit', () => {
    const vt = String.fromCharCode(0x0b);
    const hostile = `A/c${vt.repeat(MAX_INPUT_CHARS - 40)}payable 123456789012 now`;
    const started = Date.now();
    redactPII(normalizeDocument(hostile));
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('still redacts every real account-number spelling it used to', () => {
    // The fix must not trade correctness for speed.
    for (const input of [
      'Account No. 123456789012 held',
      'A/c No 98765432101234 held',
      'Account Number: 123456789 held',
      'account no.123456789012 held',
      'A/c  No.  123456789012 held',
    ]) {
      expect(redactPII(input).text, input).toContain('[REDACTED:ACCOUNT]');
    }
  });

  it('normalises every whitespace character its matchers treat as whitespace', () => {
    // The mismatch between what was normalised and what the matcher accepted is
    // what made the attack possible; this pins the two together.
    for (const [, char] of EXOTIC_WHITESPACE) {
      const out = normalizeDocument(`Account${char.repeat(50)}No. 123456789012`);
      expect(out).not.toContain(char);
    }
  });
});
