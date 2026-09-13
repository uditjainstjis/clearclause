import { describe, expect, it } from 'vitest';
import { isVerhoeffValid, redactPII } from '../src/lib/redact';

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
