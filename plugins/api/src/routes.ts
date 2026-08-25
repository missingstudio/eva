import type { IncomingMessage, ServerResponse } from "node:http"
import type { ResumeTooFarBehind, SessionAPI } from "@missingstudio/eva-core"
import { encodePayloadLine, sessionID } from "@missingstudio/eva-schema"
import { Effect, Stream } from "effect"
import {
  API_ROOT,
  cursorIn,
  CURSOR,
  CURSOR_REFUSED,
  eventsOut,
  EVENT_STREAM,
  frameOut,
  refusalOut,
  SESSIONS,
  type StreamFrame,
} from "./wire.js"

/**
 * Something that may answer a request, and says whether it did. The socket
 * belongs to `eva.web` and this is what it offers a request to first: a
 * plugin may not import a plugin, so the composition root takes the half
 * that answers and hands it to the half that binds.
 *
 * `plugins/web` declares the same type under the same name, because a plugin
 * may not import a plugin. Two copies of one agreement are unavoidable here;
 * two names for it would not be, and a reader would take them for two things.
 */
export type Answering = (request: IncomingMessage, response: ServerResponse) => boolean

// What one request is answered with. A route is a description and not a
// write, so the table is a pure function and the socket is thin around it.
export interface Answer {
  readonly status: number
  readonly body: unknown
}

export type Route = (api: SessionAPI) => Effect.Effect<Answer>

const SESSION = new RegExp(`^${SESSIONS}/([^/]+)$`)
const MODEL = new RegExp(`^${SESSIONS}/([^/]+)/model$`)
const WATCH = new RegExp(`^${SESSIONS}/([^/]+)/watch$`)

// A segment is a name, and a name that is not valid percent-encoding names
// nothing. A request a browser can send may never end a server.
const nameOf = (segment: string): string | undefined => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return undefined
  }
}

// Which Session a path names, or nothing when the path is not that shape.
const askedFor = (shape: RegExp, path: string): string | undefined => {
  const named = shape.exec(path)?.[1]
  return named === undefined ? undefined : nameOf(named)
}

/**
 * The read half `eva.api` carries as a body, and no more of it. `watch` is
 * not here: it answers a stream rather than a body, so it has a table of its
 * own that is matched first. The write half is stage 2's, against the
 * permission gate that stage builds anyway.
 *
 * `create` is in neither half: a page that takes no input opens no Session.
 */
export const routeFor = (method: string, path: string): Route | undefined => {
  if (method !== "GET") return undefined

  if (path === SESSIONS) {
    return (api) => Effect.map(api.list, (rows) => ({ status: 200, body: rows }))
  }

  const attaching = askedFor(SESSION, path)
  if (attaching !== undefined) {
    const asked = sessionID(attaching)
    /**
     * Scoped here, and everything the answer needs read inside it. `attach`
     * is the one read that asks for a Scope, and a socket callback is not an
     * Effect — so the request that opened the Scope is what closes it, and
     * nothing outlives the answer it was opened for.
     */
    return (api) =>
      Effect.scoped(
        Effect.map(api.attach(asked), (record) => ({
          status: 200,
          body: eventsOut(record.events()),
        })),
      )
  }

  const session = askedFor(MODEL, path)
  if (session !== undefined) {
    const asked = sessionID(session)
    return (api) => Effect.map(api.model.get(asked), (found) => ({ status: 200, body: found }))
  }

  return undefined
}

/**
 * A stream this wire may answer with. It is a description like a `Route` is:
 * nothing is subscribed to until something runs it, so this table is a pure
 * function too and the socket stays thin around it.
 */
export type Watching = (api: SessionAPI) => Stream.Stream<StreamFrame, ResumeTooFarBehind>

/**
 * The one method that is one way. It has its own table because a `Route`
 * answers a body and this answers frames until the reader goes — and because
 * a Cursor rides a request header, which no body route reads.
 *
 * **Where the position comes from.** `watch` hands back Payloads and not
 * Events, so there is no `seq` on a frame to copy. With a Cursor there is one
 * to count: the contract says the committed payloads after that position, in
 * trace order, exactly once — so the nth frame sits at `from.seq + n`, and
 * that is exact rather than a guess.
 *
 * With no Cursor there is nothing to count from. What that form carries is
 * the live stream, which is payloads the sink has not numbered — so those
 * frames carry **no `id:` at all**. It reads like an off-by-one until you see
 * why: a frame with an invented position is a position a page would resume
 * from, and it would resume past events it never saw.
 *
 * The count is exact only while the cursor form keeps its word. One payload
 * on it that was never committed puts every `id:` after that frame one past
 * the truth, so a filler that answers a Cursor with a caveat or a live delta
 * corrupts the wire and not only itself.
 */
