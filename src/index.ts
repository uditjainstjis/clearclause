import { Hono } from 'hono';
import type { Env } from './lib/ai';
import { harden } from './lib/headers';
import { analyzeDocument, InputError, validateInput, MAX_INPUT_CHARS } from './lib/pipeline';
import type { AnalyzeEvent, DocType } from './lib/types';

/**
 * ClearClause Worker entry point.
 *
 * Three routes and nothing else: a health probe, the analysis stream, and
 * static assets. Keeping the surface this small is deliberate — every route is
 * an entry point for untrusted input.
 */

const app = new Hono<{ Bindings: Env }>();

const VALID_DOC_TYPES: readonly DocType[] = [
  'rental',
  'employment',
  'loan',
  'service',
  'nda',
  'terms',
  'other',
];

app.use('*', async (c, next) => {
  await next();
  c.res = harden(c.res);
});

/** Liveness probe. Reports build identity only — never configuration. */
app.get('/api/health', (c) =>
  c.json({ status: 'ok', service: 'clearclause', limits: { maxInputChars: MAX_INPUT_CHARS } }),
);

/**
 * Analyse a document, streaming results as Server-Sent Events.
 *
 * SSE rather than a single JSON response: a twenty-clause contract takes
 * several seconds in total but under two for the first clause, and the reader
 * can start on the most important part while the rest arrives.
 */
app.post('/api/analyze', async (c) => {
  // Per-IP rate limit. The binding is optional so local dev and tests run
  // without it; in production it is configured in wrangler.jsonc.
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  if (c.env.RATE_LIMITER) {
    const { success } = await c.env.RATE_LIMITER.limit({ key: ip });
    if (!success) {
      return c.json(
        { error: 'Too many requests. Please wait a minute and try again.', code: 'rate_limited' },
        429,
      );
    }
  }

  let body: { text?: unknown; docType?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected a JSON body.', code: 'bad_json' }, 400);
  }

  let text: string;
  try {
    text = validateInput(body.text);
  } catch (err) {
    const e = err as InputError;
    return c.json({ error: e.message, code: e.code ?? 'invalid' }, 400);
  }

  const requested = typeof body.docType === 'string' ? (body.docType as DocType) : undefined;
  const docType = requested && VALID_DOC_TYPES.includes(requested) ? requested : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AnalyzeEvent): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        for await (const event of analyzeDocument(c.env, text, docType ? { docType } : {})) {
          send(event);
        }
      } catch {
        // Never leak internal detail to the client; the message is generic by
        // design and the specifics stay in Workers logs.
        send({
          type: 'error',
          message: 'Analysis failed partway through. Please try again.',
          code: 'internal',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
});

app.all('/api/*', (c) => c.json({ error: 'Not found', code: 'not_found' }, 404));

/** Everything else is the static single-page app. */
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
