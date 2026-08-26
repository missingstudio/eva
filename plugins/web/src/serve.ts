import { createReadStream } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { basename } from "node:path"
import type { Frontend } from "@missingstudio/eva-sdk"
import { Effect, Scope } from "effect"
import { assetFor, hasPage, mediaType, unbuilt } from "./assets.js"
import { askChannel, NOBODY } from "./ask.js"
import { refusal, type Bind } from "./bind.js"

export const WEB_SURFACE = "eva.web"

/**
 * Something that may answer a request before the assets do, and says whether
 * it did. It is how one port carries the page and the calls the page makes: a
 * plugin may not import a plugin, so the composition root hands the half that
 * answers to the half that binds.
 *
 * `plugins/api` declares the same type under the same name, for the same
 * reason. One concept, one name: the copy is forced and the second name would
 * not be.
 */
export type Answering = (request: IncomingMessage, response: ServerResponse) => boolean

export interface Serve {
  /**
   * Where the built page is. `eva.web` serves assets it did not build, so
   * this is a directory and not a bundle, and the tree under it is read on
   * each request: a build that ran after the surface started is served, and
   * no restart is needed to see it.
   */
  readonly root: string
  readonly bind: Bind
  /**
   * `local` is single-tenant and `hosted` is multi-tenant, and both are this
   * one artifact. The posture is read when the surface starts and it changes
   * no byte of what is served; what each posture then permits arrives with
   * the token at 9b.
   */
  readonly posture: string
  // Where the bound address is said. A `Frontend` carries none.
  readonly write?: (text: string) => void
  // What answers the calls the page makes, when this build carries a wire.
  readonly api?: Answering
}

const PLAIN = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
}

/**
 * A name the build content-addressed: `[name]-[hash].[ext]`, where the hash is
 * the eight base64url characters the bundler puts before the extension. The
 * count is exact on purpose — a file merely called `one-more-thing.js` has a
 * long enough tail to look hashed, and caching that one forever would be a bug
 * nobody could clear.
 */
const HASHED = /-[A-Za-z0-9_-]{8}\.[^.]+$/

/**
 * How long a browser may keep what it was given.
 *
 * The page is never kept: it names the build it came from, and that fact is
 * worth nothing if a browser can show yesterday's bundle. A hashed asset is
 * the opposite case — the name *is* the content, a new build writes a new
 * name, and the page that points at the new name was itself just fetched. So
 * there is no staleness to protect against, and keeping it is free.
 *
 * Serving the fonts `no-store` is what made the page change face on every
 * refresh: the woff2 was fetched again each time, and `font-display: swap`
 * paints the fallback until it lands.
 */
const cacheFor = (found: string): string =>
  HASHED.test(basename(found)) ? "public, max-age=31536000, immutable" : "no-store"

/**
 * Every request, answered from the tree as it stands. What the reader may keep
 * is `cacheFor`'s decision: the page never, a hashed asset for as long as it
 * likes.
 *
 * The wire is offered the request first, and before the built page is looked
 * for: a call is answered from the record and a build nobody ran says nothing
 * about whether Eva can answer it. The ask channel is offered next: it is this
 * surface's own door, so it sits under no root the wire claims and it is
 * looked for before the page, for the same reason the wire is.
 */
const answer =
  (root: string, asking: Answering, api?: Answering) =>
  (request: IncomingMessage, response: ServerResponse): void => {
    if (api?.(request, response) === true) return
    if (asking(request, response)) return

    if (!hasPage(root)) {
      response.writeHead(503, PLAIN)
      response.end(`${unbuilt(root)}\n`)
      return
    }

    const found = assetFor(root, request.url ?? "/")
    if (found === undefined) {
      response.writeHead(404, PLAIN)
      response.end("nothing is served here\n")
      return
    }

    response.writeHead(200, { "content-type": mediaType(found), "cache-control": cacheFor(found) })
    createReadStream(found).pipe(response)
  }

// An IPv6 address is bracketed, or the port reads as another group of it.
export const urlOf = (bound: AddressInfo): string =>
  `http://${bound.address.includes(":") ? `[${bound.address}]` : bound.address}:${bound.port}`

/**
 * The surface holds until the process stops it: `done` completes when the
 * server has closed, and nothing on the page closes it.
 *
 * The ask is the channel's when there is a server, and nobody's when there is
 * not: a surface that bound no port has no page behind it, so every ask it is
 * handed is declined rather than left waiting.
 */
const frontendOf = (done: Effect.Effect<void>, ask: Frontend["ask"] = NOBODY): Frontend => ({
  id: WEB_SURFACE,
  ask,
  done,
})

/**
 * Binds, serves the built page, and holds. The socket opens here and not in
 * the plugin's `effect`, so a build that registers this row opens nothing.
 */
export const serveWeb = Effect.fn(WEB_SURFACE)(function* (options: Serve) {
  const scope = yield* Effect.scope
  const say = options.write ?? (() => undefined)

  /**
   * Refused before a server exists, so this plugin has no path that serves a
   * non-local bind. `apps/cli` refuses the same bind before it boots and that
   * is where the non-zero exit comes from; here is the one place a socket is
   * opened, so it is where the rule holds for every other caller.
   *
   * The refusal is said and nothing is served. A warning above a running
   * server is an unauthenticated server with a note on it.
   */
  const refused = refusal(options.bind.host)
  if (refused !== undefined) {
    say(`${refused}\n`)
    return frontendOf(Effect.void)
  }

  /**
   * The page's own door, made before the server so the server can offer
   * requests to it. It is what turns a question into something a reader can
   * see, and what says whether there is a reader at all.
   */
  const asking = askChannel()
  const server = createServer(answer(options.root, asking.takes, options.api))

  const bound = yield* Effect.callback<AddressInfo | Error>((resume) => {
    server.once("error", (cause) => resume(Effect.succeed(cause)))
    server.listen(options.bind.port, options.bind.host, () =>
      resume(Effect.succeed(server.address() as AddressInfo)),
    )
  })

  /**
   * `start` cannot fail — its error channel is `never` — so a bind that did
   * not happen is said here and the surface stops at once. A process that
   * waits on a server nobody is listening to is worse than one that ends.
   */
  if (bound instanceof Error) {
    say(`${WEB_SURFACE} did not bind ${options.bind.host}:${options.bind.port}: ${bound.message}\n`)
    return frontendOf(Effect.void)
  }

  say(`${urlOf(bound)} · ${WEB_SURFACE} in the ${options.posture} posture\n`)
  // A degradation that says why, rather than a page that 404s every request.
  if (!hasPage(options.root)) say(`${unbuilt(options.root)}\n`)

  /**
   * `close` refuses new connections and waits for the open ones, and a
   * browser holds its keep-alive socket for a minute — so the connections
   * are closed too, or the wait is a hang in `verify` rather than a flake.
   */
  yield* Scope.addFinalizer(
    scope,
    Effect.callback<void>((resume) => {
      server.closeAllConnections()
      server.close(() => resume(Effect.void))
    }),
  )

  return frontendOf(
    Effect.callback<void>((resume) => {
      if (!server.listening) return resume(Effect.void)
      server.once("close", () => resume(Effect.void))
    }),
    asking.ask,
  )
})
