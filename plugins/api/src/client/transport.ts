import type { Transport, TransportHealth } from "@missingstudio/eva-client-runtime"
import type { SessionAPI } from "@missingstudio/eva-core"
import { Effect, Schedule, Stream, SubscriptionRef } from "effect"
import { headersIn, modelIn, modelPath, SESSIONS } from "../wire.js"

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
 * where it is called — not a hang, and not a shape nobody can read. 005 takes
 * `attach`, 006 takes `watch`, and the write half is stage 2's.
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

    const api: SessionAPI = {
      list: call(SESSIONS, headersIn),
      model: {
        get: (session) => call(modelPath(session), modelIn),
        set: () => missing("model.set"),
      },
      create: () => missing("create"),
      attach: () => missing("attach"),
      // Cast because the two forms differ in their error channel and the
      // implementation is one function, as it is where the API is built.
      watch: (() => Stream.die(new NotOnTheWire("watch"))) as SessionAPI["watch"],
      submit: () => missing("submit"),
      cancel: () => missing("cancel"),
      answer: () => missing("answer"),
    }

    return { api, health }
  })
