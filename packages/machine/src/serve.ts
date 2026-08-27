/**
 * The answers a site gives a machine, and the headers each format asks for.
 *
 * Both origins serve the same formats, so the content types are stated here
 * once rather than at each route. These headers are what `vite dev` sends and
 * what a test can read; they are not what production sends. The build turns
 * every one of these routes into a static file, and a static file's headers
 * come from `vercel.json` — so each site's `machine.test.ts` reads that file
 * and checks the two agree.
 */

/** robots.txt and llms.txt. Neither format registers a media type of its own. */
export const plain = (body: string) =>
  new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } })

/**
 * A markdown twin. `text/markdown` is the registered type (RFC 7763);
 * `text/x-markdown` is deprecated and `application/markdown` was never
 * registered. `Vary: Accept` travels with it because the same URL's HTML page
 * is reachable by content negotiation, and a cache that does not know that
 * will hand one representation to a reader who asked for the other.
 */
export const markdown = (body: string) =>
  new Response(body, {
    headers: { "content-type": "text/markdown; charset=utf-8", vary: "Accept" },
  })

export const xml = (body: string) =>
  new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } })

export const json = (value: unknown) =>
  new Response(`${JSON.stringify(value, null, 2)}\n`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  })

/**
 * What a named resource that does not exist answers with.
 *
 * The Agent Skills draft asks a publisher to answer 404 for a skill nobody
 * wrote rather than to answer with something else, and the same holds for a
 * section and a page. The body is markdown because the reader asked a markdown
 * route, and it says what was missing rather than only that something was.
 */
export const missing = (says: string) =>
  new Response(`# Not found\n\n${says}\n`, {
    status: 404,
    headers: { "content-type": "text/markdown; charset=utf-8" },
  })
