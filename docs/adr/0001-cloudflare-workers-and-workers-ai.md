# ADR-0001: Cloudflare Workers with Workers AI

**Status:** accepted · 2026-09-14

## Context

The service needs to run inference on user-supplied documents, be publicly
reachable, and be inspectable by a reviewer who will clone the repository and
run it without being handed any credentials.

## Decision

Deploy as a single Cloudflare Worker, with inference through the **Workers AI
binding** rather than any hosted model API.

## Consequences

**The decisive property is that a binding is not a credential.** There is no API
key in the repository, in CI, in environment variables, or in the deployed
bundle — so there is nothing to leak, rotate, or accidentally commit. A whole
class of vulnerability is removed by construction rather than by discipline. A
CI job asserts it stays that way.

Also gained: no cold start on a warm path; static assets served from the edge
without invoking the Worker; the Cache API available with no additional binding;
and a test runtime (`workerd` via `@cloudflare/vitest-pool-workers`) that is
literally the production runtime.

Given up: model choice is limited to what Workers AI hosts — and on this account
tier several of the strongest models return 403 (see
[EVALUATION.md](../EVALUATION.md)). A frontier model would likely produce better
legal-text reasoning. That was judged the right trade for a service whose main
risk is credential handling and whose analysis quality is bounded more by
calibration than by raw model capability — a claim the prompt-revision
measurements support.
