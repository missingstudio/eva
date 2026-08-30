import { watchAsking, type HttpTransport } from "@missingstudio/eva-api/client"
import { makeClient, type Client } from "@missingstudio/eva-client-runtime"
import type { Frontend, FrontendRequest } from "@missingstudio/eva-sdk"
import { Effect, Fiber, Queue } from "effect"
import { runInteractive } from "./interactive.js"
import type { Started } from "./run.js"
import type { Opening } from "./surface.js"

/**
 * The terminal, run against a runtime another process serves.
 *
 * It is the interactive door and nothing else: the same row, the same rule
 * that picks it, the same wait. What changes is where Eva is. The Client is
 * `eva.api`'s wire rather than this kernel behind the local transport, and no
 * gate is composed here — the serving process owns the gate, so a request
 * asked there is answered here by naming it, exactly as a page answers one.
 */

/**
 * The questions the runtime has, offered to the person at this terminal.
 *
 * The ask channel streams the questions that stand, and it is the presence
 * signal as well as the channel: a runtime with nobody reading it cancels an
 * ask rather than holding a Run open for nobody. So an attached terminal reads
 * that stream for the whole of its run, and the moment it does the runtime has
 * somebody to ask. The reader is the wire's, beside `answer`, so this terminal
 * names no surface: it relays a question from any runtime that serves one.
 *
 * The answer goes back the other way, through `SessionAPI.answer` — the door
 * every surface across a wire has. A question that leaves the set was answered
 * somewhere else, and the ask here is interrupted: that interrupt is what
 * retires the prompt, which is the whole of a terminal's obligation.
 *
 * The question goes to the row this door started, which is the terminal and
 * nothing beside it. Racing the doors is the serving process's, and it is
 * already racing this whole process against whatever else is watching.
 */
const relaying = (
  client: Client,
  surfaces: () => readonly Frontend[],
  origin: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const frames = yield* Queue.unbounded<readonly FrontendRequest[]>()
    const stop = watchAsking((asking) => void Queue.offerUnsafe(frames, asking), { origin })
    // The ask each question is standing on here, so a question withdrawn can
    // retire the one prompt it opened.
    const standing = new Map<string, Fiber.Fiber<void>>()

    // The request travelled whole, so it is asked as it arrived: this door
    // answers a question with the kind the gate asked it with.
    const offer = (one: FrontendRequest) =>
      Effect.gen(function* () {
        const surface = surfaces()[0]
        if (surface === undefined) return
        const given = yield* surface.ask(one)
        yield* client.api.answer(one.id, given)
      })

    // A frame carries the whole set, so what is new is asked and what is gone
    // is retired. Nothing is remembered between frames but the asks
    // themselves.
    const heard = (asking: readonly FrontendRequest[]) =>
      Effect.gen(function* () {
        const open = new Set(asking.map((one) => one.id))
        for (const [id, fiber] of standing) {
          if (open.has(id)) continue
          standing.delete(id)
          yield* Fiber.interrupt(fiber)
        }
        for (const one of asking) {
          if (standing.has(one.id)) continue
          standing.set(one.id, yield* Effect.forkChild(offer(one)))
        }
      })

    yield* Effect.ensuring(
      Effect.gen(function* () {
        for (;;) yield* heard(yield* Queue.take(frames))
      }),
      Effect.sync(stop),
    )
  })

/**
 * Eva at the end of a socket: the wire as the Client, and the runtime's
 * questions relayed to the surfaces this run starts.
 *
 * No `gateFor`. A gate composed here would judge a tool call this process
 * never runs, and would write an `allow_always` rule into this machine's own
 * config for a Run that happens on another one.
 */
export const attached =
  (wire: HttpTransport, origin: string): Opening =>
  (_scope, surfaces) =>
    Effect.gen(function* () {
      const client = yield* makeClient(wire)
      return { client, reaching: relaying(client, surfaces, origin) }
    })

export const runAttach = Effect.fn("cli.attach")(function* (
  started: Started,
  wire: HttpTransport,
  origin: string,
) {
  return yield* runInteractive(started, [], attached(wire, origin))
})
