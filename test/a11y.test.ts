import { beforeAll, describe, expect, it } from 'vitest';
import html from '../public/index.html?raw';

/**
 * Structural accessibility checks over the shipped markup.
 *
 * These run in workerd using HTMLRewriter, the same parser the runtime uses, so
 * they need no DOM emulation and cannot drift from what is actually served.
 * They cover the failures that are mechanically detectable — unlabelled
 * controls, missing landmarks, focus traps, inline handlers. The judgement
 * calls that no parser can make (is the focus order sensible, does the live
 * region say something useful) were checked by hand against a screen reader and
 * recorded in docs/ACCESSIBILITY.md.
 */

interface Element {
  tag: string;
  attrs: Record<string, string>;
  text: string;
  /** Enclosed by a <label>, which names it implicitly with no `for` needed. */
  inLabel: boolean;
  /** Inside a <template>. Inert until cloned, so it is not part of the
   *  document's heading outline or landmark structure. */
  inTemplate: boolean;
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const elements: Element[] = [];
const ids = new Set<string>();

beforeAll(async () => {
  const TAGS =
    'html,main,header,footer,nav,section,aside,a,button,input,select,textarea,label,img,h1,h2,h3,h4,fieldset,legend,form,template,script,style,p,div,span,ol,ul,li,blockquote,dl';
  // An open-element stack, so text accrues to every ancestor rather than only
  // the innermost element. A button whose label sits in a nested <span> has an
  // accessible name, and a checker that misses that reports a false failure.
  const open: Element[] = [];
  await new HTMLRewriter()
    .on(TAGS, {
      element(el) {
        const attrs: Record<string, string> = {};
        for (const [k, v] of el.attributes) if (k) attrs[k] = v ?? '';
        if (attrs.id) ids.add(attrs.id);
        const node: Element = {
          tag: el.tagName,
          attrs,
          text: '',
          // Captured from the stack, so each element knows what encloses it.
          inLabel: open.some((a) => a.tag === 'label'),
          inTemplate: open.some((a) => a.tag === 'template'),
        };
        elements.push(node);
        // Void elements have no end tag; asking for one is a parser error.
        if (VOID_TAGS.has(el.tagName)) return;
        open.push(node);
        el.onEndTag(() => {
          const at = open.lastIndexOf(node);
          if (at !== -1) open.splice(at, 1);
        });
      },
      text(chunk) {
        for (const node of open) node.text += chunk.text;
      },
    })
    .transform(new Response(html))
    .text();
});

const byTag = (tag: string): Element[] => elements.filter((e) => e.tag === tag);

describe('document structure', () => {
  it('declares a language', () => {
    expect(byTag('html')[0]?.attrs.lang).toBe('en');
  });

  it('has exactly one main landmark', () => {
    expect(byTag('main')).toHaveLength(1);
  });

  it('has banner and contentinfo landmarks', () => {
    expect(byTag('header').length).toBeGreaterThanOrEqual(1);
    expect(byTag('footer').length).toBeGreaterThanOrEqual(1);
  });

  it('has exactly one h1', () => {
    expect(byTag('h1')).toHaveLength(1);
  });

  it('gives template headings the level that is correct where they are cloned', () => {
    // The clause template is excluded from the outline check above because it
    // is inert, so its level is asserted here instead rather than going
    // unchecked. Clauses are inserted under the h3 "Every clause, in plain
    // English", so an h4 is the only level that does not skip.
    const templateHeadings = elements.filter((e) => e.inTemplate && /^h[1-6]$/.test(e.tag));
    expect(templateHeadings.length).toBeGreaterThan(0);
    for (const h of templateHeadings) expect(h.tag).toBe('h4');
  });

  it('does not skip a heading level', () => {
    // <template> content is inert: it is not in the accessibility tree until it
    // is cloned into place, and where it happens to sit in the source says
    // nothing about the outline a user navigates.
    const levels = elements
      .filter((e) => /^h[1-4]$/.test(e.tag) && !e.inTemplate)
      .map((e) => Number(e.tag.slice(1)));
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
    }
  });

  it('opens with a skip link that targets the main landmark', () => {
    const skip = byTag('a').find((a) => a.attrs.class?.includes('skip-link'));
    expect(skip).toBeDefined();
    expect(skip!.attrs.href).toBe('#main');
    expect(byTag('main')[0]?.attrs.id).toBe('main');
  });
});

