# Accessibility

A tool for people who cannot afford a lawyer that only works for people with
perfect vision and a mouse has missed its own point.

## Automated result

**axe-core 4.13.0** against the live deployment, with a full fifteen-clause
analysis rendered on the page, covering WCAG 2.0 / 2.1 / 2.2 Level A and AA plus
axe's best-practice ruleset:

| Theme | Violations | Passes | Incomplete |
| ----- | ---------- | ------ | ---------- |
| Light | **0**      | 45     | 0          |
| Dark  | **0**      | 45     | 0          |

The audit was run on the rendered result state, not an empty page — the clause
list, severity badges, score card and injection alert were all present.

### Violations found and fixed

| Rule             | Impact   | Nodes | Fix                                                                                                                                                               |
| ---------------- | -------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `color-contrast` | serious  | 38    | One token, `--n-500`, measured 4.18:1 against the page ground — below the 4.5:1 AA floor. Darkened to `oklch(52%)`; dark-mode counterpart raised to `oklch(70%)`. |
| `region`         | moderate | 1     | The standing legal disclaimer sat outside every landmark. Now wrapped in `<aside aria-label="Important notice about this service">`.                              |

## What automation cannot check

`test/a11y.test.ts` runs 27 structural assertions inside workerd using
HTMLRewriter — landmarks, heading order, label targets, ARIA reference
integrity, focus order, accessible names, CSP-compatible markup. The rest is
judgement, made deliberately:

### Severity is never carried by colour alone

Every severity badge carries three independent signals: a geometric **glyph** (▲
◆ ● ○), a **word** ("High attention", "Worth checking", "Know about it",
"Routine"), and a colour. Any one of the three is sufficient. High-severity
clauses additionally carry a left border, which survives greyscale.

This matters more here than in most interfaces: the entire product is a risk
signal, and a red/green-only encoding would hand a wrong answer to roughly one
in twelve men.

### Progress is announced once, results are not

Results stream in one clause at a time. The obvious implementation — `aria-live`
on the clause list — would fire twenty separate announcements at a screen-reader
user and make the page unusable while it loaded.

Instead a single visually-hidden `role="status"` region announces progress
("Analysed 7 of 15 clauses"), and the clause list is ordinary content the user
navigates when they choose. The final announcement states the high-attention
count and hands over.

### Errors interrupt, progress does not

Validation errors use `role="alert"` (assertive) because the user is blocked and
needs to know now. Progress uses `role="status"` (polite) because it is
information, not an interruption.

### Focus is managed only where the user asked for it

"Read these first" links move focus to the target clause, which is given
`tabindex="-1"` so it can receive focus without entering the tab order. Focus is
not moved when results arrive — a user reading the form should not be yanked
away from it.

### Dark mode is authored, not inverted

An inverted palette produces glowing, over-saturated surfaces. The dark theme
redefines its tokens independently: reduced chroma, surfaces that lift by
lightness rather than by heavier shadows, and a ground that is never pure black
(`oklch(15.5%)`) against text that is never pure white (`oklch(95%)`) — pure
white on pure black vibrates.

The theme follows the system preference by default, and an explicit choice is
remembered in `localStorage` inside a `try/catch`, so the page still works where
storage is blocked.

### Motion is reduced, not removed

`prefers-reduced-motion: reduce` collapses all transition and animation
durations to 0.01ms. Opacity changes survive; movement does not. Nothing
autoplays and nothing parallaxes.

### Everything else

- Skip link as the first focusable element, targeting `<main id="main">`.
- Visible focus ring with a 3px offset; `outline: none` appears nowhere.
- Hit targets ≥44×44px on every control, including the file-upload label.
- Every form control has a real `<label>`; placeholder text is never a label.
- Body text capped at 68ch; the measure stays readable at every width.
- Layout is responsive to 400px with no horizontal scroll.
- A print stylesheet drops the chrome so the analysis can be taken to a lawyer
  on paper.
- The document declares `lang="en"`; headings descend without skipping a level.

## Known gaps

- **English only.** For a tool aimed at access to justice in India this is the
  most significant limitation in this document. The analysis prompt is
  English-language and the interface is not localised.
- The `<textarea>` is a plain text field, not a rich editor; very long documents
  are awkward to navigate with a keyboard inside it.
- Automated auditing covers the states reachable from the live site. The
  rate-limited (429) state was verified in tests but not in a browser audit.
