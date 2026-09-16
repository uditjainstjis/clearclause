import type { Clause } from './types';

/** Clauses shorter than this are merged into the preceding clause. */
const MIN_CLAUSE_CHARS = 25;
/** Oversized clauses are split on paragraph boundaries before analysis. */
const MAX_CLAUSE_CHARS = 6000;

/**
 * Canonicalise a document so that offsets, caching and verbatim quote matching
 * all operate on one stable representation.
 *
 * Deliberately conservative: it fixes artefacts that PDF text extraction
 * introduces, and nothing else. It never reorders, drops or paraphrases text,
 * because downstream grounding checks depend on the text being faithful.
 */
export function normalizeDocument(raw: string): string {
  return (
    raw
      .normalize('NFKC')
      .replace(/\r\n?/g, '\n')
      // Re-join words broken across a line by PDF hyphenation ("termi-\nnation").
      .replace(/([a-z])-\n([a-z])/g, '$1$2')
      // Collapse horizontal whitespace runs, but never touch line structure.
      // Every whitespace character except newline, not just space/tab/NBSP.
      // Downstream rules are written against `\s`, which matches more than the
      // old class did — vertical tab, form feed, U+2028, U+2029 — and a run of
      // those reaching a `\s`-based matcher is what made the account-number
      // rule in redact.ts backtrack catastrophically. Normalise exactly what
      // the matchers treat as whitespace, so the two cannot disagree again.
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * Marker families, most-specific first. Only one family is used to split a
 * given document: mixing them fragments sub-lists away from their parent
 * clause, which loses the context the parent provides.
 */
const MARKER_FAMILIES: { name: string; re: RegExp }[] = [
  {
    name: 'word-headed',
    re: /^(?:ARTICLE|SECTION|CLAUSE|PART|SCHEDULE|ANNEXURE|APPENDIX)\s+(?:[IVXLC]+|\d+(?:\.\d+)*)[.):—-]?\s*/gim,
  },
  { name: 'decimal', re: /^(\d{1,3})[.)]\s+(?=[A-Z"(“])/gm },
  { name: 'dotted', re: /^(\d{1,3}(?:\.\d{1,3})+)[.)]?\s+(?=[A-Z"(“])/gm },
  { name: 'alpha', re: /^\(([a-z])\)\s+(?=[A-Z"(“])/gm },
  { name: 'roman', re: /^\(((?:x|ix|iv|v?i{1,3}))\)\s+(?=[A-Z"(“])/gm },
];

interface Marker {
  start: number;
  label: string | null;
}

function collectMarkers(text: string): Marker[] {
  let best: Marker[] = [];
  for (const family of MARKER_FAMILIES) {
    const found: Marker[] = [];
    family.re.lastIndex = 0;
    for (const m of text.matchAll(family.re)) {
      found.push({ start: m.index, label: (m[1] ?? m[0]).trim().replace(/[.):—-]+$/, '') || null });
    }
    // First family with a real structure wins; families are ordered by how
    // strongly they indicate a top-level clause boundary.
    if (found.length >= 2) {
      best = found;
      break;
    }
    if (found.length > best.length) best = found;
  }
  return best;
}

/** Split a clause that is too large for one model call, on paragraph breaks. */
function splitOversized(text: string, start: number): { text: string; start: number }[] {
  if (text.length <= MAX_CLAUSE_CHARS) return [{ text, start }];
  const parts: { text: string; start: number }[] = [];
  let buf = '';
  let bufStart = start;
  let cursor = start;
  for (const para of text.split(/\n\n/)) {
    const chunk = para + '\n\n';
    if (buf && buf.length + chunk.length > MAX_CLAUSE_CHARS) {
      parts.push({ text: buf.trim(), start: bufStart });
      buf = '';
      bufStart = cursor;
    }
    buf += chunk;
    cursor += chunk.length;
  }
  if (buf.trim()) parts.push({ text: buf.trim(), start: bufStart });
  return parts;
}

/**
 * Split a normalised document into clauses.
 *
 * Falls back to blank-line paragraph splitting when the document carries no
 * numbering at all, so scanned letters and plain-text agreements still work.
 *
 * @param normalized output of {@link normalizeDocument}
 * @returns clauses in document order with offsets into `normalized`
 */
export function segmentClauses(normalized: string): Clause[] {
  if (!normalized.trim()) return [];

  const markers = collectMarkers(normalized);
  const spans: { text: string; start: number; label: string | null }[] = [];

  const first = markers[0];
  if (markers.length >= 2 && first) {
    // Any preamble before the first marker is kept — recitals live there.
    if (first.start > MIN_CLAUSE_CHARS) {
      spans.push({ text: normalized.slice(0, first.start).trim(), start: 0, label: null });
    }
    markers.forEach((marker, i) => {
      const end = markers[i + 1]?.start ?? normalized.length;
      spans.push({
        text: normalized.slice(marker.start, end).trim(),
        start: marker.start,
        label: marker.label,
      });
    });
  } else {
    let cursor = 0;
    for (const para of normalized.split(/\n\n+/)) {
      const start = normalized.indexOf(para, cursor);
      spans.push({ text: para.trim(), start: start < 0 ? cursor : start, label: null });
      cursor = (start < 0 ? cursor : start) + para.length;
    }
  }

  // Merge fragments, then break up anything oversized.
  const merged: typeof spans = [];
  for (const span of spans) {
    if (!span.text) continue;
    const prev = merged[merged.length - 1];
    if (prev && span.text.length < MIN_CLAUSE_CHARS) {
      prev.text = `${prev.text}\n${span.text}`;
      continue;
    }
    merged.push({ ...span });
  }

  const clauses: Clause[] = [];
  for (const span of merged) {
    for (const piece of splitOversized(span.text, span.start)) {
      clauses.push({
        index: clauses.length,
        label: clauses.length === 0 || piece.start === span.start ? span.label : null,
        text: piece.text,
        start: piece.start,
        end: piece.start + piece.text.length,
      });
    }
  }
  return clauses;
}
