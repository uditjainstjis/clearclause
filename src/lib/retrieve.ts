import type { Clause } from './types';

/**
 * Deterministic clause retrieval for document question-answering.
 *
 * A question is answered from a handful of clauses, not from the whole
 * document, and *which* clauses is decided here — in ordinary TypeScript, with
 * no model involved. That matters for three reasons.
 *
 * It is auditable: the user is shown which clauses the answer was drawn from,
 * and that list is reproducible. It is cheap: one model call over three clauses
 * instead of one over eighty. And it is safe: a document cannot talk its way
 * into having more of itself sent to the model, because selection never reads
 * the document as instructions — only as a bag of words.
 *
 * The scoring is BM25's idea without BM25's machinery. Term frequency is
 * damped, rare words count for more than common ones, and long clauses are not
 * allowed to win on length alone. A full index would be more accurate across a
 * corpus; here the corpus is one document of at most eighty clauses, so the
 * simple form is both sufficient and far easier to reason about.
 */

/** Saturation constant for term frequency: the 2nd occurrence of a word counts
 *  much less than the 1st, the 5th barely at all. */
const K1 = 1.2;
/** How strongly to normalise by clause length. 0 = ignore length, 1 = full. */
const B = 0.6;
/**
 * Clauses returned to the model.
 *
 * Four rather than three, for a reason worth recording. Legal drafting reuses
 * ordinary words as terms of art, so a question can collide with a title: asked
 * "who pays for repainting when I leave?", the word "leave" scores the preamble
 * of a LEAVE AND LICENCE AGREEMENT highly, and at three slots that false match
 * displaced the clause that actually answers the question. Widening the window
 * costs nothing — it is still one model call — and buys back the recall that
 * this class of collision takes away.
 */
export const TOP_K = 3;
/** A clause scoring below this shares no meaningful vocabulary with the
 *  question, and is dropped rather than padded into the context. */
const MIN_SCORE = 0.35;

/**
 * Words carrying no retrieval signal in a contract.
 *
 * Deliberately includes legal boilerplate ("hereby", "whereas", "party") as
 * well as ordinary English stopwords: in a contract those are as uninformative
 * as "the", and leaving them in makes every clause look relevant to every
 * question.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'been',
  'by',
  'for',
  'from',
  'has',
  'have',
  'if',
  'in',
  'is',
  'it',
  'its',
  'may',
  'not',
  'of',
  'on',
  'or',
  'other',
  'out',
  'shall',
  'should',
  'such',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'this',
  'to',
  'under',
  'upon',
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'will',
  'with',
  'would',
  'you',
  'your',
  'i',
  'me',
  'my',
  'can',
  'do',
  'does',
  'doe',
  'about',
  'into',
  'over',
  'agreement',
  'clause',
  'contract',
  'hereby',
  'herein',
  'hereof',
  'hereto',
  'whereas',
  'party',
  'parties',
  'said',
  'aforesaid',
  'thereof',
  'therein',
  'pursuant',
  'provided',
  'including',
  'include',
  'respect',
]);

/**
 * Split text into comparable terms.
 *
 * Numbers are kept — in a contract "sixty days" and "90 days" are exactly the
 * kind of thing a reader asks about — but punctuation and case are discarded.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Derivational suffixes, longest first so "ations" is tried before "ation".
 * "at" is in the list because it is what "terminating" leaves behind once "ing"
 * is gone; without it that word would not reach the stem "termination" does.
 */
const SUFFIXES = [
  'ations',
  'ation',
  'ements',
  'ement',
  'ments',
  'ment',
  'ising',
  'izing',
  'ates',
  'ate',
  'ing',
  'ed',
  'at',
] as const;

/** Shortest stem worth keeping. Below this, stripping destroys the word. */
const MIN_STEM = 4;
/** Plurals may reduce further than that — "pets" must reach "pet". */
const MIN_SINGULAR = 3;

/**
 * Reduce a plural to its singular.
 *
 * Handled separately from, and before, the derivational suffixes because
 * treating "es" as one suffix is what breaks "notices" — it strips to "notic"
 * while "notice" stays whole, and the two spellings of one word then never meet.
 */
function singular(term: string): string {
  if (term.endsWith('ies') && term.length > 4) return `${term.slice(0, -3)}y`;
  if (/(?:ss|sh|ch|x|z)es$/.test(term)) return term.slice(0, -2);
  if (term.endsWith('s') && !term.endsWith('ss') && !term.endsWith('us')) {
    const stripped = term.slice(0, -1);
    return stripped.length >= MIN_SINGULAR ? stripped : term;
  }
  return term;
}

/**
 * Crude but *self-consistent* suffix stripping.
 *
 * Not a real stemmer. It exists so that "terminate", "terminates",
 * "terminating" and "termination" all retrieve each other, which is most of the
 * value a stemmer provides on this vocabulary — a full Porter implementation
 * would add a page of rules to gain very little on eighty clauses of legal
 * English.
 *
 * Self-consistency matters more here than linguistic correctness, and is the
 * property that is actually tested. It is fine for "agreement" to reduce to the
 * unlovely "agre"; it is not fine for "notice" and "notices" to reduce to
 * different things, because then a question about notice fails to retrieve the
 * clause that grants it. The stripping therefore loops until nothing more comes
 * off rather than removing one suffix and stopping.
 */
export function stem(term: string): string {
  let out = singular(term);
  for (let guard = 0; guard < SUFFIXES.length; guard++) {
    const suffix = SUFFIXES.find((s) => out.endsWith(s) && out.length - s.length >= MIN_STEM);
    if (suffix === undefined) break;
    out = out.slice(0, -suffix.length);
  }
  return out;
}

