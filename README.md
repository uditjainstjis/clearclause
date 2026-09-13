# ClearClause

**Know before you sign.** Paste a rental agreement, job offer or loan document
and get every clause back in plain English — marked by how much attention it
needs, with the exact words from your own document that justify the mark.

**Live:** <https://clearclause.seriouss.workers.dev>

Built for **PromptWars: Virtual (Exclusive Edition)**, theme _AI for Legal
Assistance & Access_.

---

## The problem it addresses

Most people in India sign the most consequential documents of their lives —
tenancy agreements, offer letters, loan papers — without reading them, because
reading them does not help. The words are impenetrable, and the cost of a lawyer
is out of proportion to an ₹38,000-a-month lease.

The gap is not access to law. It is access to _understanding the document in
front of you_. ClearClause closes that gap and stops precisely there: it
explains what your document says, and never tells you what the law is.

## What it does

|                               |                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| **Plain-language rewrite**    | Every clause restated in ordinary English, addressed to you                        |
| **Attention score**           | One number, 0–100, for how much of the document needs your attention               |
| **Clause-by-clause severity** | High / worth checking / know about it / routine — with the quote that justifies it |
| **Obligations & deadlines**   | What you would be agreeing to do, and by when                                      |
| **Questions to ask**          | A sheet you can take to the other party or to a lawyer                             |
| **Tamper detection**          | Warns you when the document contains text written to manipulate an AI reader       |

## Three things that make it more than a wrapper

### 1. Every judgement is grounded in your document's own words

The model must supply a verbatim quote for every severity it assigns.
[`src/lib/grounding.ts`](src/lib/grounding.ts) then **proves** that quote exists
in the clause — deterministically, with no second model call — tolerating only
the differences that extraction legitimately introduces (case, whitespace runs,
curly quotes, dash width) and rejecting paraphrase.

A claim that fails grounding is **demoted to "routine", stripped of its
obligations, excluded from the score, and labelled in the interface**. The
result is the difference between _"the model says this is risky"_ and _"this
specific sentence, which is in your document, is why"_.

### 2. It detects documents that try to manipulate the AI reading them

A PDF can carry text a human never sees — white-on-white, zero-width, or buried
in an annexure — written to steer whatever model reads it.

[`src/lib/guard.ts`](src/lib/guard.ts) screens for seven classes of this
(instruction override, role hijack, verdict steering, suppression, prompt
exfiltration, delimiter injection, concealed characters). Findings are
neutralised **and shown to the user**, because a counterparty that does this has
told you something important about themselves.

Try it: the **"Contract with hidden AI instructions"** sample on the live site.
The embedded text instructs the model to report the agreement as standard and
fair and to stay silent about the indemnity clause. ClearClause flags all seven
passages and rates the document 67/100 anyway.

### 3. The number you are asked to act on is computed, not generated

Aggregation — the score, the ordering, the obligations list, the question sheet
— is pure, deterministic TypeScript in [`src/lib/risk.ts`](src/lib/risk.ts),
never a second generative pass. A number a person is asked to act on should be
reproducible and explainable. See
[ADR-0004](docs/adr/0004-deterministic-aggregation.md).

---

## How it works

```
document text
     │
     ▼
normalise ─────────── src/lib/segment.ts    repair PDF artefacts, one canonical form
     │
     ▼
screen ────────────── src/lib/guard.ts      find text aimed at an AI reader
     │
     ▼
redact ────────────── src/lib/redact.ts     strip Aadhaar / PAN / phone / email / account
     │                                      BEFORE anything leaves the Worker
     ▼
segment ───────────── src/lib/segment.ts    split into clauses, deterministically
     │
     ▼
analyse ───────────── src/lib/ai.ts         10 clauses in flight, cache → primary → fallback
     │                                      each reply fenced, schema-checked, grounded
     ▼
aggregate ─────────── src/lib/risk.ts       pure functions: score, ordering, checklists
     │
     ▼
stream ────────────── src/index.ts          Server-Sent Events, first clause in ~1s
```

Ordering here is a security property, not a style choice: text is normalised,
then screened, then stripped, and only then does any of it reach a model.

## Generative AI: what is used, and where

Everything runs on **Cloudflare Workers AI**, reached through a **binding** —
there is no API key in this repository, in CI, or in the deployed bundle.

