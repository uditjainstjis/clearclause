import { Hono, type MiddlewareHandler } from 'hono';
import type { Env } from './lib/ai';
import { answerQuestion } from './lib/ask';
import { compareDocuments } from './lib/compare';
import { harden } from './lib/headers';
import { analyzeDocument, InputError, validateInput, MAX_INPUT_CHARS } from './lib/pipeline';
import type { AnalyzeEvent, DocType } from './lib/types';

/**
 * ClearClause Worker entry point.
 *
 * The surface is deliberately small — every route is an entry point for
 * untrusted input — and the three that take a document all run it through the
 * same normalise → screen → redact ordering before a model ever sees it.
 *
 *   GET  /api/health   liveness, build identity only
 *   POST /api/analyze  explain a document clause by clause (streamed)
 *   POST /api/ask      answer a question about a document, with a verified quote
 *   POST /api/compare  align two documents and explain what changed
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

/**
 * Gate for every route that accepts a document.
 *
 * Two checks and a rate limit, in that order.
 *
 * **Content type.** The body must be declared `application/json`. This is the
 * CSRF control. A cross-origin `fetch` may send `text/plain` without a preflight
 * — that is a CORS "simple request" and it arrives whether or not this service
 * wants it — but it cannot claim `application/json` without one, and there is no
 * CORS policy here for a preflight to succeed against. Requiring the header
 * therefore costs a legitimate client nothing and closes the silent path.
 *
 * **Sec-Fetch-Site.** Browsers state where a request came from and the value
 * cannot be forged by page script. It is absent for non-browser clients such as
 * curl, which is allowed: this service holds no cookie, session or credential,
 * so a request that carries no ambient authority is simply a direct API call.
 * What must not happen is a *browser* being used as a confused deputy, and that
 * is exactly the case this rejects.
 *
 * **Rate limit.** Applied last, so a rejected cross-site request never consumes
 * the visitor's budget. The limit keys on client IP, and under CSRF that IP is
 * the victim's — one more reason the two checks above come first.
 */
const guardApi: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const contentType = (c.req.header('content-type') ?? '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return c.json(
      { error: 'Send this request as application/json.', code: 'unsupported_media_type' },
      415,
    );
  }

  const site = c.req.header('sec-fetch-site');
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    return c.json({ error: 'Cross-site requests are not accepted.', code: 'cross_origin' }, 403);
  }

  // The binding is optional so local dev and tests run without it; in
  // production it is configured in wrangler.jsonc.
  if (c.env.RATE_LIMITER) {
    const ip = c.req.header('cf-connecting-ip') ?? 'local';
    const { success } = await c.env.RATE_LIMITER.limit({ key: ip });
    if (!success) {
      return c.json(
        { error: 'Too many requests. Please wait a minute and try again.', code: 'rate_limited' },
        429,
      );
    }
  }

  await next();
  return undefined;
};

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
app.post('/api/analyze', guardApi, async (c) => {
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

/**
 * Answer a question about a supplied document.
 *
 * A plain JSON response rather than SSE: unlike analysis, this is one model
 * call over a handful of retrieved clauses, so there is nothing to stream and
 * a single round trip is simpler for the client to get right.
 */
app.post('/api/ask', guardApi, async (c) => {
  let body: { text?: unknown; question?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected a JSON body.', code: 'bad_json' }, 400);
  }

  try {
    // Both are validated inside answerQuestion, which throws InputError with a
    // code the UI maps to a specific message.
    return c.json(await answerQuestion(c.env, body.text as string, body.question as string));
  } catch (err) {
    if (err instanceof InputError) {
      return c.json({ error: err.message, code: err.code }, 400);
    }
    // Never leak internal detail; specifics stay in Workers logs.
    return c.json(
      { error: 'That question could not be answered just now.', code: 'internal' },
      500,
    );
  }
});

/**
 * Compare two documents clause by clause.
 *
 * Also a single JSON response. Alignment is deterministic and the model is
 * called only for pairs that actually differ, so the work is bounded by how
 * much changed rather than by document length.
 */
app.post('/api/compare', guardApi, async (c) => {
  let body: { a?: unknown; b?: unknown; labelA?: unknown; labelB?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected a JSON body.', code: 'bad_json' }, 400);
  }

  try {
    return c.json(
      await compareDocuments(c.env, body.a as string, body.b as string, {
        labelA: typeof body.labelA === 'string' ? body.labelA : undefined,
        labelB: typeof body.labelB === 'string' ? body.labelB : undefined,
      }),
    );
  } catch (err) {
    if (err instanceof InputError) {
      return c.json({ error: err.message, code: err.code }, 400);
    }
    return c.json(
      { error: 'Those documents could not be compared just now.', code: 'internal' },
      500,
    );
  }
});

app.all('/api/*', (c) => c.json({ error: 'Not found', code: 'not_found' }, 404));

/** Everything else is the static single-page app. */
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
