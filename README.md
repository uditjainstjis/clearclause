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

ClearClause gives them **legal information and basic legal assistance about the
document in front of them**: what it obliges them to, what it will cost, what
changed between drafts, what it does and does not say, what to ask before
signing, and where to get help that is not a website.

It stops short of **legal advice**. It will not tell you whether a clause is
enforceable, and it will not decide for you. That line is the brief's own —
_"provide information and assistance, rather than replace professional legal
advice"_ — and here it is enforced in code rather than promised in prose: the
system prompt forbids stating the law, and a test fails the build if the
disclaimer is ever removed.

The distinction matters, because the two halves are routinely confused.
Withholding legal _advice_ protects the reader. Withholding legal _information_
is the status quo that put them in this position — holding a document they are
about to be bound by and cannot read.

## What it does

|                               |                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| **Plain-language rewrite**    | Every clause restated in ordinary English, addressed to you                        |
| **Attention score**           | One number, 0–100, for how much of the document needs your attention               |
| **Clause-by-clause severity** | High / worth checking / know about it / routine — with the quote that justifies it |
| **Obligations & deadlines**   | What you would be agreeing to do, and by when                                      |
| **Questions to ask**          | A sheet you can take to the other party or to a lawyer                             |
| **Tamper detection**          | Warns you when the document contains text written to manipulate an AI reader       |
| **Ask a question**            | Answered only from your document, always with the sentence it came from            |
| **Compare two versions**      | What changed between drafts, and which way each change cuts for you                |
| **Contradiction check**       | Terms the document states two different ways — found without a model               |
| **What you can do about it**  | Concrete things to ask for, derived from the clauses that were flagged             |
| **Where to get help**         | Free legal aid, and which kind of professional handles your document type          |
| **Navigate a long document**  | Filter to what needs attention, or to only what obliges you to something           |

Three modes, one page. The mode selector is a real radio group, so it is
keyboard- and screen-reader-navigable without a line of custom JavaScript.

```
POST /api/analyze   explain a document clause by clause   (streamed, SSE)
POST /api/ask       {text, question} -> answer + verified quote + clauses consulted
POST /api/compare   {a, b} -> aligned differences + which version treats you better
GET  /api/health    liveness; reports limits, never configuration
```

All three document routes share one gate (`guardApi` in `src/index.ts`): a JSON
content-type requirement that closes the CORS simple-request path, a
`Sec-Fetch-Site` check, and a per-IP rate limit applied last so a rejected
cross-site request never spends the visitor's budget.

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

Seven candidates were run against a real punitive lock-in clause under the same
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

| Brief use case                                            | Where                                                                                                |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Simplifying complex legal documents                       | `plain` field per clause — `src/prompts/clause.ts`                                                   |
| **Comparing contracts, agreements or policies**           | `POST /api/compare` — deterministic alignment in `src/lib/align.ts`, verdict in `src/lib/compare.ts` |
| Highlighting important clauses, obligations, risks        | severity + `readFirst()` + `collectObligations()` — `src/lib/risk.ts`                                |
| …**or inconsistencies**                                   | `findInconsistencies()` — `src/lib/consistency.ts`, no model involved                                |
| **Answering questions based on provided legal documents** | `POST /api/ask` — retrieval in `src/lib/retrieve.ts`, grounding in `src/lib/ask.ts`                  |
| Helping users understand options and next steps           | `buildNextSteps()` + the "where to get help" panel — `src/lib/nextsteps.ts`                          |
| Generating summaries, checklists, actionable outputs      | obligations checklist, question sheet, copy-as-Markdown                                              |
| Helping users prepare for a legal professional            | the question sheet, printable and designed to be handed over                                         |
| **Navigating** a long document — the brief's third verb   | filter the clause list by severity, or to only what obliges you — `applyClauseFilter()`              |

All seven are implemented, and the brief's three headline verbs — understand,
compare, navigate — each have a feature behind them. Four are worth a note.