| Model                                      | Where                                                                   | Why                                               |
| ------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------- |
| `@cf/meta/llama-4-scout-17b-16e-instruct`  | Primary clause analysis, document-type classification — `src/lib/ai.ts` | Fastest of the candidates and the best calibrated |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Fallback when the primary is unavailable or returns unusable JSON       | Independent family, comparable latency            |

### Model selection was measured, not assumed

Six candidates were run against a real punitive lock-in clause under the same
JSON schema:

| Model                  | Latency  | Outcome                                                     |
| ---------------------- | -------- | ----------------------------------------------------------- |
| **llama-4-scout-17b**  | **3.1s** | **Schema-clean; graded the clause `high`** ✅               |
| llama-3.3-70b-fp8-fast | 3.8s     | Schema-clean ✅ (fallback)                                  |
| mistral-small-3.1-24b  | 3.2s     | Usable                                                      |
| nemotron-3-120b-a12b   | 3.2s     | Graded the same punitive clause `medium` — under-calls risk |
| gpt-oss-120b           | 8.1s     | Verbose, ignored the schema's intent, hit the token limit   |
| qwen3.8-27b            | 23.3s    | Too slow for interactive use                                |

`glm-5.3`, `deepseek-v4-pro` and `kimi-k2.6` return 403 on this account tier.

Full method and figures: [docs/EVALUATION.md](docs/EVALUATION.md).

---

## How this repository meets the evaluation criteria

### Problem Statement Alignment

The brief's own use cases, and where each is implemented:

