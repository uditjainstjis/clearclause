# ADR-0002: Document-grounded legal information, not legal advice

**Status:** accepted · 2026-09-14

## Context

The obvious product is bigger than the one built: describe the user's situation,
map it to their rights, name the forum, draft the notice. That is also the
product most likely to hurt someone.

A language model asked what the law is will answer fluently and, some fraction
of the time, wrongly — inventing a section number, mis-stating a limitation
period, or asserting that a clause is unenforceable when it is not. The user has
no way to tell the difference, and in this domain acting on a wrong answer has
consequences measured in money and housing.

## Decision

ClearClause explains **the document in front of the user** and nothing else. It
never states what the law is, cites an Act, section or case, or claims a clause
is legal, illegal, void or unenforceable. It does not tell the reader what to
do.

## Consequences

This is enforced in four places rather than promised in one:

1. Explicit prohibitions in the system prompt (`src/prompts/clause.ts`).
2. The grounding requirement — every judgement must quote the user's own
   document, and a statement about the law cannot be grounded in a document that
   does not contain it.
3. A standing disclaimer in the markup, outside any conditional region, so it
   cannot fail to render.
4. A test that fails if the disclaimer is removed.

This is not a reduction in scope, it is where the scope becomes defensible.
Every claim the product makes is checkable by the reader against a document they
already hold — which is the only verification an unrepresented person actually
has. A tool that told them what the law is would be asking for trust they have
no way to test, from a model that can be confidently wrong, on the decision
where being wrong costs the most.

So the product covers the brief's full first half — legal _information_ and
basic assistance, made accessible — and declines only the half the brief itself
says not to replace.

The vocabulary follows: the headline number is "needs your attention", not a
"legal risk score", and clause severities are phrased as attention levels.