**Comparing** splits the problem in two and gives the model only the half it is
good at. Which clause in the new draft corresponds to which in the old one is
decided by cosine similarity over stemmed term vectors with mutual-best matching
(`src/lib/align.ts`) — so the pairing is reproducible and a model cannot invent
a correspondence. Only pairs that actually differ are sent for explanation, and
the headline verdict is counted, not generated. Two eighty-clause drafts that
differ in three places cost three model calls.

**Answering questions** is extractive and refusable. The clauses to answer from
are chosen by a BM25-style scorer (`src/lib/retrieve.ts`); the answer must carry
a verbatim quote, which is verified before display; and "the document does not
say" is presented as a correct answer rather than a failure. Asked whether a
lock-in clause is enforceable, it declines — that is a question about the law,
and this product does not answer those.

**Options and next steps** are the assistance half, and the half easiest to get
wrong in either direction. Overreach and you are telling someone what the law
entitles them to; skip it and you have handed them a list of problems and no
handle. `src/lib/nextsteps.ts` stays strictly procedural — ask for a cap, ask
for symmetry, ask what happens if — derived in TypeScript from each clause's
severity and its own words, so the suggestions are reproducible and none of them
came from a model. `test/nextsteps.test.ts` fails the build if any step ever
tells the reader what they are _entitled_ to rather than what they can _ask
for_. The analysis then ends by pointing away from itself: free legal aid
through NALSA and the District Legal Services Authorities, and the kind of
professional who handles that document type.

**Inconsistencies** are found deterministically. A contract that sets thirty
days' notice in one clause and ninety in another is the failure a reader is
least equipped to catch, and it needs no model: `src/lib/consistency.ts`
normalises periods, amounts, rates and named forums, and reports any term the
document states two ways. "Sixty days" and "two months" are recognised as the
same; so are "3% per month" and "36% per annum".

The brief's constraint — _"provide information and assistance, rather than
replace professional legal advice"_ — is enforced in three places, not just
promised: a standing disclaimer in the markup outside any conditional region;
explicit prohibitions in the system prompt against stating what the law is or
citing any Act or case; and a test that fails if the disclaimer is removed
(`test/a11y.test.ts`). `test/nextsteps.test.ts` holds the same line on the
assistance side: it fails if any suggested step ever tells the reader what they
are _entitled_ to rather than what they can _ask for_.

### What "Access" actually means here

The theme is Legal Assistance **& Access**, so it is worth being concrete about
who this reaches that the status quo does not.

An advocate's read of a tenancy agreement costs a meaningful fraction of a
month's rent on that same tenancy, and takes days to arrange. That is the
barrier — not the absence of law, but the cost of a first opinion on a document
someone is being asked to sign this week. ClearClause returns the first clause
in about a second and the whole document in under eight, with no sign-up, no
account, and nothing retained but redacted clause fragments for seven days.

It is deployed on Cloudflare's free tier with inference through a Workers AI
binding, so the cost of one more reader is effectively zero — which is the
property that decides whether a thing like this can stay free at the scale the
problem has. And it ends by pointing away from itself: every analysis carries a
panel naming free legal aid through NALSA and the District Legal Services
Authorities, and the kind of professional who handles that document type, with
the question sheet formatted to be handed over on paper.

Three limits on access are open and worth naming: it is English-only, it needs
plain text rather than the PDF most contracts arrive as, and its severity
calibration assumes Indian contracting norms. The first is the one that matters
most, and `docs/ACCESSIBILITY.md` sets out the design for closing it — the
explanation translates, the verified quote stays in the document's own language,
so grounding survives translation.

### Security

A real vulnerability was found in this codebase and fixed, and it is worth
leading with because it is the difference between a documented threat model and
a working one.

`src/lib/redact.ts` matched account numbers with three unbounded whitespace
quantifiers separated by two optional groups. Over a long whitespace run the
engine enumerates every partition of that run across the three — polynomial
backtracking, measured at roughly cubic. It was reachable unauthenticated on all
three POST routes, and `/api/compare` takes two documents, so it doubled.
**Measured: "Account" followed by 4,000 vertical tabs and a sentence — a 4 KB
body, about 3% of the allowed input — burned 11.0 seconds of CPU. After the fix,
0 ms.**

