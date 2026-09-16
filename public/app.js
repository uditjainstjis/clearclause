/**
 * ClearClause front end.
 *
 * Two rules hold throughout:
 *
 *  1. **Model output is untrusted.** Every string that came from a model is
 *     written with `textContent`. There is no `innerHTML` in this file, so a
 *     document that smuggles markup through the analysis cannot reach the DOM
 *     as markup. The strict CSP is the second line, not the first.
 *  2. **Announcements are rationed.** A live region updated per clause fires one
 *     announcement per clause — up to eighty — and talks over the user for the
 *     length of the run. A single polite status region reports progress at
 *     quartiles plus completion, and the clause list is ordinary content the
 *     user navigates when they choose.
 *  3. **Busy state never takes focus away.** Controls report `aria-disabled`
 *     rather than `disabled`, because disabling the element the user just
 *     activated drops focus to <body> and loses their place in the page.
 */

const $ = (id) => document.getElementById(id);

const els = {
  form: $('analyze-form'),
  text: $('doc-text'),
  file: $('doc-file'),
  type: $('doc-type'),
  btn: $('analyze-btn'),
  count: $('doc-count'),
  formError: $('form-error'),
  textB: $('doc-text-b'),
  question: $('ask-question'),
  askField: $('ask-field'),
  compareField: $('compare-field'),
  answerResults: $('answer-results'),
  answerQuestion: $('answer-question'),
  answerText: $('answer-text'),
  answerQuote: $('answer-quote'),
  answerQuoteText: $('answer-quote-text'),
  answerQuoteCite: $('answer-quote-cite'),
  answerUnanswered: $('answer-unanswered'),
  answerConsulted: $('answer-consulted'),
  answerConsultedList: $('answer-consulted-list'),
  answerStats: $('answer-stats'),
  compareResults: $('compare-results'),
  compareVerdict: $('compare-verdict'),
  compareCounts: $('compare-counts'),
  compareList: $('compare-list'),
  compareStats: $('compare-stats'),
  progress: $('progress'),
  results: $('results'),
  guardAlert: $('guard-alert'),
  scoreValue: $('score-value'),
  scoreWord: $('score-word'),
  statType: $('stat-type'),
  statClauses: $('stat-clauses'),
  statHigh: $('stat-high'),
  statTime: $('stat-time'),
  statCache: $('stat-cache'),
  readfirst: $('readfirst'),
  readfirstList: $('readfirst-list'),
  clauseList: $('clause-list'),
  obligationsCard: $('obligations-card'),
  obligationsList: $('obligations-list'),
  questionsCard: $('questions-card'),
  questionsList: $('questions-list'),
  copyBtn: $('copy-btn'),
  copyStatus: $('copy-status'),
  themeToggle: $('theme-toggle'),
  tpl: $('clause-tpl'),
};

/** Glyphs carry severity for anyone who cannot distinguish the colours. */
const RISK = {
  high: { glyph: '▲', word: 'High attention' },
  medium: { glyph: '◆', word: 'Worth checking' },
  low: { glyph: '●', word: 'Know about it' },
  info: { glyph: '○', word: 'Routine' },
};

const SCORE_WORDS = [
  [70, 'A lot here needs your attention'],
  [45, 'Several terms need attention'],
  [20, 'A few things to check'],
  [1, 'Mostly routine'],
  [0, 'Nothing flagged'],
];

const DOC_TYPE_LABELS = {
  rental: 'Rental / lease',
  employment: 'Employment',
  loan: 'Loan / credit',
  service: 'Service agreement',
  nda: 'NDA',
  terms: 'Terms of service',
  other: 'Agreement',
};

// ---------------------------------------------------------------- theme

const THEME_KEY = 'clearclause:theme';

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme) root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  const isDark =
    theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  // State travels on aria-pressed ONLY. The visible label stays "Dark mode" —
  // it names what the button does, not what is currently on. Flipping both at
  // once announces "Light mode, pressed" while dark mode is active, which tells
  // a screen-reader user the opposite of the truth (WCAG 4.1.2).
  els.themeToggle.setAttribute('aria-pressed', String(isDark));
}

