import type { Transport, TransportHealth } from "@missingstudio/eva-client-runtime"
import {
  foldTranscript,
  shortID,
  type ResumeTooFarBehind,
  type SessionAPI,
} from "@missingstudio/eva-core"
import type { Cursor, Payload, SessionID } from "@missingstudio/eva-schema"
import type { Running } from "@missingstudio/eva-sdk"
import { Effect, Schedule, Scope, Stream, SubscriptionRef } from "effect"
import {
  CALLS,
  CURSOR,
  CURSOR_REFUSED,
  EVENT_STREAM,
  framesIn,
  IDEMPOTENCY,
  payloadIn,
  refusalIn,
  watchPath,
  type Call,
  type PickRow,
} from "../wire.js"

// How long a call that could not reach the far side waits before it asks
// again, in milliseconds.
export const RETRY_GAP = 500

// What makes one request. The global, unless a caller hands over its own — a
// suite that must take the pipe away does it here and not with a firewall.
export type Request = typeof globalThis.fetch

export interface HttpOptions {
  /**
   * Where the wire is. Nothing is the origin the page was served by, which is
   * what the page uses: `eva.web` serves the page and `eva.api` answers
   * beside it on the one port, so the page knows no address.
   */
  readonly origin?: string
  readonly gap?: number
  readonly request?: Request
}

/**
 * The options, with the defaults filled in. Two calls read them — the Catalog's
 * rows and the Transport — and the defaults are one rule for both: the origin
 * the page was served by, and the global fetch.
 */
const settled = (options: HttpOptions) => ({
  origin: options.origin ?? "",
  gap: options.gap ?? RETRY_GAP,
  request: options.request ?? fetch,
})

/**
 * A write the far side read and refused. Asking again forever would turn a
 * report into a hang, so it is a defect where the call was made — and it is
 * said out loud first, on the channel below, because a caller that never
 * hears it is a surface that shows a write nobody made.
 *
 * It is the only defect this filler raises. `SessionAPI` is one interface and
 * a filler answers all of it, and this one now reaches all ten methods — so
 * there is no method left that says it is not carried.
 */
export class Refused extends Error {
  override readonly name = "Refused"
}

/**
 * What the far side refused, in the words it refused it with. A refusal is a
 * decision somebody made about this write, so it is carried whole rather than
 * classified: the far side knows why, and this side would only be guessing.
 */
export interface Refusal {
  readonly said: string
}

/**
 * The refusal, as a person reads it. The far side answers a refused write
 * with a reason, and the reason is the half a person can act on — so it is
 * quoted rather than replaced, under a lead that says who refused.
 *
 * A body carrying no reason is a far side this build cannot quote. It says so
 * rather than inventing one, and never says which path answered: what a
 * surface draws ends up in screenshots.
 */
const refusalOf = (body: unknown): Refusal => {
  const said =
    typeof body === "object" && body !== null ? (body as { readonly error?: unknown }).error : ""
  return {
    said:
      typeof said === "string" && said !== ""
        ? `Eva refused this: ${said}`
        : "Eva refused this, and gave no reason this page can read.",
  }
}

// The far side did not answer, or did not answer the wire. It never leaves
// this module.
class Unreachable extends Error {
  override readonly name = "Unreachable"
}

/**
 * The transport, and the one thing beside the contract that crosses this
 * wire. A command is not a `SessionAPI` method and it is not going to become
 * one: it reaches Domains rather than a Session, and `Transport` is the seam
 * the runtime reads. So it rides beside `api` — a caller that holds this
 * filler can run a line, and one that holds only the seam cannot.
 */
export interface HttpTransport extends Transport {
  readonly command: Running

  /**
   * What the far side refused, as it refuses it. Nothing until one is
   * refused, and the last one after that.
   *
   * It rides beside `health` for the reason `command` rides beside `api`: the
   * seam carries neither, and both are facts only a wire has. A drop and a
   * refusal are the two things that happen to a write out here, and they are
   * two channels because they are two facts — a drop is a gap the runtime
   * closes by asking again, and a refusal is a decision that will not change
   * however often it is asked.
   */
  readonly refusals: SubscriptionRef.SubscriptionRef<Refusal | undefined>
}

/**
 * One read, as JSON.
 *
 * The page's own server answers an unknown path with the page, so an answer
 * that is not JSON is not this wire answering — a build carrying no `eva.api`
 * reads as a pipe that is down, which is what it is.
 */
