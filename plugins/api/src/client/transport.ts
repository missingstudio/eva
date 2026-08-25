import type { Transport, TransportHealth } from "@missingstudio/eva-client-runtime"
import { foldTranscript, type ResumeTooFarBehind, type SessionAPI } from "@missingstudio/eva-core"
import type { Cursor, Payload, SessionID } from "@missingstudio/eva-schema"
import { Effect, Schedule, Scope, Stream, SubscriptionRef } from "effect"
import {
  CURSOR,
  CURSOR_REFUSED,
  eventsIn,
  EVENT_STREAM,
  framesIn,
  headersIn,
  modelIn,
  modelPath,
  payloadIn,
  refusalIn,
  sessionPath,
  SESSIONS,
  watchPath,
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
   * what W1 uses: `eva.web` serves the page and `eva.api` answers beside it
   * on the one port, so the page knows no address.
   */
  readonly origin?: string
  readonly gap?: number
  readonly request?: Request
}

/**
 * What the wire does not carry yet. `SessionAPI` is one interface and a filler
 * answers all of it, so a method the read half has not reached is a defect
 * where it is called — not a hang, and not a shape nobody can read. 006 takes
 * `watch`, and the write half is stage 2's.
 */
export class NotOnTheWire extends Error {
  override readonly name = "NotOnTheWire"
  constructor(method: string) {
    super(`the wire does not carry \`${method}\` yet`)
  }
}

// The far side did not answer, or did not answer the wire. It never leaves
// this module.
class Unreachable extends Error {
  override readonly name = "Unreachable"
}

/**
 * The whole Session API over HTTP, and the one fact `client-runtime` reads
 * about the pipe. It is the seam's second filler: the runtime calls the
 * contract and never learns that this answer crossed a socket.
 */
export const httpTransport = (options: HttpOptions = {}): Effect.Effect<Transport> =>
  Effect.gen(function* () {
    const health = yield* SubscriptionRef.make<TransportHealth>("ready")
    const origin = options.origin ?? ""
    const gap = options.gap ?? RETRY_GAP
    const request = options.request ?? fetch

    const read = async (path: string, signal: AbortSignal): Promise<unknown> => {
      const response = await request(`${origin}${path}`, { signal })
      if (!response.ok) throw new Unreachable(`${path} answered ${response.status}`)
      const kind = response.headers.get("content-type") ?? ""
      /**
       * The page's own server answers an unknown path with the page, so an
       * answer that is not JSON is not this wire answering — a build carrying
       * no `eva.api` reads as a pipe that is down, which is what it is.
       */
      if (!kind.includes("application/json")) {
        throw new Unreachable(`${path} answered ${kind === "" ? "nothing" : kind}`)
      }
      return (await response.json()) as unknown
    }

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
                  try: (signal) => read(path, signal),
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

    const missing = (method: string) => Effect.die(new NotOnTheWire(method))

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

    const api: SessionAPI = {
      list: call(SESSIONS, headersIn),
      model: {
        get: (session) => call(modelPath(session), modelIn),
        set: () => missing("model.set"),
      },
      create: () => missing("create"),
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
        Effect.map(call(sessionPath(session), eventsIn), (record) =>
          foldTranscript(session, record),
        ),
      // Cast because the two forms differ in their error channel and the
      // implementation is one function, as it is where the API is built.
      watch: ((session: SessionID, from?: Cursor) =>
        Stream.unwrap(opened(session, from))) as SessionAPI["watch"],
      submit: () => missing("submit"),
      cancel: () => missing("cancel"),
      answer: () => missing("answer"),
    }

    return { api, health }
  })
