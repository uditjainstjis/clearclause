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

## 5. Question answering: four measured changes

Measured against `public/samples/rental.txt` — a fifteen-clause Bengaluru leave
and licence agreement — using ten questions the document plainly answers and two
it does not. "Answered" means the reply carried a quote that passed verbatim
verification. Each row adds to the row above it.

| Change                                      | Answered | Correctly refused |
| ------------------------------------------- | -------- | ----------------- |
| Starting point                              | 1/6      | 2/2               |
| `max_tokens` 700 → 1600                     | 2/6      | 2/2               |
| Salvage a genuine quote from a chatty reply | 5/8      | 2/2               |
| Expand everyday words to terms of art       | **8/10** | **2/2**           |

The refusals never regressed, which is the number that mattered most: a change
that buys recall by loosening grounding would be a loss, not a gain.

**`max_tokens`.** At 700 the reply was truncated mid-JSON for every question
whose answer lived in a long clause — repainting, lock-in, alterations. From the
outside this is indistinguishable from a model declining to answer, which is why
it survived so long: the failure wore the costume of correct behaviour.

**Quote salvage.** The remaining failures were not hallucinations. Asked how
long the lock-in ran, the model returned clause 4 word for word and then kept
going inside the quote field: _"The lock-in period is also mentioned as eleven
(11) months in clause 1 … hence quoting it. Hence the quote is from: 4. LOCK-IN
PERIOD: …"_. Verification correctly rejected the whole string. `salvageQuote()`
keeps the longest run of consecutive sentences that verifies, so a chatty model
loses its commentary rather than its answer — and what is shown is still a
verbatim span, because it is still checked.

**Vocabulary.** The last failures were the reader and the document using
different words for the same thing. "How much notice must the landlord give me?"
returned _not addressed_ against an agreement whose clause 9 answers it, because
the document says "the Licensor" and never once says "landlord". Query-side
synonym expansion fixed that, plus rent/licence fee and air conditioner/
alteration. The document is never rewritten, so quotes stay verbatim.

| Question                                       | Before        | After             |
| ---------------------------------------------- | ------------- | ----------------- |
| How much notice must the **landlord** give me? | not addressed | clause 9, quoted  |
| How much can the **rent** go up on renewal?    | not addressed | clause 5, quoted  |
| Can I install an **air conditioner**?          | not addressed | clause 10, quoted |

**What still misses.** Roughly one question in five. The residue is lexical: a
question whose words appear nowhere in the document and that the synonym table
does not bridge. The failure mode is a refusal, not a wrong answer, which is the
right way for this to fail.

## 6. Comparison

Measured against `rental.txt` and `rental-revised.txt` — the same agreement
after a round of negotiation.

| Metric                                 | Value                                                 |
| -------------------------------------- | ----------------------------------------------------- |
| Clauses, original / revised            | 15 / 15                                               |
| Aligned pairs identical, no model call | 1                                                     |
| Differences explained                  | 15                                                    |
| Grounded on both sides                 | 14 / 15                                               |
| Model calls                            | 15 (+3 fallback)                                      |
| Wall clock                             | 26.7 s                                                |
| Verdict                                | revised draft favours the reader, 11 better / 2 worse |

The alignment survives renumbering: the revised draft drops the repainting
clause, so clauses 8 onward shift by one, and the aligner still pairs
maintenance with maintenance because pairing is cosine similarity over clause
text, not clause number.

## 7. Accessibility

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

**The number is now enforced rather than recorded.** `test/axe.dom.test.ts` runs
the same engine over the shipped markup on every `npm test` and in CI, with the
stylesheet injected so hidden elements stay hidden, and carries a negative
control that fails if a deliberately broken page passes. Before that test
existed, `axe-core` was a devDependency nothing imported: the table above was
true and unprotected, and any later commit could have falsified it silently.

### Five defects axe cannot catch

Found by reading the code against the behaviour, not by the scanner. Each is
runtime behaviour over well-formed markup, which is precisely the blind spot of
a static audit.

| Defect                                                                                                       | WCAG  | Fix                                                            |
| ------------------------------------------------------------------------------------------------------------ | ----- | -------------------------------------------------------------- |
| Theme toggle flipped both its visible label and `aria-pressed`, so dark mode announced "Light mode, pressed" | 4.1.2 | State lives on `aria-pressed` only; the label names the action |
| Submit disabled the button the user had just pressed, dropping focus to `<body>` before the alert fired      | 2.4.3 | `aria-disabled` plus an early return, so focus never moves     |
| The polite live region was updated once per clause — up to 80 announcements                                  | 4.1.3 | Announce at quartiles and on completion                        |
| Form error never associated with its field: no `aria-invalid`, `form-error` absent from `aria-describedby`   | 3.3.1 | Both set on error, both cleared on recovery                    |
| Over-limit signalled by red text alone                                                                       | 1.4.1 | The counter says "over the 120,000 limit" in words             |

## 8. Reproducing these numbers

```bash
npm run dev
# score the control and the treatment through the running service
curl -s localhost:8787/api/analyze -H 'content-type: application/json' \
  --data-binary @<(python3 -c "import json;print(json.dumps({'text':open('test/fixtures/balanced-rental.txt').read(),'docType':'rental'}))") \
  | grep '"type":"report"'
```

Cached runs report `cacheHits` in the `report` event, so a cold run and a warm
run are distinguishable from the output itself.

The question-answering and comparison figures come from the live deployment:

```bash
# one question, against the shipped sample
curl -s https://clearclause.seriouss.workers.dev/api/ask \
  -H 'content-type: application/json' -H 'sec-fetch-site: same-origin' \
  --data-binary @<(python3 -c "import json;print(json.dumps({'text':open('public/samples/rental.txt').read(),'question':'how much notice must the landlord give me?'}))")

# the two drafts, compared
curl -s https://clearclause.seriouss.workers.dev/api/compare \
  -H 'content-type: application/json' -H 'sec-fetch-site: same-origin' \
  --data-binary @<(python3 -c "import json;print(json.dumps({'a':open('public/samples/rental.txt').read(),'b':open('public/samples/rental-revised.txt').read()}))")
```

Note that a plain `curl` user-agent is refused at the Cloudflare edge with error
1010 before it reaches the Worker; pass a browser user-agent when probing. That
is edge bot protection, not the service.

The accessibility numbers reproduce with `npm test`, which is the point of them
being a test:

```bash
npx vitest run --project dom     # axe-core over the shipped markup
npx vitest run --project workers # everything else, inside workerd
```