try {
  applyTheme(localStorage.getItem(THEME_KEY));
} catch {
  applyTheme(null);
}

els.themeToggle.addEventListener('click', () => {
  const isDark = els.themeToggle.getAttribute('aria-pressed') === 'true';
  const next = isDark ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* preference is a convenience; the app works without it */
  }
});

// ---------------------------------------------------------------- input

const MAX_CHARS = 120000;

function updateCount() {
  const n = els.text.value.trim().length;
  const over = n > MAX_CHARS;
  // The over-limit state is carried in words, not only in the red that
  // [data-state="over"] applies (WCAG 1.4.1).
  els.count.textContent = over
    ? `${n.toLocaleString()} characters — over the ${MAX_CHARS.toLocaleString()} limit`
    : `${n.toLocaleString()} characters`;
  els.count.dataset.state = over ? 'over' : 'ok';
}
els.text.addEventListener('input', updateCount);

els.file.addEventListener('change', async () => {
  const file = els.file.files && els.file.files[0];
  if (!file) return;
  if (file.size > 2_000_000) {
    showError('That file is larger than 2 MB. Paste the section you care about instead.');
    return;
  }
  els.text.value = await file.text();
  updateCount();
  hideError();
});

for (const chip of document.querySelectorAll('[data-sample]')) {
  chip.addEventListener('click', async () => {
    const name = chip.dataset.sample;
    // aria-disabled rather than `disabled`: disabling the element the user just
    // activated drops focus to <body>, so the role="alert" below is announced
    // with the user's focus nowhere in particular.
    if (chip.getAttribute('aria-disabled') === 'true') return;
    chip.setAttribute('aria-disabled', 'true');
    try {
      const res = await fetch(`/samples/${name}.txt`);
      if (!res.ok) throw new Error('sample unavailable');
      els.text.value = await res.text();

      // In compare mode, a sample that ships a negotiated counter-draft fills
      // both sides, so the feature can be tried without the reader having to
      // find two versions of their own agreement first.
      if (currentMode() === 'compare') {
        const revised = await fetch(`/samples/${name}-revised.txt`);
        els.textB.value = revised.ok ? await revised.text() : '';
      }

      updateCount();
      hideError();
      els.text.focus();
    } catch {
      showError('Could not load that example. Please paste your own text.');
      chip.focus();
    } finally {
      chip.removeAttribute('aria-disabled');
    }
  });
}

/** Describedby list when no error is showing. Kept in sync with index.html. */
const DESCRIBED_BY = 'doc-help doc-count';

function showError(message) {
  els.formError.textContent = message;
  els.formError.hidden = false;
  // role="alert" announces the message once. These two attributes are what a
  // user hears when they navigate BACK to the field afterwards — without them
  // the textarea gives no sign it is the one that failed (WCAG 3.3.1).
  els.text.setAttribute('aria-invalid', 'true');
  els.text.setAttribute('aria-describedby', `${DESCRIBED_BY} form-error`);
}
function hideError() {
  els.formError.hidden = true;
  els.formError.textContent = '';
  els.text.removeAttribute('aria-invalid');
  els.text.setAttribute('aria-describedby', DESCRIBED_BY);
}

// ---------------------------------------------------------------- render

function renderGuard(guard) {
  const findings = guard.injectionFindings || [];
  if (findings.length === 0 && !guard.redactions) {
    els.guardAlert.hidden = true;
    return;
  }
  els.guardAlert.replaceChildren();

  if (findings.length > 0) {
    const h = document.createElement('h3');
    h.textContent = 'This document contains text written for an AI system, not for you';
    const p = document.createElement('p');
    p.textContent =
      findings.length === 1
        ? 'One passage tries to instruct whatever software reads this document. It was ignored during analysis, and it is shown below because a document that does this is itself worth questioning.'
        : `${findings.length} passages try to instruct whatever software reads this document. They were ignored during analysis, and are shown below because a document that does this is itself worth questioning.`;
    const ul = document.createElement('ul');
    for (const f of findings.slice(0, 6)) {
      const li = document.createElement('li');
      li.textContent = `${f.detail} `;
      const code = document.createElement('code');
      code.textContent = f.excerpt;
      li.append(code);
      ul.append(li);
    }
    els.guardAlert.append(h, p, ul);
  }

  if (guard.redactions > 0) {
    const p = document.createElement('p');
    p.textContent = `${guard.redactions} personal identifier${
      guard.redactions === 1 ? ' was' : 's were'
    } removed from this document before any of it was sent for analysis.`;
    p.style.marginBottom = '0';
    els.guardAlert.append(p);
  }
  els.guardAlert.hidden = false;
}