const read = async (
  asking: Request,
  origin: string,
  path: string,
  signal: AbortSignal,
): Promise<unknown> => {
  const response = await asking(`${origin}${path}`, { signal })
  if (!response.ok) throw new Unreachable(`${path} answered ${response.status}`)
  const kind = response.headers.get("content-type") ?? ""
  if (!kind.includes("application/json")) {
    throw new Unreachable(`${path} answered ${kind === "" ? "nothing" : kind}`)
  }
  return (await response.json()) as unknown
}

/**
 * Every model the Catalog behind this wire knows, as the rows a picker draws.
 *
 * It is beside the Transport and not inside it: a Catalog is a fact of the
 * build and not of a Session, so this is no `SessionAPI` call and belongs
 * behind none. Nothing is what a wire that did not answer rows gives back — a
 * picker with nothing to show says so, and never shows a list it invented.
 */
export const readModels = (
  options: HttpOptions = {},
): Effect.Effect<readonly PickRow[] | undefined> =>
  Effect.suspend(() => {
    const { origin, request } = settled(options)
    return Effect.map(
      Effect.result(
        Effect.tryPromise({
          try: (signal) => read(request, origin, CALLS.models.at(""), signal),
          catch: (cause) => new Unreachable(String(cause)),
        }),
      ),
      (answered) =>
        answered._tag === "Success" ? CALLS.models.answer.reads(answered.success) : undefined,
    )
  })

/**
 * The whole Session API over HTTP, and the one fact `client-runtime` reads
 * about the pipe. It is the seam's second filler: the runtime calls the
 * contract and never learns that this answer crossed a socket.
 */
