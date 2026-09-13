import { describe, expect, it } from 'vitest';
import { coerceAnalysis, extractJson } from '../src/lib/ai';
import { clause } from './helpers';

const CLAUSE = clause(
  3,
  'The Licensee shall not vacate the premises before expiry of eleven months, failing which the ' +
    'Security Deposit shall stand forfeited in its entirety.',
);

const GOOD = {
  heading: 'Lock-in period',
  plain: 'You cannot leave before eleven months are up.',
  risk: 'high',
  why: 'You would lose the whole deposit.',
  ask: 'Can the lock-in be shortened?',
  quote: 'the Security Deposit shall stand forfeited in its entirety',
  obligations: [],
};

describe('extractJson', () => {
  it('passes through an object the binding already parsed', () => {
    expect(extractJson({ heading: 'x', risk: 'low' })).toEqual({ heading: 'x', risk: 'low' });
  });

  it('unwraps the binding’s { response } envelope', () => {
    expect(extractJson({ response: { heading: 'x', risk: 'low' } })).toEqual({
      heading: 'x',
      risk: 'low',
    });
  });

  it('parses a JSON string', () => {
    expect(extractJson('{"heading":"x"}')).toEqual({ heading: 'x' });
  });

  it('parses JSON wrapped in a fenced code block', () => {
    expect(extractJson('```json\n{"heading":"x"}\n```')).toEqual({ heading: 'x' });
  });

  it('recovers an object embedded in surrounding prose', () => {
    expect(extractJson('Here is the analysis: {"heading":"x"} Hope that helps.')).toEqual({
      heading: 'x',
    });
  });

  it('returns null for unusable output rather than throwing', () => {
    expect(extractJson('I cannot help with that.')).toBeNull();
    expect(extractJson(null)).toBeNull();
    expect(extractJson(42)).toBeNull();
    expect(extractJson('[1,2,3]')).toBeNull();
  });
});

describe('coerceAnalysis', () => {
  it('accepts a well-formed grounded response', () => {
    const out = coerceAnalysis(GOOD, CLAUSE, false);
    expect(out.risk).toBe('high');
    expect(out.grounded).toBe(true);
    expect(out.index).toBe(3);
    expect(out.label).toBe('4');
    expect(out.cached).toBe(false);
  });

  it('demotes a severe claim whose quote is not in the clause', () => {
    const out = coerceAnalysis(
      { ...GOOD, quote: 'you will be fined one lakh rupees' },
      CLAUSE,
      false,
    );
    expect(out.grounded).toBe(false);
    expect(out.risk).toBe('info');
  });

  it('demotes a severe claim with no quote at all', () => {
    expect(coerceAnalysis({ ...GOOD, quote: '' }, CLAUSE, false).risk).toBe('info');
  });

  it('falls back to info for a severity outside the allowed set', () => {
    expect(coerceAnalysis({ ...GOOD, risk: 'catastrophic' }, CLAUSE, false).risk).toBe('info');
    expect(coerceAnalysis({ ...GOOD, risk: 42 }, CLAUSE, false).risk).toBe('info');
  });

  it('keeps only obligations whose own quotes are grounded', () => {
    const out = coerceAnalysis(
      {
        ...GOOD,
        obligations: [
          { who: 'you', what: 'Stay eleven months', quote: 'shall not vacate the premises' },
          { who: 'you', what: 'Pay a fine', quote: 'pay a fine of one lakh rupees' },
        ],
      },
      CLAUSE,
      false,
    );
    expect(out.obligations).toHaveLength(1);
    expect(out.obligations[0]!.what).toBe('Stay eleven months');
  });

  it('drops all obligations when the clause itself is ungrounded', () => {
    const out = coerceAnalysis(
      {
        ...GOOD,
        quote: 'not in the document at all',
        obligations: [{ who: 'you', what: 'Stay', quote: 'shall not vacate the premises' }],
      },
      CLAUSE,
      false,
    );
    expect(out.obligations).toEqual([]);
  });

  it('normalises an unexpected obligation actor', () => {
    const out = coerceAnalysis(
      {
        ...GOOD,
        obligations: [{ who: 'landlord', what: 'X', quote: 'shall not vacate the premises' }],
      },
      CLAUSE,
      false,
    );
    expect(out.obligations[0]!.who).toBe('you');
  });

  it('caps the number of obligations a single clause can contribute', () => {
    const many = Array.from({ length: 30 }, () => ({
      who: 'you',
      what: `${Math.random()}`,
      quote: 'shall not vacate the premises',
    }));
    expect(
      coerceAnalysis({ ...GOOD, obligations: many }, CLAUSE, false).obligations.length,
    ).toBeLessThanOrEqual(8);
  });

  it('survives missing, null and wrongly typed fields', () => {
    const out = coerceAnalysis({ obligations: 'not an array' }, CLAUSE, false);
    expect(out.heading).toBe('Clause');
    expect(out.risk).toBe('info');
    expect(out.obligations).toEqual([]);
    expect(out.plain).toBe('');
  });

  it('truncates over-long fields rather than passing them through', () => {
    const out = coerceAnalysis({ ...GOOD, plain: 'x'.repeat(5000) }, CLAUSE, false);
    expect(out.plain.length).toBeLessThanOrEqual(1200);
  });

  it('records that a result came from cache', () => {
    expect(coerceAnalysis(GOOD, CLAUSE, true).cached).toBe(true);
  });
});
