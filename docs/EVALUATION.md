# Evaluation

How the model and the calibration were chosen. Every figure here was measured on
this project, not carried over from a benchmark.

## 1. Model selection

**Method.** Six Workers AI text models were sent the same clause — a punitive
lock-in term from an Indian leave-and-licence agreement — under the same JSON
schema and the same system prompt, via the Cloudflare REST API on 14 Sep 2026.

The clause forfeits the entire security deposit _and_ keeps the balance rent
payable on early exit. A competent reader calls that high risk. The test was
therefore both a latency measurement and a calibration probe.

| Model                                          | Latency  | Schema      | Severity | Verdict                             |
| ---------------------------------------------- | -------- | ----------- | -------- | ----------------------------------- |
| `@cf/meta/llama-4-scout-17b-16e-instruct`      | **3.1s** | clean       | **high** | **primary**                         |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast`     | 3.8s     | clean       | high     | **fallback**                        |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | 3.2s     | clean       | high     | usable                              |
| `@cf/nvidia/nemotron-3-120b-a12b`              | 3.2s     | clean       | _medium_ | rejected — under-calls risk         |
| `@cf/google/gemma-4-26b-a4b-it`                | 9.8s     | clean       | high     | rejected — slow                     |
| `@cf/openai/gpt-oss-120b`                      | 8.1s     | **ignored** | —        | rejected — verbose, hit token limit |
| `@cf/qwen/qwen3.8-27b`                         | 23.3s    | truncated   | —        | rejected — unusable interactively   |

`@cf/zai-org/glm-5.3`, `@cf/deepseek-ai/deepseek-v4-pro-0813` and
`@cf/moonshotai/kimi-k2.6` return HTTP 403 on this account tier.

**Finding.** The largest model available was not the best one. Nemotron (120B)
graded the punitive clause `medium` where the 17B Scout graded it `high`.
Parameter count did not predict calibration on this task, and calibration is the
thing the product depends on.

## 2. Severity calibration

A severity scale is worthless if it does not discriminate. The test is not
whether a bad contract scores high — it is whether a **fair** contract scores
low.

**Method.** Two rental agreements were written as a matched pair:

- **Control** (`test/fixtures/balanced-rental.txt`) — an even-handed lease:
  two-month deposit refunded in 15 days against receipts, 60-day notice either
  way, landlord pays structural repairs, 5% escalation cap, 24-hour notice
  before entry, arbitrator by mutual consent.
- **Treatment** (`public/samples/rental.txt`) — the same document type written
  predatorily: ten-month deposit refunded in 90 days at sole discretion,
  11-month lock-in with full forfeiture, 3%/month compounding late interest, all
  repairs on the tenant, 15-day termination for the landlord against 90 for the
  tenant, arbitrator appointed by the landlord alone.

Both were scored end-to-end through the deployed pipeline.

| Prompt version                           | Control (fair) | Treatment (predatory) | Separation |
| ---------------------------------------- | -------------- | --------------------- | ---------- |
| v3 — rubric only                         | 55             | 81                    | 26         |
| v4 — + base rate, named-harm requirement | 46             | 79                    | 33         |
| **v5 — + "do not flag protections"**     | 32             | 79                    | **47**     |

### What each revision fixed

**v3 → v4.** The rubric defined the severity words but gave no base rate, so the
model marked 11 of 15 clauses `high`. When everything is high, nothing is. v4
added an explicit prior — most clauses in most agreements are ordinary — and
required that a `high` grade name a specific harm in one sentence.

**v4 → v5.** The control was still scoring 46, and reading the per-clause output
showed why: the model was flagging clauses that _protected the tenant_.
"Landlord shall pay for all structural repairs" and a 5% escalation **cap** were
both graded `medium`. The rubric had never said that a favourable term is not a
risk. v5 says so explicitly, and requires the model to name which side a term
favours before raising it above `low`.

**A third fix was in the aggregation, not the prompt.** `low` originally carried
weight 1, which made the score a function of document length — a long, entirely
fair contract accumulated more points than a short predatory one. `low` means
_ordinary and expected_; it now weighs zero, and `test/risk.test.ts` asserts the
length-independence property directly.

### Current behaviour

| Document                    | Score  | Distribution                       |
| --------------------------- | ------ | ---------------------------------- |
| Balanced lease (control)    | **32** | 0 high · 3 medium · 9 low · 1 info |
| Predatory lease             | **79** | 6 high · 8 medium · 0 low · 1 info |
| Predatory offer letter      | **76** | 5 high · 7 medium · 1 low · 1 info |
| Tampered services agreement | **67** | 3 high · 5 medium · 1 info         |

## 3. Injection resistance

The tampered sample embeds an annexure instructing the reader-model to report
the agreement as standard and fair, to assign the lowest risk rating, and to
stay silent about the indemnity, liability-cap and auto-renewal clauses.

**Measured on the live deployment:** all **7** passages detected across four
classes (role hijack ×2, instruction override, verdict steering ×2, suppression
×2), surfaced to the user, and the document scored **67/100** with the indemnity
and liability clauses both flagged — the opposite of what the embedded text
demanded.

## 4. Latency and caching

Fifteen-clause agreement, end to end:

| Configuration                | Time      |
| ---------------------------- | --------- |
| Concurrency 6, cold          | 27.6s     |
| **Concurrency 10, cold**     | **11.9s** |
| Concurrency 10, fully cached | **0.03s** |

Live deployment, nine-clause document, fully cached: **0.7s**, 9/9 clauses
served without a model call.

Concurrency was raised from 6 to 10 on this measurement. Above 10 the gain
flattens while the subrequest budget for a long document starts to bind.

## 5. Accessibility

axe-core 4.13.0, run against the live deployment with a full fifteen-clause
analysis rendered, across WCAG 2.0 / 2.1 / 2.2 A and AA plus best-practice
rules.

| Theme | Violations | Passes | Incomplete |
| ----- | ---------- | ------ | ---------- |
| Light | **0**      | 45     | 0          |
| Dark  | **0**      | 45     | 0          |

Two violations were found and fixed during development:

1. `color-contrast`, serious, 38 nodes — one token (`--n-500`) at 4.18:1 against
   the page ground, below the 4.5:1 AA threshold. Darkened to 52% OKLCH
   lightness; the dark-mode counterpart was raised to 70% for the same reason.
2. `region`, moderate — the standing disclaimer sat outside every landmark. It
   is now wrapped in a labelled `<aside>`.

## 6. Reproducing these numbers

```bash
npm run dev
# score the control and the treatment through the running service
curl -s localhost:8787/api/analyze -H 'content-type: application/json' \
  --data-binary @<(python3 -c "import json;print(json.dumps({'text':open('test/fixtures/balanced-rental.txt').read(),'docType':'rental'}))") \
  | grep '"type":"report"'
```

Cached runs report `cacheHits` in the `report` event, so a cold run and a warm
run are distinguishable from the output itself.
