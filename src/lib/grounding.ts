/**
 * Verbatim grounding checks.
 *
 * The model is required to support every risk judgement with a quote taken
 * from the clause. This module proves — deterministically, without a second
 * model call — that the quote actually occurs in the source. A claim whose
 * quote cannot be located is marked ungrounded: it is still shown, but demoted
 * and labelled, and it never contributes to the document risk score.
 *
 * This is the difference between "the model says this is risky" and "this
 * specific sentence, which is in your document, is why". See ADR-0003.
 */

export interface Span {
  start: number;
  end: number;
}

export interface GroundingResult {
  grounded: boolean;
  /** Spans in the ORIGINAL source text, suitable for highlighting. */
  spans: Span[];
}

/**
 * Fold text for comparison while retaining a map back to original offsets.
 *
 * Tolerant of the things extraction and generation legitimately change
 * (case, whitespace runs, curly vs straight quotes, dash width) and of nothing
 * else — a reworded quote must still fail.
 */
function fold(text: string): { folded: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let lastWasSpace = true; // leading whitespace is dropped
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        out.push(' ');
        map.push(i);
        lastWasSpace = true;
      }
      continue;
    }
    lastWasSpace = false;
    let c = ch.toLowerCase();
    if (c === '‘' || c === '’' || c === 'ʼ') c = "'";
    else if (c === '“' || c === '”') c = '"';
    else if (c === '–' || c === '—' || c === '−') c = '-';
    out.push(c);
    map.push(i);
  }
  while (out.length && out[out.length - 1] === ' ') {
    out.pop();
    map.pop();
  }
  return { folded: out.join(''), map };
}

/** Quotes may elide text with an ellipsis; each fragment is checked in order. */
const ELLIPSIS = /\s*(?:\.\.\.|…)\s*/;
/** Fragments shorter than this carry no evidential weight. */
const MIN_FRAGMENT_CHARS = 12;

/**
 * Check that `quote` appears verbatim in `source`.
 *
 * @param quote  the span the model claims to be quoting
 * @param source the clause text the quote must come from
 * @returns whether it was found, plus original-text spans for highlighting
 */
export function verifyQuote(quote: string, source: string): GroundingResult {
  const fragments = quote
    .split(ELLIPSIS)
    .map((f) => f.trim())
    .filter(Boolean);
  if (fragments.length === 0) return { grounded: false, spans: [] };

  const { folded, map } = fold(source);
  const spans: Span[] = [];
  let cursor = 0;

  for (const fragment of fragments) {
    const needle = fold(fragment).folded;
    // A one-word "quote" proves nothing; require real evidential length unless
    // the whole quote is a single short fragment the clause genuinely contains.
    if (needle.length < MIN_FRAGMENT_CHARS && fragments.length > 1) continue;
    const at = folded.indexOf(needle, cursor);
    if (at === -1 || needle.length === 0) return { grounded: false, spans: [] };
    const start = map[at];
    const endMapped = map[at + needle.length - 1];
    if (start === undefined || endMapped === undefined) return { grounded: false, spans: [] };
    spans.push({ start, end: endMapped + 1 });
    cursor = at + needle.length;
  }

  return spans.length > 0 ? { grounded: true, spans } : { grounded: false, spans: [] };
}

/**
 * Truncate a quote for display without cutting mid-word.
 *
 * @param quote text to shorten
 * @param max maximum characters to keep
 */
export function truncateQuote(quote: string, max = 240): string {
  if (quote.length <= max) return quote;
  const cut = quote.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