export const httpTransport = (options: HttpOptions = {}): Effect.Effect<HttpTransport> =>
  Effect.gen(function* () {
    const health = yield* SubscriptionRef.make<TransportHealth>("ready")
    const refusals = yield* SubscriptionRef.make<Refusal | undefined>(undefined)
    const { origin, gap, request } = settled(options)

    /**
     * One call, and the pipe's state as it answers. `SessionAPI` carries no
     * error channel and the seam keeps it that way, so a call that cannot
     * reach the far side waits and asks again: a call made while the pipe is
     * down is slower, never differently typed.
     *
     * A spaced schedule never gives up, so the failure `orDie` names cannot
     * arrive — it is how the type says the call has none.
     */
    const call = <A>(path: string, shape: (body: unknown) => A | undefined): Effect.Effect<A> =>
      Effect.tap(
        Effect.orDie(
          Effect.retry(
            Effect.tapError(
              Effect.flatMap(
                Effect.tryPromise({
                  try: (signal) => read(request, origin, path, signal),
                  catch: (cause) => new Unreachable(String(cause)),
                }),
                (body) => {
                  const found = shape(body)
                  return found === undefined
                    ? Effect.fail(new Unreachable(`${path} answered a shape this cannot read`))
                    : Effect.succeed(found)
                },
              ),
              () => SubscriptionRef.set(health, "disconnected"),
            ),
            Schedule.spaced(gap),
          ),
        ),
        () => SubscriptionRef.set(health, "ready"),
      )

    /**
     * One write, sent, and what the far side said back — `null` from a write
     * that answers nothing, and the Session from the one that opens one. A
     * `Refused` is a write the far side read and would refuse again however
     * often it is asked. Anything else is not this wire answering, which is
     * the same fact as a pipe that is down.
     */
    const send = async (
      method: string,
      path: string,
      body: unknown,
      key: string,
      signal: AbortSignal,
    ): Promise<Refused | { readonly said: unknown }> => {
      const response = await request(`${origin}${path}`, {
        method,
        signal,
        headers: { "content-type": "application/json", [IDEMPOTENCY]: key },
        body: JSON.stringify(body),
      })

      const kind = response.headers.get("content-type") ?? ""
      const json = kind.includes("application/json")
      if (response.ok) return { said: json ? ((await response.json()) as unknown) : undefined }
      // A body this cannot read is a refusal with no reason, never a retry:
      // the far side has decided, and reading its answer badly does not
      // change that.
      if (json) {
        const read = await response.json().catch(() => undefined)
        return new Refused(refusalOf(read).said)
      }
      throw new Unreachable(`${path} answered ${kind === "" ? "nothing" : kind}`)
    }

    /**
     * One write, and the pipe's state as it answers. It keeps `call`'s rule —
     * a write that cannot reach the far side waits and asks again, because
     * `SessionAPI` gives a write no error channel either.
     *
     * The key is minted once, before the first send, so every retry of this
     * write names the same one. That is what makes asking again safe: a
     * `submit` whose answer was lost is answered from the Run it already
     * opened rather than opening a second, and a `create` whose answer was
     * lost hands back the Session it already opened rather than a second one.
     *
     * `shape` is what that answer has to be. `create` is the one write that
     * answers a value, and it is read here the way `call` reads a read.
     */
    const writing = <A>(
      method: string,
      path: string,
      body: unknown,
      shape: (said: unknown) => A | undefined,
    ): Effect.Effect<A> =>
      Effect.suspend(() => {
        const key = shortID()
        return Effect.tap(
          Effect.orDie(
            Effect.retry(
              Effect.tapError(
                Effect.flatMap(
                  Effect.tryPromise({
                    try: (signal) => send(method, path, body, key, signal),
                    catch: (cause) => new Unreachable(String(cause)),
                  }),
                  (answered) => {
                    /*
                      Said before it dies. The die stops the retry, and every
                      caller of this filler holds a `SessionAPI` with no error
                      channel — so the channel is how a refusal reaches the
                      person who asked for the write.
                    */
                    if (answered instanceof Refused) {
                      return Effect.flatMap(
                        SubscriptionRef.set(refusals, { said: answered.message }),
                        () => Effect.die(answered),
                      )
                    }
                    const found = shape(answered.said)
                    return found === undefined
                      ? Effect.fail(new Unreachable(`${path} answered a shape this cannot read`))
                      : Effect.succeed(found)
                  },
                ),
                () => SubscriptionRef.set(health, "disconnected"),
              ),
              Schedule.spaced(gap),
            ),
          ),
          () => SubscriptionRef.set(health, "ready"),
        )
      })

    // A pipe that is not answering, said where it can be acted on. The watch
    // ends and no error channel carries it, which is the rule every filler of
    // this seam keeps: catching up is the caller's, by Cursor.
    const dropped: Effect.Effect<Stream.Stream<Payload>> = Effect.as(
      SubscriptionRef.set(health, "disconnected"),
      Stream.empty,
    )

    /**
     * The bytes, as the payloads they carry. A frame this cannot read ends the
     * watch and takes `health` with it: a far side saying a shape this side
     * cannot read is a far side this side cannot read, and that is the same
     * fact as a pipe that dropped.
     *
     * A position on a frame is not kept. A reader of a stream holds no honest
     * Cursor — its only honest positions are folds — so `id:` is on the wire
     * for whoever resumes with it and is remembered nowhere here.
     */
    const framed = (body: ReadableStream<Uint8Array>): Stream.Stream<Payload> =>
      Stream.catchIf(
        Stream.mapEffect(
          Stream.mapAccum(
            Stream.decodeText(
              Stream.fromReadableStream({
                evaluate: () => body,
                onError: (cause) => new Unreachable(String(cause)),
              }),
            ),
            () => "",
            (rest: string, chunk: string) => {
              const read = framesIn(rest + chunk)
              return [read.rest, read.frames] as const
            },
          ),
          (frame) => {
            const said = payloadIn(frame)
            return said === undefined
              ? Effect.fail(new Unreachable("the stream said a shape this cannot read"))
              : Effect.succeed(said)
          },
        ),
        (cause): cause is Unreachable => cause instanceof Unreachable,
        () => Stream.unwrap(dropped),
      )

    /**
     * The stream, opened. A Cursor rides `Last-Event-ID`, which is SSE's own
     * name for the last position a reader saw — so a page that chose its
     * position and a browser that reconnected on its own send the same thing.
     *
     * A refusal arrives before the stream does, as a status, and is handed
     * back as the tagged error it was: a caller sees what the local filler
     * fails with, not an HTTP fault.
     */
    const opened = (
      session: SessionID,
      from: Cursor | undefined,
    ): Effect.Effect<Stream.Stream<Payload>, ResumeTooFarBehind, Scope.Scope> =>
      Effect.gen(function* () {
        // Aborted when the scope closes, so a watch that is interrupted lets
        // go of the socket rather than reading a stream nobody wants.
        const stopping = yield* Effect.acquireRelease(
          Effect.sync(() => new AbortController()),
          (one) => Effect.sync(() => one.abort()),
        )

        const answered = yield* Effect.result(
          Effect.tryPromise({
            try: () =>
              request(`${origin}${watchPath(session)}`, {
                signal: stopping.signal,
                ...(from === undefined ? {} : { headers: { [CURSOR]: String(from.seq) } }),
              }),
            catch: (cause) => new Unreachable(String(cause)),
          }),
        )

        /**
         * A pipe that did not answer says so through `health` and the watch
         * ends, which is the rule every filler of this seam keeps: a drop is
         * said where it can be acted on and never through an error channel.
         * Catching up is the caller's, and it is what a Cursor is for.
         */
        if (answered._tag === "Failure") return yield* dropped

        const response = answered.success
        if (from !== undefined && response.status === CURSOR_REFUSED) {
          const body = yield* Effect.result(
            Effect.tryPromise({
              try: () => response.json() as Promise<unknown>,
              catch: (cause) => new Unreachable(String(cause)),
            }),
          )
          const refused = body._tag === "Success" ? refusalIn(from, body.success) : undefined
          if (refused !== undefined) return yield* Effect.fail(refused)
        }

        const kind = response.headers.get("content-type") ?? ""
        if (!response.ok || response.body === null || !kind.includes(EVENT_STREAM)) {
          return yield* dropped
        }

        yield* SubscriptionRef.set(health, "ready")
        return framed(response.body)
      })

    /**
     * One read, through the call that says where it is asked and what its
     * answer has to be. The path and the reader are the wire's row, so this
     * half cannot ask on a path the other half does not answer, or read an
     * answer it does not write.
     */
    const asks = <Req, Ans>(row: Call<Req, Ans>, name: string): Effect.Effect<Ans> =>
      call(row.at(name), row.answer.reads)

    // One write, through the call that says its method, its path, and both
    // shapes that cross it.
    const tells = <Req, Ans>(row: Call<Req, Ans>, name: string, body: Req): Effect.Effect<Ans> =>
      writing(row.method, row.at(name), row.body.writes(body), row.answer.reads)

    // A write whose answer is the status. The row says so, and `nothing`
    // reads any body at all.
    const told = <Req>(row: Call<Req, null>, name: string, body: Req): Effect.Effect<void> =>
      Effect.asVoid(tells(row, name, body))

    const api: SessionAPI = {
      list: asks(CALLS.list, ""),
      /**
       * The one write with no body at all. What a `DELETE` acts on is the
       * path, so there is nothing left to carry — and it is a `DELETE` and
       * not a `POST` because asking twice leaves the Session exactly where
       * asking once left it, which is the line this wire draws between the
       * two.
       */
      retire: (session) => told(CALLS.retire, session, null),
      model: {
        get: (session) => asks(CALLS.readModel, session),
        set: (session, model) => told(CALLS.setModel, session, model),
      },
      /**
       * The one write that answers a value. A page holds no honest path, so
       * the location it names is the one it was given — and a page that names
       * none leaves the serving process to answer with its own directory.
       */
      create: (location) => tells(CALLS.create, "", location === undefined ? {} : { location }),
      /**
       * The record arrives and the fold happens here. So the Cursor is not
       * read off the wire either — this fold ends where the far side's ended,
       * because both read the same events.
       *
       * No price lookup: a rate is not a fact about the Session and this side
       * holds no Catalog, so what a caller is shown is the reported cost and
       * never an estimate worked out from nothing.
       */
      attach: (session) =>
        Effect.map(asks(CALLS.attach, session), (record) => foldTranscript(session, record)),
      // Cast because the two forms differ in their error channel and the
      // implementation is one function, as it is where the API is built.
      watch: ((session: SessionID, from?: Cursor) =>
        Stream.unwrap(opened(session, from))) as SessionAPI["watch"],
      /**
       * A Prompt is a `POST` on the Session it opens a Run in, and it answers
       * when that Run has closed — the contract every filler of this seam
       * keeps. So the request is open for as long as the Run is, and a
       * connection that drops meanwhile costs a repaint and not the Run: the
       * far side goes on, and a Cursor is how a page catches up.
       */
      submit: (session, input) => told(CALLS.submit, session, input),
      cancel: (session, cause) => told(CALLS.cancel, session, cause),
      answer: (request, given) => told(CALLS.answer, request, given),
    }

    /**
     * A line, sent whole for the far side to parse. It is a write like the
     * others, key and all: `/undo` asked twice would reverse two writes, and
     * the key is what makes asking again after a lost answer safe.
     */
    const command: Running = (session, line) => tells(CALLS.command, session, line)

    return { api, health, command, refusals }
  })