function renderClause(a) {
  const node = els.tpl.content.firstElementChild.cloneNode(true);
  node.dataset.risk = a.risk;
  node.id = `clause-${a.index}`;

  const risk = RISK[a.risk] || RISK.info;
  node.querySelector('.badge__glyph').textContent = risk.glyph;
  node.querySelector('.badge__text').textContent = risk.word;
  node.querySelector('.clause__title').textContent = a.heading;
  node.querySelector('.clause__label').textContent = a.label ? `Clause ${a.label}` : '';
  node.querySelector('.clause__plain').textContent = a.plain;
  node.querySelector('.clause__why').textContent = a.why || '';
  node.querySelector('.clause__ask span:last-child').textContent = a.ask || '';

  const quote = node.querySelector('.clause__quote');
  if (a.quote) quote.querySelector('p').textContent = `“${a.quote}”`;
  else quote.remove();

  if (!a.grounded) node.querySelector('.clause__ungrounded').hidden = false;

  // Keep document order even though results stream out of order.
  const after = [...els.clauseList.children].find((li) => Number(li.dataset.index) > a.index);
  node.dataset.index = String(a.index);
  els.clauseList.insertBefore(node, after || null);
}

function renderReport(report, stats) {
  els.scoreValue.textContent = String(report.riskScore);
  const word = SCORE_WORDS.find(([min]) => report.riskScore >= min);
  els.scoreWord.textContent = word ? word[1] : '';
  els.statType.textContent = DOC_TYPE_LABELS[report.docType] || 'Agreement';
  els.statClauses.textContent = String(report.clauseCount);
  els.statHigh.textContent = String(report.counts.high);
  els.statTime.textContent = `${(stats.elapsedMs / 1000).toFixed(1)}s`;

  const parts = [];
  if (stats.cacheHits > 0) {
    parts.push(
      `${stats.cacheHits} of ${stats.clauses} clauses were already analysed and came from cache, so only ${stats.modelCalls} needed a model call.`,
    );
  } else {
    parts.push(`${stats.modelCalls} model calls, run ${stats.concurrency} at a time.`);
  }
  if (report.ungroundedCount > 0) {
    parts.push(
      `${report.ungroundedCount} explanation${
        report.ungroundedCount === 1 ? '' : 's'
      } could not be matched to exact wording and ${
        report.ungroundedCount === 1 ? 'was' : 'were'
      } excluded from the score.`,
    );
  }
  els.statCache.textContent = parts.join(' ');

  if (report.readFirst.length > 0) {
    els.readfirstList.replaceChildren();
    for (const index of report.readFirst) {
      const source = els.clauseList.querySelector(`#clause-${index}`);
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#clause-${index}`;
      a.textContent = source
        ? source.querySelector('.clause__title').textContent
        : `Clause ${index + 1}`;
      a.addEventListener('click', () => {
        const target = document.getElementById(`clause-${index}`);
        if (target) target.focus();
      });
      li.append(a);
      els.readfirstList.append(li);
    }
    els.readfirst.hidden = false;
  }

  if (report.obligations.length > 0) {
    els.obligationsList.replaceChildren();
    for (const ob of report.obligations) {
      const li = document.createElement('li');
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent =
        ob.who === 'you' ? 'You' : ob.who === 'both' ? 'Both parties' : 'The other party';
      const what = document.createElement('span');
      what.textContent = ob.what;
      li.append(who, what);
      if (ob.when) {
        const when = document.createElement('span');
        when.className = 'when';
        when.textContent = ob.when;
        li.append(when);
      }
      els.obligationsList.append(li);
    }
    els.obligationsCard.hidden = false;
  }

  if (report.questions.length > 0) {
    els.questionsList.replaceChildren();
    for (const q of report.questions) {
      const li = document.createElement('li');
      li.textContent = q;
      els.questionsList.append(li);
    }
    els.questionsCard.hidden = false;
  }
}

