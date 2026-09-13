# ADR-0004: Aggregate deterministically, not generatively

**Status:** accepted · 2026-09-14

## Context

Having analysed each clause, the document-level outputs — the score, the reading
order, the obligations checklist, the question sheet — could be produced by one
more model call over the whole set. That is one prompt instead of a hundred
lines of TypeScript.

## Decision

All aggregation is pure, deterministic TypeScript in `src/lib/risk.ts`.

## Consequences

The score is the number the user is actually asked to act on. It must be
reproducible, explainable in one sentence, and identical for identical input. A
generative pass would make it none of those, and would add a second place for a
hallucination to enter after grounding had already filtered the first.

The scoring function is `100 · raw / (raw + 25)` where `raw` sums weights of 10
(high) and 4 (medium). It saturates, so no document reaches 100 — there is
always something a reader could still check.

`low` and `info` weigh **zero**. This was a correction, not the initial design:
weighting `low` at 1 made the score a function of document length, so a long
entirely-fair contract scored higher than a short predatory one.
`test/risk.test.ts` now asserts length-independence directly, along with
monotonicity, saturation, and the exclusion of ungrounded findings.

The wider benefit is testability. These are pure functions over plain data, so
they are tested exhaustively with no model in the loop — which is most of why
coverage is high without contrived tests.
