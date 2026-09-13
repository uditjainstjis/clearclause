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
  { kind: 'ACCOUNT', re: /\b(?:A\/c|Account)\s*(?:No\.?|Number)?\s*:?\s*(\d{9,18})\b/gi },
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