// ---------------------------------------------------------------- copy

let lastReport = null;
const lastAnalyses = [];

els.copyBtn.addEventListener('click', async () => {
  if (!lastReport) return;
  const lines = [
    '# ClearClause summary',
    '',
    `Document type: ${DOC_TYPE_LABELS[lastReport.docType] || 'Agreement'}`,
    `Needs attention: ${lastReport.riskScore}/100 across ${lastReport.clauseCount} clauses`,
    '',
    '## Questions worth asking first',
    ...lastReport.questions.map((q, i) => `${i + 1}. ${q}`),
    '',
    '## What you would be agreeing to do',
    ...lastReport.obligations.map(
      (o) =>
        `- [${o.who === 'you' ? 'You' : o.who === 'both' ? 'Both' : 'Other party'}] ${o.what}${
          o.when ? ` (${o.when})` : ''
        }`,
    ),
    '',
    '## Clause by clause',
    ...lastAnalyses
      .slice()
      .sort((a, b) => a.index - b.index)
      .map(
        (a) =>
          `\n### ${a.label ? `Clause ${a.label} — ` : ''}${a.heading} (${
            (RISK[a.risk] || RISK.info).word
          })\n${a.plain}\n${a.why ? `\n${a.why}\n` : ''}${a.ask ? `\nAsk: ${a.ask}\n` : ''}${
            a.quote ? `\n> ${a.quote}\n` : ''
          }`,
      ),
    '',
    '---',
    'Generated by ClearClause. This is information, not legal advice.',
  ];
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    els.copyStatus.textContent = 'Summary copied to your clipboard.';
  } catch {
    els.copyStatus.textContent = 'Could not copy automatically — select the page text instead.';
  }
});

// ---------------------------------------------------------------- modes

/** Labels the primary button takes in each mode. */
const MODE_LABELS = {
  explain: 'Analyse document',
  ask: 'Answer my question',
  compare: 'Compare the two versions',
};

/** Which panels belong to which mode, so switching clears the other one. */
const MODE_PANELS = {
  explain: 'results',
  ask: 'answerResults',
  compare: 'compareResults',
};

function currentMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked ? checked.value : 'explain';
}

function applyMode() {
  const mode = currentMode();
  els.askField.hidden = mode !== 'ask';
  els.compareField.hidden = mode !== 'compare';
  els.btn.textContent = MODE_LABELS[mode];
  // Hide the results of whichever mode the user just left: leaving a previous
  // answer on screen under a new question is how people misread a page.
  for (const [name, ref] of Object.entries(MODE_PANELS)) {
    if (name !== mode) els[ref].hidden = true;
  }
  hideError();
}

for (const radio of document.querySelectorAll('input[name="mode"]')) {
  radio.addEventListener('change', applyMode);
}

// ---------------------------------------------------------------- ask + compare

/** Human-readable label for a clause, used in citations. */
function clauseLabel(index, label) {
  return label ? `Clause ${label}` : `Clause ${index + 1}`;
}

function renderAnswer(result) {
  els.answerQuestion.textContent = `You asked: ${result.question}`;
  els.answerText.textContent = result.answer;
  els.answerUnanswered.hidden = result.answered;

  if (result.citation) {
    els.answerQuote.hidden = false;
    els.answerQuoteText.textContent = `“${result.citation.quote}”`;
    els.answerQuoteCite.textContent = `${clauseLabel(
      result.citation.clauseIndex,
      result.citation.label,
    )} of your document, quoted verbatim and checked against it before being shown.`;
  } else {
    els.answerQuote.hidden = true;
  }

  els.answerConsultedList.replaceChildren();
  for (const clause of result.consulted) {
    const li = document.createElement('li');
    const terms = clause.matched.length ? ` — matched on ${clause.matched.join(', ')}` : '';
    li.textContent = `${clauseLabel(clause.index, clause.label)}${terms}`;
    els.answerConsultedList.appendChild(li);
  }
  els.answerConsulted.hidden = result.consulted.length === 0;

  const s = result.stats;
  const how = s.cached
    ? 'served from cache'
    : s.modelCalls === 0
      ? 'answered without calling a model'
      : `${s.modelCalls} model call${s.modelCalls === 1 ? '' : 's'}`;
  els.answerStats.textContent = `Searched ${s.clausesSearched} clauses, read ${s.clausesConsulted} closely, ${how}, in ${(s.elapsedMs / 1000).toFixed(1)}s.`;

  els.answerResults.hidden = false;
  renderGuard(result.guard);
}