export const watchFor = (
  method: string,
  path: string,
  from: number | undefined,
): Watching | undefined => {
  if (method !== "GET") return undefined

  const watching = askedFor(WATCH, path)
  if (watching === undefined) return undefined

  const asked = sessionID(watching)
  return (api) => {
    if (from === undefined) {
      return Stream.map(api.watch(asked), (payload) => ({ data: encodePayloadLine(payload) }))
    }
    // Suspended, so the count belongs to one run of this stream and not to the
    // description of it. A description counted once would count on from there.
    return Stream.suspend(() => {
      let counted = from
      return Stream.map(api.watch(asked, { session: asked, seq: from }), (payload) => {
        counted += 1
        return { seq: counted, data: encodePayloadLine(payload) }
      })
    })
  }
}

const HEAD = {
  "content-type": "application/json; charset=utf-8",
  // The record as it stands, every time. A listing held from before the last
  // Run is a listing that is wrong.
  "cache-control": "no-store",
}

const STREAM = {
  "content-type": `${EVENT_STREAM}; charset=utf-8`,
  "cache-control": "no-store",
  connection: "keep-alive",
}

/**
 * The stream, written until it ends or the reader goes.
 *
 * The head is held back until the first frame, so the refusal a cursor watch
 * can answer with is still a status on this response — it is decided before
 * anything is said, and a stream that has already said 200 cannot take it
 * back.
 *
 * The response closing is what stops this. An open stream nobody is reading
 * is a `node:http` server that never closes, so the reader going is a race
 * this loses on purpose: `server.close()` has nothing left to wait for.
 */
const streamed = (
  response: ServerResponse,
  frames: Stream.Stream<StreamFrame, ResumeTooFarBehind>,
): Effect.Effect<void> => {
  const written = Stream.runForEach(frames, (frame) =>
    Effect.sync(() => {
      if (!response.headersSent) response.writeHead(200, STREAM)
      response.write(frameOut(frame))
    }),
  )

  const refused = Effect.catchTag(written, "ResumeTooFarBehind", (found) =>
    Effect.sync(() => {
      // Nothing has been said, by the contract this refusal comes from. A head
      // already sent means the far side changed its mind, and the only honest
      // answer left is to stop talking.
      if (response.headersSent) return
      response.writeHead(CURSOR_REFUSED, HEAD)
      response.write(`${JSON.stringify(refusalOut(found))}\n`)
    }),
  )

  const gone = Effect.callback<void>((resume) => {
    if (response.writableEnded) return resume(Effect.void)
    response.once("close", () => resume(Effect.void))
  })

  return Effect.ensuring(
    Effect.race(refused, gone),
    Effect.sync(() => {
      if (!response.writableEnded) response.end()
    }),
  )
}

/**
 * A path under the root that no route carries. It is refused here rather than
 * left to fall through, because the page's own server answers an unknown path
 * with the page: a call answered with HTML reads as a broken parse instead of
 * as a miss.
 */
const MISS: Answer = { status: 404, body: { error: "the wire does not carry this" } }

// One header, as one value. `node:http` gives a repeated header back as a
// list, and a request that sent a position twice named no position.
const headerOf = (request: IncomingMessage, name: string): string | undefined => {
  const found = request.headers[name]
  return typeof found === "string" ? found : undefined
}

// The request path, with the query and the fragment off it. Undecoded: a
// segment is decoded where it is read, so a name carrying a slash cannot
// become two segments.
const pathOf = (url: string): string | undefined => {
  try {
    return new URL(url, "http://eva.invalid").pathname
  } catch {
    return undefined
  }
}

/**
 * Everything under the root, answered from the contract it was given. Which
 * filler that is — the kernel's, or one a suite stands up — is not a fact
 * this wire holds: it calls the Session API as any other caller does.
 */
export const apiWire =
  (api: SessionAPI): Answering =>
  (request, response) => {
    const asked = pathOf(request.url ?? "/")
    if (asked === undefined || !(asked === API_ROOT || asked.startsWith(`${API_ROOT}/`))) {
      return false
    }

    const method = request.method ?? "GET"
    /**
     * The stream first, because a body route cannot answer one. Forked in
     * both cases, because a socket callback is not an Effect: a route that
     * needs a Scope closes its own, and a stream ends when the reader does,
     * so nothing here outlives the request that asked for it.
     */
    const streaming = watchFor(method, asked, cursorIn(headerOf(request, CURSOR)))
    if (streaming !== undefined) {
      Effect.runFork(streamed(response, streaming(api)))
      return true
    }

    const route = routeFor(method, asked)
    Effect.runFork(
      Effect.map(route === undefined ? Effect.succeed(MISS) : route(api), (answer) => {
        response.writeHead(answer.status, HEAD)
        response.end(`${JSON.stringify(answer.body)}\n`)
      }),
    )
    return true
  }
