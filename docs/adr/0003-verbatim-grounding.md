# ADR-0003: Verbatim grounding over model self-assessment

**Status:** accepted · 2026-09-14

## Context

The failure mode that matters is not a clumsy explanation. It is a confident,
fluent, entirely fabricated one — a warning about a penalty clause the document
does not contain. A user cannot distinguish that from a real finding.

The common mitigations are weak. Asking the model for a confidence score asks
the same unreliable process to audit itself. Using a second model to check the
first doubles cost and latency and still produces a probabilistic answer.

## Decision

Require a **verbatim quote** with every judgement, and verify it
**deterministically** — `verifyQuote()` in `src/lib/grounding.ts`, no second
model call.

Verification folds both texts (case, whitespace runs, curly quotes, dash width —
the differences extraction legitimately introduces) while retaining a map back
to original offsets, then requires an exact substring match. Elided quotes are
checked fragment by fragment, in order.

A claim that fails is **demoted to "routine", stripped of its obligations,
excluded from the score, and labelled in the interface**.

## Consequences

The guarantee is precise and worth stating precisely: _every severity shown is
attached to words that are provably in your document_. It is not a guarantee
that the reasoning about those words is correct.

Costs: a correct analysis whose quote drifts by a word is demoted — a false
negative traded for the removal of a class of false positive, which is the right
direction in this domain. Grounding also constrains the prompt, since the model
must be told to copy rather than tidy.

Two properties fall out that were not the original motivation. Ungrounded
answers are never cached, so a bad answer never becomes durable. And the
document score is computed only from grounded findings, so a hallucination
cannot move the headline number.