const DIRECTION_WORDS = {
  'worse-for-you': 'Worse for you',
  'better-for-you': 'Better for you',
  'no-material-change': 'No material change',
};

function renderComparison(report) {
  const { counts } = report;
  els.compareVerdict.textContent =
    report.favours === 'a'
      ? `On balance, "${report.labelA}" treats you better than "${report.labelB}".`
      : report.favours === 'b'
        ? `On balance, "${report.labelB}" treats you better than "${report.labelA}".`
        : report.differences.length === 0
          ? 'These two documents say the same thing.'
          : 'Neither version is clearly better for you overall.';

  els.compareCounts.textContent = `${counts['worse-for-you']} worse for you, ${counts['better-for-you']} better for you, ${counts['no-material-change']} cosmetic. ${report.unchangedCount} clauses are untouched.`;

  els.compareList.replaceChildren();
  for (const diff of report.differences) {
    const li = document.createElement('li');
    li.className = 'diff';
    li.dataset.direction = diff.direction;

    const head = document.createElement('h3');
    head.className = 'diff__heading';
    head.textContent = diff.heading;
    li.appendChild(head);

    const badge = document.createElement('p');
    badge.className = 'diff__badge';
    // The direction is stated in words, never by colour alone.
    const kindWord =
      diff.kind === 'only-in-a' ? 'Removed' : diff.kind === 'only-in-b' ? 'Added' : 'Changed';
    badge.textContent = `${kindWord} — ${DIRECTION_WORDS[diff.direction]}`;
    li.appendChild(badge);

    const summary = document.createElement('p');
    summary.textContent = diff.summary;
    li.appendChild(summary);

    for (const [quote, label] of [
      [diff.quoteA, report.labelA],
      [diff.quoteB, report.labelB],
    ]) {
      if (!quote) continue;
      const block = document.createElement('blockquote');
      block.className = 'diff__quote';
      const text = document.createElement('p');
      text.textContent = `“${quote}”`;
      const cite = document.createElement('cite');
      cite.textContent = label;
      block.append(text, cite);
      li.appendChild(block);
    }

    if (!diff.grounded) {
      const warn = document.createElement('p');
      warn.className = 'diff__ungrounded';
      warn.textContent =
        'This difference could not be quoted back to either document, so it is shown without a verdict.';
      li.appendChild(warn);
    }

    els.compareList.appendChild(li);
  }

  const s = report.stats;
  els.compareStats.textContent = `${report.clauseCountA} clauses against ${report.clauseCountB}. ${s.modelCalls} model calls, ${s.cacheHits} from cache, in ${(s.elapsedMs / 1000).toFixed(1)}s.`;

  els.compareResults.hidden = false;
  renderGuard(report.guard);
}

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || 'Something went wrong. Please try again.');
  return payload;
}

/**
 * Run the two single-response modes.
 *
 * Neither streams: each is one round trip, so the added machinery of SSE would
 * buy nothing. Errors surface through the same form error channel as analysis,
 * which is the one place the user already knows to look.
 */
async function runAskOrCompare(mode, text) {
  if (mode === 'ask' && els.question.value.trim().length < 8) {
    showError('Ask in a full sentence, for example "how much notice must I give?"');
    els.question.focus();
    return;
  }
  if (mode === 'compare' && els.textB.value.trim().length < 200) {
    showError('Paste the second version too — at least a few clauses of it.');
    els.textB.focus();
    return;
  }

  setBusy(true);
  els.guardAlert.hidden = true;
  try {
    if (mode === 'ask') {
      renderAnswer(await postJson('/api/ask', { text, question: els.question.value.trim() }));
    } else {
      renderComparison(
        await postJson('/api/compare', {
          a: text,
          b: els.textB.value.trim(),
          labelA: 'The version you have',
          labelB: 'The other version',
        }),
      );
    }
  } catch (err) {
    showError(err.message);
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------- run

/** Parse an SSE byte stream into decoded event objects. */
async function* readEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      if (!chunk.startsWith('data: ')) continue;
      try {
        yield JSON.parse(chunk.slice(6));
      } catch {
        /* a truncated frame is skipped rather than aborting the run */
      }
    }
  }
}

