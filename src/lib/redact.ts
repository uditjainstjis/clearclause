/**
 * PII redaction applied *before* any document text reaches a model.
 *
 * Rationale: a tenancy agreement or offer letter carries identifiers that the
 * analysis never needs — Aadhaar, PAN, bank accounts, phone numbers. Removing
 * them at the boundary means they are never transmitted to the inference
 * provider and never written into the analysis cache. See SECURITY.md.
 *
 * Every pattern is deliberately narrow. Over-redaction would corrupt the
 * verbatim quotes that grounding.ts depends on, so a missed match is preferred
 * to a false positive on ordinary contract numbers.
 */

export interface RedactionRule {
  kind: string;
  re: RegExp;
}

/** Verhoeff checksum — the algorithm Aadhaar numbers are issued with. */
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/**
 * @returns true when `digits` passes the Verhoeff check used by UIDAI.
 *   Guards against redacting ordinary 12-digit figures such as amounts.
 */
export function isVerhoeffValid(digits: string): boolean {
  if (!/^\d{12}$/.test(digits)) return false;
  let c = 0;
  const reversed = digits.split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    const row = D[c];
    const perm = P[i % 8];
    if (!row || !perm) return false;
    c = row[perm[Number(reversed[i])] as number] as number;
  }
  return c === 0;
}

const RULES: RedactionRule[] = [
  { kind: 'EMAIL', re: /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g },
  { kind: 'PAN', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  { kind: 'IFSC', re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
  { kind: 'PHONE', re: /(?:\+91[\s-]?)?\b[6-9]\d{9}\b/g },
  // Bounded `[ \t]{0,4}` rather than `\s*`, and deliberately not `\s`.
  //
  // The previous form had three unbounded `\s*` separated by two optional
  // groups. Over a long whitespace run the engine enumerates every way of
  // splitting that run across the three quantifiers, re-testing `\d{9,18}`
  // each time — polynomial backtracking, measured at roughly cubic.
  //
  // It was reachable unauthenticated on all three POST routes. Measured
  // 2026-09-17: "Account" followed by 4,000 vertical-tab characters and a
  // trailing sentence — a 4 KB body, about 3% of MAX_INPUT_CHARS — burned
  // 11.0s of CPU here, against 0ms for this form. /api/compare takes two
  // documents, so it doubled.
  //
  // Normalisation alone did not save it: normalizeDocument collapsed only
  // [ \t\u00a0], while `\s` also matches VT, FF, U+2028 and U+2029, which
  // survived. That mismatch between what is normalised and what is matched is
  // the actual root cause, and segment.ts now closes the other half of it.
  {
    kind: 'ACCOUNT',
    re: /\b(?:A\/c|Account)[ \t]{0,4}(?:No\.?|Number)?[ \t]{0,4}:?[ \t]{0,4}(\d{9,18})\b/gi,
  },
];

export interface RedactionResult {
  text: string;
  count: number;
  kinds: Record<string, number>;
}

/**
 * Replace direct identifiers with typed placeholders.
 *
 * Placeholders keep roughly the shape of the original so clause readability
 * and character offsets stay sane for the reader.
 */
export function redactPII(text: string): RedactionResult {
  const kinds: Record<string, number> = {};
  let count = 0;
  let out = text;

  // Aadhaar first: checksum-validated, so it cannot be confused with money.
  out = out.replace(/\b(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})\b/g, (match, a, b, c) => {
    if (!isVerhoeffValid(`${a}${b}${c}`)) return match;
    count++;
    kinds.AADHAAR = (kinds.AADHAAR ?? 0) + 1;
    return '[REDACTED:AADHAAR]';
  });

  for (const rule of RULES) {
    out = out.replace(rule.re, () => {
      count++;
      kinds[rule.kind] = (kinds[rule.kind] ?? 0) + 1;
      return `[REDACTED:${rule.kind}]`;
    });
  }

  return { text: out, count, kinds };
}
