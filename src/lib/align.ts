import { stem, tokenize } from './retrieve';
import type { Clause } from './types';

/**
 * Deterministic clause alignment between two documents.
 *
 * Comparing contracts is really two problems: deciding which clause in the new
 * draft corresponds to which clause in the old one, and explaining how they
 * differ. Only the second needs a model. Doing the first in code is what keeps
 * the comparison honest — a model asked to do both can silently pair unrelated
 * clauses and then write a fluent explanation of a difference that does not
 * exist.
 *
 * Similarity is cosine over stemmed term-frequency vectors, with a bonus when
 * both clauses carry the same printed number. Clause numbering survives most
 * redrafts, so it is strong evidence; it is a bonus rather than a rule because
 * inserting one clause renumbers everything after it, and that must not break
 * the alignment of the clauses that did not change.
 *
 * Matching is mutual-best: a pair is accepted only when each clause is the
 * other's top candidate. That refuses to force a match rather than inventing a
 * weak one, which is the behaviour you want when a clause really was deleted.
 */

/** Below this cosine similarity, two clauses are not the same term. Tuned so a
 *  reworded clause still pairs while two different clauses never do. */
const MIN_SIMILARITY = 0.34;
/** Added to similarity when both clauses print the same number, e.g. "4.2". */
const LABEL_BONUS = 0.12;

/** Stand-in for a clause that tokenised to nothing; scores 0 against anything. */
const EMPTY: ReadonlyMap<string, number> = new Map<string, number>();

function termVector(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    const t = stem(token);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

/** Cosine similarity of two term-frequency vectors, in [0, 1]. */
export function cosine(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  // Iterate the smaller vector; the dot product only needs shared terms.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, count] of small) dot += count * (large.get(term) ?? 0);
  if (dot === 0) return 0;

  let magA = 0;
  for (const v of a.values()) magA += v * v;
  let magB = 0;
  for (const v of b.values()) magB += v * v;
  return dot / Math.sqrt(magA * magB);
}

/** Text compared for the "did anything actually change" test. */
function canonical(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface AlignedPair {
  a: Clause;
  b: Clause;
  similarity: number;
  /** True when the two clauses are word-for-word identical after normalising
   *  case, punctuation and whitespace — no model call needed. */
  identical: boolean;
}

export interface Alignment {
  pairs: AlignedPair[];
  /** Clauses in A with no counterpart in B — removed in the newer document. */
  onlyInA: Clause[];
  /** Clauses in B with no counterpart in A — newly added. */
  onlyInB: Clause[];
}

/**
 * Align the clauses of two documents.
 *
 * @param a clauses of the first document, in document order
 * @param b clauses of the second document, in document order
 * @returns mutual-best pairs plus the unmatched clauses on each side
 */
export function alignClauses(a: readonly Clause[], b: readonly Clause[]): Alignment {
  const vectorsA = a.map((c) => termVector(c.text));
  const vectorsB = b.map((c) => termVector(c.text));

  // Full similarity matrix. Both sides are capped at MAX_CLAUSES upstream, so
  // this is at most 80x80 — small enough that the clarity is worth more than
  // any indexing scheme would save.
  const scores: number[][] = a.map((clauseA, i) =>
    b.map((clauseB, j) => {
      const base = cosine(vectorsA[i] ?? EMPTY, vectorsB[j] ?? EMPTY);
      if (base === 0) return 0;
      const sameLabel =
        clauseA.label !== null && clauseB.label !== null && clauseA.label === clauseB.label;
      return Math.min(1, base + (sameLabel ? LABEL_BONUS : 0));
    }),
  );

  const bestForA = scores.map((row) => {
    let best = -1;
    let bestScore = 0;
    row.forEach((score, j) => {
      if (score > bestScore) {
        bestScore = score;
        best = j;
      }
    });
    return { index: best, score: bestScore };
  });

  const bestForB = b.map((_, j) => {
    let best = -1;
    let bestScore = 0;
    a.forEach((__, i) => {
      const score = scores[i]?.[j] ?? 0;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return { index: best, score: bestScore };
  });

  const pairs: AlignedPair[] = [];
  const matchedA = new Set<number>();
  const matchedB = new Set<number>();

  a.forEach((clauseA, i) => {
    const { index: j, score } = bestForA[i] ?? { index: -1, score: 0 };
    if (j < 0 || score < MIN_SIMILARITY) return;
    // Mutual best, or nothing.
    if (bestForB[j]?.index !== i) return;
    const clauseB = b[j];
    if (!clauseB) return;
    matchedA.add(i);
    matchedB.add(j);
    pairs.push({
      a: clauseA,
      b: clauseB,
      similarity: score,
      identical: canonical(clauseA.text) === canonical(clauseB.text),
    });
  });

  return {
    pairs: pairs.sort((x, y) => x.a.index - y.a.index),
    onlyInA: a.filter((_, i) => !matchedA.has(i)),
    onlyInB: b.filter((_, j) => !matchedB.has(j)),
  };
}
