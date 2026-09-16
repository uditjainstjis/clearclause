import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import axe from 'axe-core';

/** Read straight off disk, resolved from the project root (vitest's cwd).
 *  A `?raw` import of a .css file is intercepted by Vite's stylesheet pipeline
 *  and arrives as an empty string, which would quietly turn the injection below
 *  into a no-op — auditing a page nobody is served. */
const read = (name: string): string => readFileSync(resolve(process.cwd(), 'public', name), 'utf8');

const html = read('index.html');
const css = read('styles.css');

/**
 * The accessibility claim, enforced.
 *
 * README and docs/ACCESSIBILITY.md state that axe-core finds no violations in
 * either theme. Before this file existed that was true but unenforced — axe was
 * a devDependency that a human ran by hand, so nothing stopped a later commit
 * from quietly breaking it. This runs the real engine over the real shipped
 * markup on every `npm test` and in CI.
 *
 * It runs in jsdom rather than workerd because axe needs a DOM and workerd has
 * none. The shipped stylesheet is injected too: axe ignores hidden elements, so
 * auditing the markup without its CSS would audit a page nobody is served.
 *
 * jsdom does no layout, so `color-contrast` cannot be decided here and axe
 * returns it as "incomplete" rather than passing or failing it. Contrast is
 * therefore checked separately against a real engine and recorded with measured
 * ratios in docs/ACCESSIBILITY.md; `test/a11y.test.ts` covers the structural
 * rules inside workerd using the same HTMLRewriter the runtime parses with.
 */

/** Rules axe cannot decide without layout. Asserted elsewhere; see above. */
const LAYOUT_DEPENDENT = new Set(['color-contrast', 'color-contrast-enhanced']);

function render(theme?: 'light' | 'dark', injected = ''): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');

  // Inline the real stylesheet. jsdom will not fetch <link href="styles.css">,
  // and without it every `display:none` element would look visible to axe.
  const style = parsed.createElement('style');
  style.textContent = css;
  parsed.head.appendChild(style);

  if (theme) parsed.documentElement.setAttribute('data-theme', theme);
  if (injected) parsed.body.insertAdjacentHTML('afterbegin', injected);

  document.replaceChild(
    document.importNode(parsed.documentElement, true),
    document.documentElement,
  );
}

async function violationsFor(theme?: 'light' | 'dark'): Promise<axe.Result[]> {
  render(theme);
  const results = await axe.run(document, {
    resultTypes: ['violations'],
    // Score the standards a legal-aid tool is actually judged against.
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  });
  return results.violations.filter((v) => !LAYOUT_DEPENDENT.has(v.id));
}

/** Turn axe output into something a failing CI log can be read from. */
function describeViolations(violations: axe.Result[]): string {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).join('\n    ')}`,
    )
    .join('\n');
}

describe('axe-core over the shipped page', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('reports no violations with the default theme', async () => {
    const violations = await violationsFor();
    expect(describeViolations(violations)).toBe('');
  });

  it('reports no violations in the light theme', async () => {
    const violations = await violationsFor('light');
    expect(describeViolations(violations)).toBe('');
  });

  it('reports no violations in the dark theme', async () => {
    const violations = await violationsFor('dark');
    expect(describeViolations(violations)).toBe('');
  });

  /**
   * A gate that cannot fail proves nothing. This deliberately breaks the page
   * and asserts the audit notices, so a future change that quietly stops axe
   * from seeing the real markup shows up as a failure here rather than as a
   * suspiciously clean run.
   */
  it('NEGATIVE CONTROL: catches an image with no alternative text', async () => {
    render(undefined, '<img src="decorative.png">');
    const results = await axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
      },
    });
    expect(results.violations.map((v) => v.id)).toContain('image-alt');
  });

  it('actually ran a meaningful number of rules, rather than silently no-opping', async () => {
    render();
    const results = await axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
      },
    });
    // Guards against the failure mode where a broken fixture yields an empty
    // page: zero violations over zero rules is not a passing audit.
    expect(results.passes.length).toBeGreaterThan(20);
  });
});