| Brief use case                                       | Where                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| Simplifying complex legal documents                  | `plain` field per clause — `src/prompts/clause.ts`                    |
| Highlighting important clauses, obligations, risks   | severity + `readFirst()` + `collectObligations()` — `src/lib/risk.ts` |
| Generating summaries, checklists, actionable outputs | obligations checklist, question sheet, copy-as-Markdown               |
| Helping users understand options and next steps      | `ask` field per clause, "Questions worth asking first"                |
| Helping users prepare for a legal professional       | the question sheet is designed to be handed over                      |
| Comparing contracts                                  | _not implemented_ — see [Limitations](#limitations)                   |

The brief's constraint — _"provide information and assistance, rather than
replace professional legal advice"_ — is enforced in three places, not just
promised: a standing disclaimer in the markup outside any conditional region;
explicit prohibitions in the system prompt against stating what the law is,
citing any Act or case, or telling the reader what to do; and a test that fails
if the disclaimer is removed (`test/a11y.test.ts`).

### Security

| Control                                                       | Where                                              |
| ------------------------------------------------------------- | -------------------------------------------------- |
| **No credential exists** — inference via binding, not API key | `wrangler.jsonc`, enforced by a CI secret-scan job |
| Prompt-injection screening, 7 classes                         | `src/lib/guard.ts`                                 |
| Randomised-nonce fencing + control-token defanging            | `fenceUntrusted()`                                 |
| Instruction hierarchy in the system prompt                    | `src/prompts/clause.ts`                            |
| PII redaction before inference, Verhoeff-validated Aadhaar    | `src/lib/redact.ts`                                |
| Model output treated as untrusted; every field validated      | `coerceAnalysis()`                                 |
| No `innerHTML` anywhere in the front end                      | `public/app.js`                                    |
| CSP with no `unsafe-inline` / `unsafe-eval`, + 7 more headers | `src/lib/headers.ts`, `public/_headers`            |
| Per-IP rate limiting on the expensive path                    | `wrangler.jsonc`, `src/index.ts`                   |
| Input size and clause caps                                    | `src/lib/pipeline.ts`                              |
| Errors never leak internals                                   | `src/index.ts`                                     |
| Zero retention — documents never written to disk or database  | by construction                                    |

Full threat model: [SECURITY.md](SECURITY.md).

### Efficiency

- **Streaming.** Results arrive as Server-Sent Events; the first clause lands in
  about a second rather than after the whole document.
- **Bounded concurrency, measured.** 10 clauses in flight. At 6 a fifteen-clause
  agreement took **27.6s**; at 10 it takes **11.9s**.
- **Content-addressed caching.** Analysis is a pure function of (clause text,
  document type, prompt version, model), so it is cached on a SHA-256 of exactly
  those. Contracts repeat heavily between documents. Measured on the live
  deployment: a re-analysis served **9/9 clauses from cache in 0.7s**, against
  ~11s cold — and the hit count is reported to the user, not just claimed.
- **Assets served without invoking the Worker** (`run_worker_first` scoped to
  `/api/*`).
- Only grounded answers are cached, so a bad answer never becomes durable.

### Testing

**176 tests, all passing. 95% statements, 88% branches, 98% functions.**

Tests run **inside workerd** via `@cloudflare/vitest-pool-workers` — the same
runtime the Worker deploys to — so Cache API, WebCrypto, streams and
Request/Response behave exactly as in production rather than as Node shims.

| Suite               | Covers                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `segment.test.ts`   | normalisation, marker families, sub-list grouping, preamble, offsets, oversized clauses     |
| `grounding.test.ts` | exact match, tolerated variation, **paraphrase rejection**, elision order, span offsets     |
| `redact.test.ts`    | Verhoeff validity, every rule, and false-positive resistance on ordinary contract figures   |
| `guard.test.ts`     | all 7 injection classes, fence integrity, finding caps                                      |
| `risk.test.ts`      | scoring, **length-independence**, ungrounded exclusion, dedupe, ordering                    |
| `ai.test.ts`        | model-output parsing and the demotion of ungrounded claims                                  |
| `cache.test.ts`     | key determinism, boundary-collision resistance, round-trip                                  |
| `pipeline.test.ts`  | event order, concurrency, clause caps, screening order                                      |
| `api.test.ts`       | routes, validation, headers, streaming, rate limiting, **fallback and total-failure paths** |
| `a11y.test.ts`      | landmarks, labels, ARIA reference integrity, focus order, CSP-compatible markup             |

### Accessibility

**axe-core 4.13.0 against the live deployment, fully rendered with results
present: 0 violations, 45 passes, 0 incomplete — in both light and dark
themes**, across WCAG 2.0/2.1/2.2 A and AA plus best-practice rules.

Two violations were found and fixed during development: a text token at 4.18:1
(now compliant) and the standing disclaimer sitting outside any landmark.

Beyond the automated pass: severity is never carried by colour alone (glyph +
word + colour); progress is announced through a single polite status region
rather than one announcement per clause; dark mode is authored as its own
palette; `prefers-reduced-motion` is honoured; hit targets are ≥44px. Details:
[docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md).

### Code Quality

TypeScript `strict` with `noUncheckedIndexedAccess`; ESLint on
`strictTypeChecked`; Prettier enforced in CI. Pure logic
(`segment`/`guard`/`redact`/`grounding`/`risk`) is separated from I/O
(`ai`/`cache`/`pipeline`/`index`), which is why it is cheap to test and why
coverage is high without contrived tests. Decisions that a reader would
otherwise have to reverse-engineer are recorded as [ADRs](docs/adr/), and
comments explain _why_, not _what_.

---

## Running it

```bash
npm install
npx wrangler login     # inference uses your Cloudflare account's Workers AI
npm run dev            # http://localhost:8787
```

```bash
npm run check          # typecheck + lint + tests
npm run coverage       # tests with a coverage report
npm run deploy
```

No `.env` file, no API key, nothing to configure.

## Limitations

Stated plainly, because a tool in this domain that oversells itself is worse
than no tool.

- **It is not legal advice, and it does not know the law.** It explains the
  document in front of it. It cannot tell you whether a clause is enforceable.
- **Plain text only.** PDF and DOCX must be pasted as text. Extraction is a
  meaningful engineering problem and doing it badly would silently corrupt the
  grounding guarantee.
- **Contract comparison is not implemented.** The brief lists it; the clause
  alignment it needs is a different problem from the one solved here, and a
  half-built version would be worse than its absence.
- **India-first.** The calibration assumes Indian contracting norms. The
  severity of a term elsewhere may differ.
- **The model can still be wrong.** Grounding proves a quote is real; it does
  not prove the reasoning about it is sound. The interface is built to send you
  to the clause itself, which is the only real safeguard.
- **The cache is per-colocation**, so hit rates vary by region.

## Licence

MIT — see [LICENSE](LICENSE).
