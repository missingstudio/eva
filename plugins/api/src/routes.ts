import type { IncomingMessage, ServerResponse } from "node:http"
import type { ResumeTooFarBehind, SessionAPI } from "@missingstudio/eva-core"
import { encodePayloadLine, sessionID } from "@missingstudio/eva-schema"
import { Effect, Fiber, Stream } from "effect"
import {
  answerIn,
  API_ROOT,
  cancelCauseIn,
  cursorIn,
  CURSOR,
  CURSOR_REFUSED,
  eventsOut,
  EVENT_STREAM,
  frameOut,
  IDEMPOTENCY,
  locationIn,
  modelIn,
  refusalOut,
  REQUESTS,
  SESSIONS,
  submitInputIn,
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
const CANCEL = new RegExp(`^${SESSIONS}/([^/]+)/cancel$`)
const REQUEST = new RegExp(`^${REQUESTS}/([^/]+)$`)

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
 * A write answers nothing. The wire adds no envelope to say it with, so what
 * travels is JSON's own nothing and the status is the whole of the answer.
 */
const DONE: Answer = { status: 200, body: null }

/**
 * A body this wire cannot read. The path is carried, so this is not a miss:
 * the two halves disagree about a shape, which a caller has to hear rather
 * than ask again about forever. Nothing is written before it is refused.
 */
const UNREADABLE: Answer = { status: 400, body: { error: "the wire cannot read this body" } }

const refusing: Route = () => Effect.succeed(UNREADABLE)

/**
 * Where a Session goes when the caller named nowhere. A browser holds no
 * honest path, so the honest answer is the directory the process answering
 * the call is in — read at the moment of the call, and handed in rather than
 * reached for, so a suite can pin it as it pins a bind.
 */
const HERE = (): string => process.cwd()

/**
 * Both halves `eva.api` carries as a body. `watch` is in neither: it answers
 * a stream rather than a body, so it has a table of its own that is matched
 * first.
 *
 * The body arrives as a third argument, the way `watchFor` takes the Cursor
 * it read off a header. So a write route is still a description of an answer
 * and this table is still a pure function — the socket reads the bytes and
 * this decides what they mean.
 *
 * `directory` is the fourth for the same reason: where the serving process is
 * is a fact of that process and not of the request, so it arrives beside the
 * request rather than being read from inside a route.
 */
export const routeFor = (
  method: string,
  path: string,
  body?: unknown,
  directory: () => string = HERE,
): Route | undefined => {
  if (method === "GET") {
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
   * A `POST` opens or stops work and a `PUT` sets a value. So asking twice is
   * what tells the two apart: the same `PUT` twice leaves the same model and
   * the same answer, and the same `POST` twice would be a second Run — which
   * is what the idempotency key exists for.
   */
  if (method === "POST") {
    /**
     * Before the Session match, which needs a segment this path does not
     * have. It is the one write that answers a value: what a caller asked for
     * is the Session, and a status alone would not say which one.
     */
    if (path === SESSIONS) {
      const opening = locationIn(body)
      if (opening === undefined) return refusing
      const where = opening.location ?? directory()
      return (api) => Effect.map(api.create(where), (made) => ({ status: 200, body: made }))
    }

    const prompting = askedFor(SESSION, path)
    if (prompting !== undefined) {
      const input = submitInputIn(body)
      if (input === undefined) return refusing
      const asked = sessionID(prompting)
      return (api) => Effect.as(api.submit(asked, input), DONE)
    }

    const stopping = askedFor(CANCEL, path)
    if (stopping !== undefined) {
      const cause = cancelCauseIn(body)
      if (cause === undefined) return refusing
      const asked = sessionID(stopping)
      return (api) => Effect.as(api.cancel(asked, cause), DONE)
    }

    return undefined
  }

  if (method === "PUT") {
    const session = askedFor(MODEL, path)
    if (session !== undefined) {
      const model = modelIn(body)
      if (model === undefined) return refusing
      const asked = sessionID(session)
      return (api) => Effect.as(api.model.set(asked, model), DONE)
    }

    // A `RequestID` is not a `SessionID`, so this is the one write that sits
    // outside the listing. The id is the tool call's, which the `tool_call`
    // record named before anybody was asked.
    const request = askedFor(REQUEST, path)
    if (request !== undefined) {
      const given = answerIn(body)
      if (given === undefined) return refusing
      return (api) => Effect.as(api.answer(request, given), DONE)
    }

    return undefined
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
 * The count rests on that contract. One payload on the cursor form that was
 * never committed puts every `id:` after it one past the truth.
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
 * What a request carries, as JSON. Bytes are all this reads: what the shape
 * has to be to be a write is the route table's judgement, and a body that is
 * not JSON at all names no shape either way.
 *
 * A GET carries no body, so nothing is read for one.
 */
const bodyOf = (request: IncomingMessage): Effect.Effect<unknown> =>
  Effect.callback<unknown>((resume) => {
    let text = ""
    request.setEncoding("utf8")
    request.on("data", (chunk: string) => void (text += chunk))
    request.on("error", () => resume(Effect.succeed(undefined)))
    request.on("end", () => {
      try {
        resume(Effect.succeed(JSON.parse(text) as unknown))
      } catch {
        resume(Effect.succeed(undefined))
      }
    })
  })

// The write a key names, and what is answering it.
interface Once {
  readonly key: string
  readonly fiber: Fiber.Fiber<Answer>
}

/**
 * Everything under the root, answered from the contract it was given. Which
 * filler that is — the kernel's, or one a suite stands up — is not a fact
 * this wire holds: it calls the Session API as any other caller does.
 *
 * `directory` is where a Session goes when the caller named nowhere, and it
 * is the serving process's own by default. A caller may hand over another,
 * as the composition root hands `eva.web` a bind and a writer.
 */
export const apiWire = (api: SessionAPI, directory?: () => string): Answering => {
  /**
   * The write each path is answering, under the key its caller named. A write
   * has no error channel, so a caller that could not reach this side waits
   * and asks again — and a `submit` asked again would open a second Run.
   *
   * So a repeat of a key waits on the write it already made. The fiber is
   * forked rather than run inside the request, which is also what keeps a
   * dropped connection costing a repaint rather than a Run: the Run finishes
   * and the record is where its outcome is.
   *
   * One entry per path, holding the last key, because a caller retries the
   * write it just made and never an older one. Two callers writing to one
   * Session at once already collide inside the Recorder, and this neither
   * makes that worse nor pretends to fix it.
   */
  const answering = new Map<string, Once>()

  const once = (path: string, key: string | undefined, route: Route): Effect.Effect<Answer> => {
    if (key === undefined) return route(api)
    const held = answering.get(path)
    if (held?.key === key) return Fiber.join(held.fiber)
    const fiber = Effect.runFork(route(api))
    answering.set(path, { key, fiber })
    return Fiber.join(fiber)
  }

  return (request, response) => {
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

    const read = method === "GET" ? Effect.succeed(undefined) : bodyOf(request)
    Effect.runFork(
      Effect.flatMap(read, (body) => {
        const route = routeFor(method, asked, body, directory)
        const answered =
          route === undefined
            ? Effect.succeed(MISS)
            : once(asked, headerOf(request, IDEMPOTENCY), route)
        return Effect.map(answered, (answer) => {
          response.writeHead(answer.status, HEAD)
          response.end(`${JSON.stringify(answer.body)}\n`)
        })
      }),
    )
    return true
  }
}