`npm audit` reported zero vulnerabilities throughout, and was right to: the flaw
was ours, not a dependency's. That is exactly the gap between advisory-database
lookup and static analysis, so **CodeQL now runs on every push** with
`security-extended`, whose `js/polynomial-redos` query is the check that finds
this class.

The root cause was not the regex alone. `normalizeDocument` collapsed only
space, tab and NBSP, while the matcher's `\s` also covers vertical tab, form
feed, U+2028 and U+2029 — so those survived normalisation and reached a matcher
written for a wider class. Both halves are fixed, and `test/redact.test.ts` pins
the whole character class against regression.

The security program around it: CodeQL and `npm audit` gate the build,
`dependency-review-action` blocks a vulnerable dependency at the pull request,
Dependabot keeps the tree current so the audit gate stays sustainable, every
GitHub Action is pinned to a commit SHA rather than a mutable tag, workflows run
with `permissions: contents: read` and only CodeQL asks for more, and
[`/.well-known/security.txt`](public/.well-known/security.txt) points at a
private disclosure channel with a stated response SLA and a safe-harbour clause.

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

**330 tests, all passing. 96% statements, 86% branches, 99% functions.**

Nearly all of them run **inside workerd** via `@cloudflare/vitest-pool-workers`
— the same runtime the Worker deploys to — so Cache API, WebCrypto, streams,
HTMLRewriter and Request/Response behave exactly as in production rather than as
Node shims.

The suite is **hermetic**: it holds no credential and makes no network call. The
pool is deliberately not pointed at `wrangler.jsonc`, because Workers AI has no
local implementation and a declared `ai` binding makes miniflare open a proxy to
the real service. Every test builds its own `Env` with a stubbed `AI` instead.
Verified, not assumed: the suite passes with `HOME` set to an empty directory
and every Cloudflare variable unset.

A second project runs in jsdom for the one job workerd cannot do — running
axe-core over a real DOM. See Accessibility below.

| Suite                 | Covers                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `segment.test.ts`     | normalisation, marker families, sub-list grouping, preamble, offsets, oversized clauses     |
| `grounding.test.ts`   | exact match, tolerated variation, **paraphrase rejection**, elision order, span offsets     |
| `redact.test.ts`      | Verhoeff validity, every rule, false-positive resistance, **and ReDoS regression**          |
| `guard.test.ts`       | all 7 injection classes, fence integrity, finding caps                                      |
| `risk.test.ts`        | scoring, **length-independence**, ungrounded exclusion, dedupe, ordering                    |
| `ai.test.ts`          | model-output parsing and the demotion of ungrounded claims                                  |
| `cache.test.ts`       | key determinism, boundary-collision resistance, round-trip                                  |
| `pipeline.test.ts`    | event order, concurrency, clause caps, screening order                                      |
| `api.test.ts`         | routes, validation, headers, streaming, rate limiting, **fallback and total-failure paths** |
| `a11y.test.ts`        | landmarks, labels, ARIA reference integrity, focus order, CSP-compatible markup             |
| `retrieve.test.ts`    | stemmer self-consistency, BM25 ranking, **everyday-word to term-of-art expansion**          |
| `align.test.ts`       | cosine similarity, mutual-best pairing, **survives renumbering**, refuses weak matches      |
| `ask.test.ts`         | question validation, **grounding enforcement**, quote salvage, fallback on unverified cites |
| `compare.test.ts`     | the verdict arithmetic, ungrounded claims excluded from it, difference cap, labels          |
| `consistency.test.ts` | contradiction detection, unit equivalence (60 days ≡ 2 months), silence on consistent docs  |
| `nextsteps.test.ts`   | step derivation, severity gating, **and that no step ever states an entitlement**           |
| `prompts.test.ts`     | fencing of every untrusted input, schema shapes, instruction hierarchy                      |
| `axe.dom.test.ts`     | the real axe engine over the shipped markup, both themes, **with a negative control**       |
| `assets.dom.test.ts`  | font content-addressing, preload/stylesheet agreement, hash matches bytes                   |