/**
 * Mark the form busy.
 *
 * `aria-disabled` rather than `disabled`, and the submit handler returns early
 * when it is set. A disabled element cannot hold focus, so disabling the button
 * the user just pressed drops focus to <body> — and everything announced from
 * then on, including the error alert, arrives with the user's position in the
 * page lost. This keeps focus exactly where they left it.
 */
function setBusy(busy) {
  els.btn.setAttribute('aria-disabled', String(busy));
  els.btn.textContent = busy ? 'Analysing…' : 'Analyse document';
  els.results.setAttribute('aria-busy', String(busy));
}

function showSkeletons(n) {
  els.clauseList.replaceChildren();
  for (let i = 0; i < Math.min(n, 5); i++) {
    const li = document.createElement('li');
    li.className = 'skeleton';
    li.setAttribute('aria-hidden', 'true');
    els.clauseList.append(li);
  }
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  // The button reports busy via aria-disabled, which does not block activation
  // the way `disabled` does, so the guard has to be here.
  if (els.btn.getAttribute('aria-disabled') === 'true') return;
  hideError();

  const text = els.text.value.trim();
  if (text.length < 200) {
    showError('That is too short to be a contract. Paste at least a few clauses.');
    els.text.focus();
    return;
  }

  const mode = currentMode();
  if (mode !== 'explain') {
    await runAskOrCompare(mode, text);
    return;
  }

  setBusy(true);
  lastReport = null;
  lastAnalyses.length = 0;
  els.results.hidden = false;
  els.guardAlert.hidden = true;
  els.readfirst.hidden = true;
  els.obligationsCard.hidden = true;
  els.questionsCard.hidden = true;
  els.scoreValue.textContent = '—';
  els.scoreWord.textContent = 'Analysing…';
  els.statCache.textContent = '';
  els.clauseList.replaceChildren();
  els.progress.textContent = 'Analysis started.';

  let done = 0;
  let expected = 0;

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, docType: els.type.value || undefined }),
    });

    if (!res.ok) {
      const problem = await res.json().catch(() => ({}));
      showError(problem.error || 'Something went wrong. Please try again.');
      els.results.hidden = true;
      return;
    }

    for await (const event of readEvents(res)) {
      if (event.type === 'meta') {
        expected = event.clauseCount;
        renderGuard(event.guard);
        showSkeletons(expected);
        els.statClauses.textContent = String(expected);
        els.statType.textContent = DOC_TYPE_LABELS[event.docType] || 'Agreement';
        els.progress.textContent = `Found ${expected} clauses. Reading them now.`;
      } else if (event.type === 'clause') {
        if (done === 0) els.clauseList.replaceChildren();
        done++;
        lastAnalyses.push(event.analysis);
        renderClause(event.analysis);
        // A polite live region updated once per clause queues up to
        // MAX_CLAUSES announcements and talks over the user for the length of
        // the run. Quartiles give a sense of progress at a pace a person can
        // actually listen to; the completion message below is always announced.
        if (done === expected || done % Math.max(1, Math.ceil(expected / 4)) === 0) {
          els.progress.textContent = `Analysed ${done} of ${expected} clauses.`;
        }
      } else if (event.type === 'report') {
        lastReport = event.report;
        renderReport(event.report, event.stats);
        els.progress.textContent = `Analysis complete. ${event.report.counts.high} clauses need high attention. Results follow.`;
      } else if (event.type === 'error') {
        showError(event.message);
      }
    }
  } catch {
    showError('The connection dropped during analysis. Please try again.');
  } finally {
    setBusy(false);
  }
});

updateCount();
applyMode();
