import type { Clause, Inconsistency, InconsistentValue } from './types';

/**
 * Deterministic detection of internal contradictions.
 *
 * A contract that says thirty days' notice in clause 6 and ninety days' notice
 * in clause 19 has a problem, and it is exactly the problem a reader is least
 * equipped to spot: both clauses look reasonable alone, and nobody reads a
 * twenty-page agreement holding every number in their head.
 *
 * This is done in code rather than by a model, for the same reason clause
 * alignment is. Contradiction is a claim about the *whole* document, so a model
 * would need the whole document in one context and would have to be trusted to
 * hold it. Here, every finding is a pair of spans that genuinely exist at
 * offsets we can point to. There are no false quotes possible, only false
 * groupings — and a false grouping is visible to the reader the moment they see
 * the two quotes side by side.
 *
 * The trade is recall: this finds contradictions expressed as numbers and named
 * places, which is most of the ones that matter in Indian rental, employment
 * and loan agreements, and misses ones expressed purely in prose.
 */

/** Number words that appear in Indian contract drafting, which spells amounts out. */
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  forty_five: 45,
  fifty: 50,
  sixty: 60,
  ninety: 90,
  hundred: 100,
  'one hundred and eighty': 180,
  'one hundred eighty': 180,
};

const NUMBER_WORD_PATTERN = Object.keys(NUMBER_WORDS)
  .map((w) => w.replace(/_/g, '[- ]'))
  .sort((a, b) => b.length - a.length)
  .join('|');

/** Parse "60", "6,000" or "sixty" into a number. */
function parseAmount(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase().replace(/,/g, '');
  if (/^\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned);
  const word = NUMBER_WORDS[cleaned] ?? NUMBER_WORDS[cleaned.replace(/[- ]/g, '_')];
  return word ?? null;
}

/** Days per unit, so "two months" and "sixty days" compare as equal. */
const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };

interface Rule {
  kind: string;
  /** Shown to the reader as the name of the thing that disagrees. */
  label: string;
  pattern: RegExp;
  /** Turn a match into a comparable value, or null to discard it. */
  extract(match: RegExpMatchArray): { value: number | string; display: string } | null;
}

const NUM = `(\\d[\\d,]*(?:\\.\\d+)?|${NUMBER_WORD_PATTERN})`;

const RULES: readonly Rule[] = [
  {
    kind: 'notice-period',
    label: 'Notice period',
    pattern: new RegExp(
      `${NUM}\\s*\\(?\\s*\\d*\\s*\\)?\\s*(day|week|month)s?'?’?\\s+(?:written\\s+|prior\\s+|clear\\s+)*notice`,
      'gi',
    ),
    extract(m) {
      const n = parseAmount(m[1] ?? '');
      const unit = UNIT_DAYS[(m[2] ?? '').toLowerCase()];
      if (n === null || unit === undefined) return null;
      return { value: n * unit, display: `${m[1]} ${m[2]}${n === 1 ? '' : 's'} notice` };
    },
  },
  {
    kind: 'deposit-amount',
    label: 'Security deposit',
    pattern: new RegExp(
      `deposit\\s+(?:of\\s+)?(?:a\\s+sum\\s+of\\s+)?(?:rs\\.?|inr|₹)\\s*${NUM}`,
      'gi',
    ),
    extract(m) {
      const n = parseAmount(m[1] ?? '');
      return n === null ? null : { value: n, display: `Rs. ${m[1]}` };
    },
  },
  {
    kind: 'interest-rate',
    label: 'Interest rate',
    pattern: new RegExp(
      `${NUM}\\s*(?:%|per\\s*cent|percent)\\s*(?:per\\s*(month|annum|year))?`,
      'gi',
    ),
    extract(m) {
      const n = parseAmount(m[1] ?? '');
      if (n === null) return null;
      const period = (m[2] ?? '').toLowerCase();
      // Annualise so 3% per month and 36% per annum are recognised as the same.
      const annual = period === 'month' ? n * 12 : n;
      return { value: annual, display: `${m[1]}%${period ? ` per ${period}` : ''}` };
    },
  },
  {
    kind: 'lock-in',
    label: 'Lock-in period',
    pattern: new RegExp(
      `lock[- ]?in\\s+(?:period\\s+)?(?:of\\s+)?${NUM}\\s*\\(?\\s*\\d*\\s*\\)?\\s*(day|week|month|year)s?`,
      'gi',
    ),
    extract(m) {
      const n = parseAmount(m[1] ?? '');
      const unit = UNIT_DAYS[(m[2] ?? '').toLowerCase()];
      if (n === null || unit === undefined) return null;
      return { value: n * unit, display: `${m[1]} ${m[2]}${n === 1 ? '' : 's'}` };
    },
  },
  {
    kind: 'jurisdiction',
    label: 'Courts with jurisdiction',
    pattern: /courts?\s+(?:at|in|of)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/g,
    extract(m) {
      const place = (m[1] ?? '').trim();
      return place ? { value: place.toLowerCase(), display: place } : null;
    },
  },
];

/** Longest span of surrounding text quoted as evidence. */
const QUOTE_PADDING = 40;

function quoteAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - QUOTE_PADDING);
  const end = Math.min(text.length, index + length + QUOTE_PADDING);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

/**
 * Find terms the document states more than one way.
 *
 * @param clauses the document's clauses, in order
 * @returns one finding per contradicted term, each carrying every conflicting
 *   value with the clause and quote it came from. Empty when the document is
 *   internally consistent, which is the common case.
 */
export function findInconsistencies(clauses: readonly Clause[]): Inconsistency[] {
  const found: Inconsistency[] = [];

  for (const rule of RULES) {
    const seen: InconsistentValue[] = [];

    for (const clause of clauses) {
      // A fresh regex per clause: these are /g and carry lastIndex.
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
      for (const match of clause.text.matchAll(pattern)) {
        const parsed = rule.extract(match);
        if (parsed === null || match.index === undefined) continue;
        seen.push({
          value: String(parsed.value),
          display: parsed.display,
          clauseIndex: clause.index,
          clauseLabel: clause.label,
          quote: quoteAround(clause.text, match.index, match[0].length),
        });
      }
    }

    // A term stated once, or stated identically several times, is consistent.
    const distinct = new Set(seen.map((s) => s.value));
    if (distinct.size < 2) continue;

    // Report the first occurrence of each distinct value, so a term repeated
    // verbatim in six clauses does not produce six identical rows.
    const byValue = new Map<string, InconsistentValue>();
    for (const item of seen) if (!byValue.has(item.value)) byValue.set(item.value, item);

    const values = [...byValue.values()].sort((x, y) => x.clauseIndex - y.clauseIndex);
    found.push({
      kind: rule.kind,
      label: rule.label,
      detail: `This document states ${rule.label.toLowerCase()} in ${values.length} different ways. Which one governs may matter; it is worth asking before you sign.`,
      values,
    });
  }

  return found;
}