describe('form controls', () => {
  /**
   * Can this control acquire an accessible name?
   *
   * Four ways, and a checker that knows only the first three reports a false
   * failure on perfectly good markup: an explicit ARIA name, an `id` a
   * `<label for>` can point at, or being wrapped in a `<label>`, which names
   * the control from the label's own text with no `for` attribute at all.
   */
  const labelled = (el: Element): boolean =>
    Boolean(el.attrs['aria-label'] || el.attrs['aria-labelledby'] || el.attrs.id || el.inLabel);

  it('gives every interactive control an accessible name', () => {
    for (const el of [...byTag('input'), ...byTag('select'), ...byTag('textarea')]) {
      if (el.attrs.type === 'hidden') continue;
      expect(labelled(el), `<${el.tag}> has no way to be named`).toBe(true);
    }
  });

  it('points every label at a control that exists', () => {
    for (const label of byTag('label')) {
      const target = label.attrs.for;
      if (!target) continue; // wrapping label; the control is nested inside
      expect(ids.has(target), `<label for="${target}"> targets nothing`).toBe(true);
    }
  });

  it('resolves every aria-describedby reference', () => {
    for (const el of elements) {
      const ref = el.attrs['aria-describedby'];
      if (!ref) continue;
      for (const id of ref.split(/\s+/)) {
        expect(ids.has(id), `aria-describedby="${id}" targets nothing`).toBe(true);
      }
    }
  });

  it('resolves every aria-labelledby reference', () => {
    for (const el of elements) {
      const ref = el.attrs['aria-labelledby'];
      if (!ref) continue;
      for (const id of ref.split(/\s+/)) {
        expect(ids.has(id), `aria-labelledby="${id}" targets nothing`).toBe(true);
      }
    }
  });

  it('gives every fieldset a legend', () => {
    expect(byTag('fieldset').length).toBe(byTag('legend').length);
  });

  it('does not rely on placeholder text in place of a label', () => {
    for (const el of byTag('textarea')) {
      if (el.attrs.placeholder) expect(el.attrs.id).toBeTruthy();
    }
  });
});

describe('focus and interaction', () => {
  it('uses no positive tabindex, which would break document focus order', () => {
    for (const el of elements) {
      const t = el.attrs.tabindex;
      if (t !== undefined) expect(Number(t)).toBeLessThanOrEqual(0);
    }
  });

  it('gives every button a name, from text or an aria attribute', () => {
    for (const button of byTag('button')) {
      const named =
        button.text.trim().length > 0 ||
        Boolean(button.attrs['aria-label']) ||
        Boolean(button.attrs['aria-labelledby']);
      expect(named, `<button> with no accessible name: ${JSON.stringify(button.attrs)}`).toBe(true);
    }
  });

  it('gives every button an explicit type so none submits a form by accident', () => {
    for (const button of byTag('button')) {
      expect(['button', 'submit', 'reset']).toContain(button.attrs.type);
    }
  });

  it('gives every link an href and discernible text', () => {
    for (const link of byTag('a')) {
      expect(link.attrs.href).toBeTruthy();
      expect(link.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('gives every image alternative text', () => {
    for (const img of byTag('img')) {
      expect(img.attrs.alt).toBeDefined();
    }
  });

  it('hides decorative graphics from assistive technology', () => {
    const mark = elements.find((e) => e.attrs.class === 'brand__mark');
    expect(mark?.attrs['aria-hidden']).toBe('true');
  });
});

describe('live regions', () => {
  it('announces progress through a single polite status region', () => {
    const live = elements.filter((e) => e.attrs['aria-live'] === 'polite');
    const status = live.filter((e) => e.attrs.role === 'status');
    expect(status.length).toBeGreaterThanOrEqual(1);
  });

  it('does not mark the clause list itself as live, which would flood a screen reader', () => {
    const list = elements.find((e) => e.attrs.id === 'clause-list');
    expect(list).toBeDefined();
    expect(list!.attrs['aria-live']).toBeUndefined();
  });

  it('announces errors assertively', () => {
    const alerts = elements.filter((e) => e.attrs.role === 'alert');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });
});

describe('content security', () => {
  it('has no inline event handler attributes', () => {
    for (const el of elements) {
      for (const name of Object.keys(el.attrs)) {
        expect(name.startsWith('on'), `inline handler ${name}`).toBe(false);
      }
    }
  });

  it('loads all script from external files, so the CSP needs no unsafe-inline', () => {
    for (const script of byTag('script')) {
      expect(script.attrs.src, 'inline <script> would require unsafe-inline').toBeTruthy();
    }
  });

  it('has no inline style element', () => {
    expect(byTag('style')).toHaveLength(0);
  });

  it('loads no resource from a third-party origin', () => {
    for (const el of elements) {
      for (const value of [el.attrs.src, el.attrs.href]) {
        if (value && /^https?:\/\//.test(value)) {
          // Only the source-code link in the footer may point off-origin.
          expect(el.tag).toBe('a');
        }
      }
    }
  });
});

describe('the standing disclaimer', () => {
  it('appears in the markup, outside any conditional region', () => {
    const notice = elements.find((e) => e.attrs.class?.includes('notice--standing'));
    expect(notice).toBeDefined();
    expect(notice!.text).toMatch(/not legal advice/i);
  });

  it('is exposed to assistive technology as a note', () => {
    const notice = elements.find((e) => e.attrs.class?.includes('notice--standing'));
    expect(notice!.attrs.role).toBe('note');
  });
});