### Accessibility

**axe-core 4.13.0 finds 0 violations in both light and dark themes**, across
WCAG 2.0/2.1/2.2 A and AA plus best-practice rules.

That claim is **enforced, not asserted**. `test/axe.dom.test.ts` runs the real
axe engine over the real shipped markup on every `npm test` and in CI, with the
real stylesheet injected — axe ignores hidden elements, so auditing the markup
without its CSS audits a page nobody is served. It carries a negative control
that deliberately breaks the page and fails if axe does not notice, because a
gate that cannot fail proves nothing. Before this existed, axe-core was a
devDependency nothing imported and the number came from a human who ran it once.

Five defects were found and fixed that **axe cannot catch**, because they are
behavioural rather than structural:

| Defect                                                                                                                                                       | Why axe misses it                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| The theme toggle flipped both its label and `aria-pressed`, announcing "Light mode, pressed" while dark mode was on — the opposite of the truth (WCAG 4.1.2) | Both states are individually valid markup |
| Submitting disabled the button the user had just activated, dropping focus to `<body>` before the error alert fired                                          | Focus loss happens at runtime             |
| The polite live region updated once per clause — up to eighty announcements over one run                                                                     | The region is correctly formed            |
| The form error was never associated with the field it described: no `aria-invalid`, and `form-error` absent from `aria-describedby` (WCAG 3.3.1)             | The association is added at runtime       |
| Exceeding the character limit was signalled by red text alone (WCAG 1.4.1)                                                                                   | The colour contrast itself passes         |

Beyond that: severity is never carried by colour alone (glyph + word + colour);
dark mode is authored as its own palette rather than inverted;
`prefers-reduced-motion` is honoured; hit targets are ≥44px; the mode selector
is built from real radios rather than ARIA tabs, so group semantics and
arrow-key navigation come from the platform. Details:
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

- **It gives legal information, not legal advice.** It explains the document in
  front of it and what you can ask for. It will not tell you whether a clause is
  enforceable, or make the decision for you — for that, see the "where to get
  help" panel it produces, which points at free legal aid and at the kind of
  professional who handles your document type.
- **Plain text in, for now.** PDF and DOCX must be pasted as text. This is the
  intake barrier that matters, because a PDF is the form most contracts actually
  arrive in — but extraction that silently drops or reorders a line would
  corrupt the grounding guarantee without anyone noticing, and a wrong quote is
  worse than a missing feature. Client-side extraction, with an explicit "check
  this against your PDF" prompt, is the shape that keeps both.
- **Comparison assumes two versions of one agreement.** Alignment is mutual-best
  and refuses weak matches, so comparing two unrelated documents correctly
  produces a long list of one-sided clauses rather than invented correspondences
  — but the result is not useful, and the explained differences are capped at 40
  so it cannot become expensive either.
- **Question answering is extractive, and its recall is lexical.** The synonym
  table in `src/lib/retrieve.ts` covers the everyday-to-legal vocabulary gap for
  rental, employment and loan agreements. A question phrased in words that
  appear nowhere in the document, and that the table does not bridge, will be
  answered "not addressed" even where a human would connect the two. Measured on
  the shipped rental sample, that is roughly one question in ten.
- **India-first, and English-only.** Calibration assumes Indian contracting
  norms, and the explanation is produced in English. The design for translating
  it is worked out in `docs/ACCESSIBILITY.md` — the explanation translates, the
  verified quote stays in the document's own language so grounding survives —
  and what is missing is measured calibration in a second language, not
  architecture.
- **The model can still be wrong.** Grounding proves a quote is real; it does
  not prove the reasoning about it is sound. The interface is built to send you
  to the clause itself, which is the only real safeguard.
- **The cache is per-colocation**, so hit rates vary by region.

## Licence

MIT — see [LICENSE](LICENSE).
