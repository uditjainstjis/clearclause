/**
 * Shared domain types for ClearClause.
 *
 * The vocabulary here is deliberately non-legal: the product explains what a
 * document *says*, it never asserts what the law *is*. See ADR-0002.
 */

/** Severity assigned to a single clause. Never rendered by colour alone (a11y). */
export type RiskLevel = 'high' | 'medium' | 'low' | 'info';

/** Document archetypes we tune segmentation and prompting for. */
export type DocType = 'rental' | 'employment' | 'loan' | 'service' | 'nda' | 'terms' | 'other';

/** A clause as produced by the deterministic segmenter — no AI involved. */
export interface Clause {
  /** Stable index in document order, 0-based. */
  index: number;
  /** Clause number as printed in the document, e.g. "14" or "3.2(b)". */
  label: string | null;
  /** Verbatim clause text, whitespace-normalised but otherwise untouched. */
  text: string;
  /** Character offset of `text` within the normalised source document. */
  start: number;
  end: number;
}

/**
 * A single obligation or deadline extracted from a clause.
 * `quote` must be verifiable against the clause text — see grounding.ts.
 */
export interface Obligation {
  who: 'you' | 'other-party' | 'both';
  what: string;
  when: string | null;
  quote: string;
}

/** The model's analysis of one clause, after grounding verification. */
export interface ClauseAnalysis {
  index: number;
  label: string | null;
  heading: string;
  /** Plain-language restatement, second person, no legalese. */
  plain: string;
  risk: RiskLevel;
  /** Why this matters to the reader, in one or two sentences. */
  why: string;
  /** A question the reader could put to the other party or to a lawyer. */
  ask: string;
  /** Verbatim span from the clause that supports `risk`. */
  quote: string;
  obligations: Obligation[];
  /** Set when `quote` could not be found verbatim in the clause. */
  grounded: boolean;
  /** True when served from cache rather than a fresh model call. */
  cached: boolean;
}

/** One way a contradicted term is stated, with where it was found. */
export interface InconsistentValue {
  /** Normalised for comparison, e.g. days for any period. */
  value: string;
  /** As printed, e.g. "sixty days notice". */
  display: string;
  clauseIndex: number;
  clauseLabel: string | null;
  /** Verbatim span around the match — true by construction, not model output. */
  quote: string;
}

/** A term the document states in more than one way. */
export interface Inconsistency {
  kind: string;
  label: string;
  detail: string;
  values: InconsistentValue[];
}

/** Aggregate view of the whole document. */
export interface DocumentReport {
  docType: DocType;
  clauseCount: number;
  /** 0-100. Higher means more terms that need attention. Not a legal score. */
  riskScore: number;
  counts: Record<RiskLevel, number>;
  /** Clause indices ordered by what to read first. */
  readFirst: number[];
  obligations: Obligation[];
  questions: string[];
  /** Statements the model made that failed verbatim grounding. */
  ungroundedCount: number;
  /** Terms the document contradicts itself on. Found deterministically. */
  inconsistencies: Inconsistency[];
}

/** Result of screening input before it reaches a model. */
export interface GuardResult {
  /** Instruction-like text embedded in the document (a red flag in itself). */
  injectionFindings: InjectionFinding[];
  /** Characters removed or replaced by PII redaction. */
  redactions: number;
}

export interface InjectionFinding {
  /** Short machine-readable reason, e.g. "instruction-override". */
  kind: string;
  /** Human-readable explanation shown to the user. */
  detail: string;
  /** The matched span, truncated for display. */
  excerpt: string;
  offset: number;
}

/**
 * A grounded citation supporting an answer.
 * `quote` is verified verbatim against the cited clause before it is returned.
 */
export interface AnswerCitation {
  clauseIndex: number;
  label: string | null;
  quote: string;
  /** The clause text the quote was verified against, for display. */
  clauseText: string;
}

/** One clause the deterministic retriever selected, shown so the answer is auditable. */
export interface ConsultedClause {
  index: number;
  label: string | null;
  /** Question terms found in this clause. */
  matched: string[];
}

/** Answer to a question asked about a document. */
export interface DocumentAnswer {
  /** Echoed back after redaction, so the UI never re-renders raw user input. */
  question: string;
  /** False when the document does not address the question — a real answer. */
  answered: boolean;
  answer: string;
  /** Null whenever `answered` is false, or when grounding failed. */
  citation: AnswerCitation | null;
  /** Every clause the retriever consulted, in rank order. */
  consulted: ConsultedClause[];
  guard: GuardResult;
  stats: AskStats;
}

export interface AskStats {
  clausesSearched: number;
  clausesConsulted: number;
  modelCalls: number;
  fallbackCalls: number;
  elapsedMs: number;
  cached: boolean;
}

/** How a term changed between two documents, from the reader's point of view. */
export type ChangeDirection = 'better-for-you' | 'worse-for-you' | 'no-material-change';

/** One aligned pair of clauses, or a clause present in only one document. */
export interface ClauseDifference {
  /** Plain-English label for the term being compared, e.g. "Notice period". */
  heading: string;
  kind: 'changed' | 'only-in-a' | 'only-in-b';
  direction: ChangeDirection;
  /** What actually differs, addressed to "you". */
  summary: string;
  /** Verbatim from document A; empty when the clause exists only in B. */
  quoteA: string;
  /** Verbatim from document B; empty when the clause exists only in A. */
  quoteB: string;
  indexA: number | null;
  indexB: number | null;
  /** Deterministic alignment confidence, 0-1. */
  similarity: number;
  /** Set when a quote could not be verified against its source document. */
  grounded: boolean;
}

/** Result of comparing two documents. */
export interface ComparisonReport {
  labelA: string;
  labelB: string;
  differences: ClauseDifference[];
  /** Counts by direction, computed deterministically from `differences`. */
  counts: Record<ChangeDirection, number>;
  /** Which document treats the reader better overall, or null when it is a wash. */
  favours: 'a' | 'b' | null;
  clauseCountA: number;
  clauseCountB: number;
  /** Aligned pairs whose text is identical after normalisation. */
  unchangedCount: number;
  guard: GuardResult;
  stats: RunStats;
}

/** Wire format for a single Server-Sent Event from /api/analyze. */
export type AnalyzeEvent =
  | { type: 'meta'; docType: DocType; clauseCount: number; guard: GuardResult }
  | { type: 'clause'; analysis: ClauseAnalysis }
  | { type: 'report'; report: DocumentReport; stats: RunStats }
  | { type: 'error'; message: string; code: string };

/** Efficiency telemetry surfaced to the user and asserted in tests. */
export interface RunStats {
  clauses: number;
  cacheHits: number;
  modelCalls: number;
  fallbackCalls: number;
  elapsedMs: number;
  /** How many model calls ran at once. Reported so the interface never has to
   *  restate a server-side constant — the cause of a previous copy bug. */
  concurrency: number;
}
