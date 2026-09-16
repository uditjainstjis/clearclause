import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Invariants about the files actually served from public/.
 *
 * These run in the Node-backed project because they read the directory from
 * disk, which is the only way to check a promise made about a *file* rather
 * than about markup.
 */

const publicDir = resolve(process.cwd(), 'public');
const read = (name: string): string => readFileSync(resolve(publicDir, name), 'utf8');

const indexHtml = read('index.html');
const stylesCss = read('styles.css');
const headers = read('_headers');

const fontsIn = (text: string): string[] =>
  [...new Set([...text.matchAll(/\/fonts\/([^"')\s]+)/g)].map((m) => m[1] ?? ''))].sort();

describe('the shipped fonts', () => {
  it('are content-addressed, so the immutable cache header is honest', () => {
    // _headers promises `public, max-age=31536000, immutable` for /fonts/*.
    // That is only safe if the URL changes whenever the bytes do.
    expect(headers).toMatch(/\/fonts\/\*/);
    expect(headers).toMatch(/immutable/);
    const fonts = fontsIn(stylesCss);
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) expect(font).toMatch(/^[a-z]+\.[0-9a-f]{8}\.woff2$/);
  });

  it('preloads exactly the files the stylesheet asks for', () => {
    // A preload naming a stale filename downloads a font nothing goes on to
    // use, and costs the render it was added to save.
    expect(fontsIn(indexHtml)).toEqual(fontsIn(stylesCss));
  });

  it('every referenced font file actually exists in public/fonts', () => {
    for (const font of fontsIn(stylesCss)) {
      expect(() => readFileSync(resolve(publicDir, 'fonts', font))).not.toThrow();
    }
  });

  it('the hash in each filename matches the bytes of that file', async () => {
    const { createHash } = await import('node:crypto');
    for (const font of fontsIn(stylesCss)) {
      const bytes = readFileSync(resolve(publicDir, 'fonts', font));
      const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
      // If this fails, a font was edited without renaming it, and caches will
      // serve the old bytes for a year.
      expect(font).toContain(digest);
    }
  });
});
