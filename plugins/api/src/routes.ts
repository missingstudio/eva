import type { IncomingMessage, ServerResponse } from "node:http"
import {
  formatModelRef,
  type ModelRef,
  type ResumeTooFarBehind,
  type SessionAPI,
} from "@missingstudio/eva-core"
import { encodePayloadLine, sessionID, type SessionID } from "@missingstudio/eva-schema"
import { dispatch, modelRows, type CatalogState, type CommandInfo } from "@missingstudio/eva-sdk"
import { Effect, Fiber, Stream } from "effect"
import {
  API_ROOT,
  CALLS,
  cursorIn,
  CURSOR,
  CURSOR_REFUSED,
  EVENT_STREAM,
  frameOut,
  IDEMPOTENCY,
  refusalOut,
  WATCH_AT,
  type Call,
  type Method,
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

// A segment is a name, and a name that is not valid percent-encoding names
// nothing. A request a browser can send may never end a server.
const nameOf = (segment: string): string | undefined => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return undefined
  }
}

/**
 * What a path's segment held, or nothing when the path is not that shape. A
 * shape with no segment in it matches on the path alone and holds no name,
 * which is the empty string — that is not "no match", and a row for one of
 * the two calls about the whole runtime reads it and ignores it.
 */
const askedFor = (shape: RegExp, path: string): string | undefined => {
  const found = shape.exec(path)
  if (found === null) return undefined
  const named = found[1]
  return named === undefined ? "" : nameOf(named)
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

// A build that registered no command row. Every line is then a line no
// command answers, which `dispatch` says in words.
const NO_COMMANDS: Effect.Effect<readonly CommandInfo[]> = Effect.succeed([])

/**
 * What a command wrote, as one block. A command writes the lines it has as it
 * has them, and some end in a newline and some do not — so a newline is added
 * only where the writer left one out.
 */
const joined = (said: readonly string[]): string =>
  said.reduce(
    (all, text) => (all === "" || all.endsWith("\n") ? all + text : `${all}\n${text}`),
    "",
  )

/**
 * A line, run where the Domains are. The wire supplies the `CommandContext`,
 * so what a command can reach here is what this door can do: `write` is
 * collected as the text of the answer, `select` names the Session a command
 * opened, and `pick` is absent — the contract says a command that finds a
 * capability absent answers in words instead, so a door that draws no panel
 * gets a listing rather than a wait for an answer that cannot arrive.
 *
 * The Location is this door's too, and it is the same one a `create` with no
 * location is answered in. A command that read the process would open a new
 * Session in the serving directory whatever a suite pinned.
 *
 * `dispatch` has no error channel, so this route cannot fault: a line no
 * command answers is answered in words, with the same status as one that ran.
 */
const commanded =
  (
    commands: Effect.Effect<readonly CommandInfo[]>,
    session: SessionID,
    line: string,
    location: string,
  ): Route =>
  (api) =>
    Effect.gen(function* () {
      const said: string[] = []
      let selected: SessionID | undefined

      const outcome = yield* dispatch(yield* commands, line, (parsed) => ({
        api,
        session,
        location,
        ...(parsed.argument === undefined ? {} : { argument: parsed.argument }),
        write: (text: string) => void said.push(text),
        select: (next: SessionID) => void (selected = next),
      }))

      const wrote =
        outcome.kind === "ran"
          ? joined(said)
          : outcome.kind === "said"
            ? outcome.text
            : "not a command: a line that names none is a Prompt"

      return answering(CALLS.command, {
        wrote,
        ...(selected === undefined ? {} : { selected }),
      })
    })

/**
 * The Catalog a caller that handed none over is answered from. A build that
 * loaded no Provider knows no model, so an empty listing is the truth and
 * never a miss: the wire carries the read, and what it reads may be nothing.
 */
const NOTHING: Effect.Effect<CatalogState> = Effect.succeed({
  providers: new Map(),
  models: new Map(),
})

/**
 * Whether the Catalog holds this model. A Catalog with nothing in it is a
 * build that loaded no Provider: it knows of no model, so it can call none of
 * them wrong — which is the reading `NOTHING` already takes for the read half,
 * where a listing of none is the truth and never a miss.
 */
const holds = (state: CatalogState, model: ModelRef): boolean =>
  state.models.size === 0 || state.models.get(model.provider)?.get(model.model) !== undefined

/**
 * A model this build cannot run. The body is readable and the wire refuses it
 * all the same: a remote door picks from the rows `GET /api/models` answered,
 * so a reference off that list is a page and a Catalog that disagree, and a
 * Session left at a model nothing can serve fails at the next Run instead of
 * here.
 *
 * It is this route's refusal and not the contract's. At the terminal an
 * unlisted reference still runs — a Provider answers anything in its
 * namespace — and `/model` reaches the Domains where the Run is, through the
 * command route and never through this one.
 */
const unheld = (model: ModelRef): Answer => ({
  status: 400,
  body: { error: `the Catalog does not hold ${formatModelRef(model)}` },
})

/**
 * What the process serving this wire is, as against what a request carries.
 * All three are facts of that process and of no request — where it is, which
 * command rows it loaded, what its Catalog holds — so they arrive beside the
 * request rather than being read from inside a route, and they travel as one
 * thing because they never travel apart.
 *
 * `commands` and `catalog` are Effects rather than values because both are
 * read at the moment a request asks for them: a plugin that registers a row
 * after the wire was built is still a row this wire carries.
 */
export interface WireOptions {
  /**
   * Where a Session goes when the caller named nowhere. A page holds no honest
   * path, so the default is the directory the serving process is in — read at
   * the moment of the call, and handed in rather than reached for, so a suite
   * can pin it as it pins a bind.
   */
  readonly directory?: () => string
  readonly commands?: Effect.Effect<readonly CommandInfo[]>
  // The one read on this wire that is not a Session API call at all.
  readonly catalog?: Effect.Effect<CatalogState>
}

/**
 * What a row is answered from. The body and the three facts of the serving
 * process travel together, so a row names only the ones it reads and a new
 * row costs no call site anything.
 */
interface Asked {
  readonly body: unknown
  readonly directory: () => string
  readonly commands: Effect.Effect<readonly CommandInfo[]>
  readonly catalog: Effect.Effect<CatalogState>
}

/**
 * One row of the table: the call it answers, and what it answers with.
 *
 * The call is the wire's own row, so the method this row answers, the path it
 * is matched on, and both shapes that cross it come from the one place the
 * half that asks reads them too. What is left here is the body — which reaches
 * the Session API, or the Domains, or the Catalog — and that is the only part
 * of a call the two halves really do differ about.
 *
 * A row that matched always answers. A body this wire cannot read is
 * `refusing`, which is an answer too; only a path no row states is nothing.
 */
interface Row {
  readonly method: Method
  readonly shape: RegExp
  readonly route: (name: string, asked: Asked) => Route
}

/**
 * A row, from the call it answers. The body is read through the call's own
 * reader before the route is built, so a body this wire cannot read is
 * refused once here rather than in every row that carries one.
 *
 * `name` is what the path's segment held, and it is the empty string for the
 * two calls whose path has none.
 */
const on = <Req, Ans>(
  one: Call<Req, Ans>,
  route: (asked: Asked, name: string, body: Req) => Route,
): Row => ({
  method: one.method,
  shape: one.shape,
  route: (name, asked) => {
    const body = one.body.reads(asked.body)
    return body === undefined ? refusing : route(asked, name, body)
  },
})

// What a call answers with, spelled through the call's own writer. A route
// that named a field would be a second spelling of the agreement.
const answering = <Req, Ans>(one: Call<Req, Ans>, answer: Ans): Answer => ({
  status: 200,
  body: one.answer.writes(answer),
})

/**
 * Both halves `eva.api` carries as a body, in one table. `watch` is in
 * neither: it answers a stream rather than a body, so it has a table of its
 * own that is matched first.
 *
 * The rows are read in order and the first match answers. A `POST` opens or
 * stops work, a `PUT` sets a value, and a `DELETE` puts a Session away. So
 * asking twice is what tells them apart: the same `PUT` or `DELETE` twice
 * leaves the same state and the same answer, and the same `POST` twice would
 * be a second Run — which is what the idempotency key exists for.
 */
const ROUTES: readonly Row[] = [
  on(CALLS.list, () => (api) => Effect.map(api.list, (rows) => answering(CALLS.list, rows))),

  /**
   * What this build can run, as the rows a picker draws. The terminal reads
   * its own Catalog in process and a page holds none, so this is the read
   * half of one fact — and it is `modelRows` and not a second derivation of
   * it, which is what stops the two pickers from offering different models.
   *
   * A `PickRow` is JSON already, so the wire adds no envelope here either.
   */
  on(
    CALLS.models,
    ({ catalog }) =>
      () =>
        Effect.map(catalog, (state) => answering(CALLS.models, modelRows(state))),
  ),

  /**
   * Scoped here, and everything the answer needs read inside it. `attach` is
   * the one read that asks for a Scope, and a socket callback is not an
   * Effect — so the request that opened the Scope is what closes it, and
   * nothing outlives the answer it was opened for.
   */
  on(CALLS.attach, (_asked, name) => {
    const asked = sessionID(name)
    return (api) =>
      Effect.scoped(
        Effect.map(api.attach(asked), (record) => answering(CALLS.attach, record.events())),
      )
  }),

  on(CALLS.readModel, (_asked, name) => {
    const asked = sessionID(name)
    return (api) => Effect.map(api.model.get(asked), (found) => answering(CALLS.readModel, found))
  }),

  /**
   * The one write that answers a value: what a caller asked for is the
   * Session, and a status alone would not say which one.
   */
  on(CALLS.create, ({ directory }, _name, opening) => {
    const where = opening.location ?? directory()
    return (api) => Effect.map(api.create(where), (made) => answering(CALLS.create, made))
  }),

  on(CALLS.submit, (_asked, name, input) => {
    const asked = sessionID(name)
    return (api) => Effect.as(api.submit(asked, input), DONE)
  }),

  on(CALLS.cancel, (_asked, name, cause) => {
    const asked = sessionID(name)
    return (api) => Effect.as(api.cancel(asked, cause), DONE)
  }),

  on(CALLS.command, ({ commands, directory }, name, line) =>
    commanded(commands, sessionID(name), line, directory()),
  ),

  on(CALLS.retire, (_asked, name) => {
    const asked = sessionID(name)
    return (api) => Effect.as(api.retire(asked), DONE)
  }),

  on(CALLS.setModel, ({ catalog }, name, model) => {
    const asked = sessionID(name)
    return (api) =>
      Effect.flatMap(catalog, (state) =>
        holds(state, model)
          ? Effect.as(api.model.set(asked, model), DONE)
          : Effect.succeed(unheld(model)),
      )
  }),

  on(CALLS.answer, (_asked, name, given) => (api) => Effect.as(api.answer(name, given), DONE)),
]

/**
 * The row this request is answered by, or nothing when no row states it.
 *
 * The body arrives as a third argument, the way `watchFor` takes the Cursor
 * it read off a header. So a write route is still a description of an answer
 * and this is still a pure function — the socket reads the bytes and this
 * decides what they mean.
 *
 * The serving process arrives as the fourth, whole. A wire that took its
 * three facts as three trailing arguments made every call site name the ones
 * it did not care about.
 */
export const routeFor = (
  method: string,
  path: string,
  body?: unknown,
  serving: WireOptions = {},
): Route | undefined => {
  const asked: Asked = {
    body,
    directory: serving.directory ?? HERE,
    commands: serving.commands ?? NO_COMMANDS,
    catalog: serving.catalog ?? NOTHING,
  }

  for (const row of ROUTES) {
    if (row.method !== method) continue
    const named = askedFor(row.shape, path)
    if (named !== undefined) return row.route(named, asked)
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

  const watching = askedFor(WATCH_AT, path)
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
 * `serving` is what the process behind this wire is. `directory` is where a
 * Session goes when the caller named nowhere, and it is that process's own by
 * default; a caller may hand over another, as the composition root hands
 * `eva.web` a bind and a writer.
 *
 * `commands` is the rows a line resolves through. They are this process's,
 * which is the whole of why a command crosses the wire at all: a door that
 * ran `/mode` for itself would change the approval state of the process it
 * runs in, and the Run is in this one.
 *
 * `catalog` is what this build can run, handed in from the same context and
 * for the same reason: a wire may not import the plugin that fills the
 * Catalog, and a plugin reads every Domain from the context it loads with.
 */
export const apiWire = (api: SessionAPI, serving: WireOptions = {}): Answering => {
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
        const route = routeFor(method, asked, body, serving)
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