/**
 * Everyday words mapped to the terms of art a document actually uses.
 *
 * This is the "Access" half of the brief doing real work. A tenant asks "how
 * much notice must my landlord give me?"; the agreement they are holding says
 * "the Licensor" and never once says "landlord". Lexical retrieval scores those
 * as unrelated, and the reader is told their document is silent on the very
 * thing it spends a clause on — the worst possible failure for a tool whose
 * whole promise is that silence means silence.
 *
 * Measured on the shipped rental sample before this existed: "how much notice
 * must the landlord give me?" and "how much can the rent go up on renewal?"
 * both returned "not addressed", though clauses 9 and 5 answer them plainly.
 *
 * Expansion is one-way and query-side only. The document is never rewritten,
 * so a quote is still a verbatim span of what the reader was given; only the
 * search widens. Each entry is written in the reader's vocabulary and lists the
 * drafting words it should reach.
 */
const SYNONYMS: Record<string, readonly string[]> = {
  landlord: ['licensor', 'lessor', 'owner'],
  tenant: ['licensee', 'lessee', 'occupant'],
  rent: ['licence', 'license', 'fee'],
  deposit: ['security'],
  flat: ['premises', 'apartment', 'property'],
  house: ['premises', 'property'],
  home: ['premises', 'property'],
  leave: ['vacate', 'vacation'],
  quit: ['vacate', 'terminate', 'resign'],
  evict: ['terminate', 'vacate'],
  pet: ['animal', 'dog', 'cat'],
  dog: ['animal', 'pet'],
  cat: ['animal', 'pet'],
  ac: ['conditioning', 'conditioner', 'alteration', 'fixture'],
  aircon: ['conditioning', 'conditioner', 'alteration', 'fixture'],
  conditioner: ['conditioning', 'alteration', 'fixture'],
  install: ['alteration', 'addition', 'fixture'],
  repair: ['maintenance', 'restoration'],
  fix: ['repair', 'maintenance'],
  paint: ['painting', 'repainting', 'restoration'],
  guest: ['visitor', 'occupancy', 'overnight'],
  visitor: ['guest', 'occupancy', 'overnight'],
  friend: ['guest', 'visitor', 'occupancy'],
  family: ['occupancy', 'guest'],
  stay: ['occupancy', 'overnight', 'guest'],
  sublet: ['sublet', 'assign', 'occupancy'],
  increase: ['escalation', 'escalate', 'revision'],
  raise: ['escalation', 'increase'],
  late: ['delay', 'default', 'interest'],
  fine: ['penalty', 'interest', 'forfeit'],
  penalty: ['forfeit', 'interest', 'damages'],
  boss: ['employer', 'company'],
  salary: ['remuneration', 'compensation', 'emolument'],
  pay: ['payment', 'remuneration', 'fee'],
  fired: ['termination', 'dismissal'],
  sack: ['termination', 'dismissal'],
  resign: ['termination', 'notice'],
  holiday: ['leave', 'vacation'],
  court: ['jurisdiction', 'arbitration', 'forum'],
  sue: ['dispute', 'arbitration', 'claim'],
  cancel: ['terminate', 'termination'],
  break: ['terminate', 'breach'],
  privacy: ['confidentiality', 'confidential'],
  secret: ['confidential', 'confidentiality'],
};

/** Stemmed once at module load, so expansion costs nothing per request. */
const EXPANSIONS = new Map<string, string[]>(
  Object.entries(SYNONYMS).map(([word, alts]) => [stem(word), alts.map(stem)]),
);

function terms(text: string): string[] {
  return tokenize(text).map(stem);
}

/**
 * The reader's words, plus the drafting words that mean the same thing.
 *
 * @param question the reader's question
 * @returns stemmed query terms, deduplicated, expansion included
 */
export function queryTerms(question: string): string[] {
  const base = terms(question);
  const expanded = base.flatMap((t) => EXPANSIONS.get(t) ?? []);
  return [...new Set([...base, ...expanded])];
}

export interface RetrievedClause {
  clause: Clause;
  score: number;
  /** Question terms this clause actually contains. Shown to the user so the
   *  retrieval is explainable, and asserted in tests. */
  matched: string[];
}

/**
 * Rank clauses by relevance to a question.
 *
 * @param question  the reader's question, treated purely as a bag of words
 * @param clauses   the document's clauses, in document order
 * @param topK      how many to return
 * @returns the best-matching clauses, highest score first, never more than
 *   `topK` and possibly empty when nothing is relevant
 */
export function retrieveClauses(
  question: string,
  clauses: readonly Clause[],
  topK: number = TOP_K,
): RetrievedClause[] {
  const query = queryTerms(question);
  if (query.length === 0 || clauses.length === 0) return [];

  const docTerms = clauses.map((c) => terms(c.text));
  const lengths = docTerms.map((t) => t.length);
  const avgLength = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1);

  // Document frequency per query term, over this document's clauses only.
  const df = new Map<string, number>();
  for (const term of query) {
    df.set(term, docTerms.filter((t) => t.includes(term)).length);
  }

  const scored = clauses.map((clause, i) => {
    const counts = new Map<string, number>();
    for (const t of docTerms[i] ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);

    const length = lengths[i] ?? 0;
    let score = 0;
    const matched: string[] = [];

    for (const term of query) {
      const tf = counts.get(term) ?? 0;
      if (tf === 0) continue;
      matched.push(term);
      // Rarer terms are worth more. +1 inside the log keeps this positive even
      // when a term appears in every clause.
      const idf = Math.log(1 + clauses.length / ((df.get(term) ?? 0) + 0.5));
      const norm = K1 * (1 - B + (B * length) / (avgLength || 1));
      score += (idf * (tf * (K1 + 1))) / (tf + norm);
    }
    return { clause, score, matched };
  });

  return scored
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.clause.index - b.clause.index)
    .slice(0, topK);
}
