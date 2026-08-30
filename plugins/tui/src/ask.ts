import { answerFor, type FrontendAnswer } from "@missingstudio/eva-core"
import type { FrontendRequest } from "@missingstudio/eva-sdk"
import { Deferred, Effect } from "effect"
import type { ConsoleEvent } from "./console.js"

/**
 * A question that stands, and the answer it waits on.
 */
interface Standing {
  readonly request: FrontendRequest
  readonly waiting: Deferred.Deferred<FrontendAnswer>
}

// The two doors to the questions that stand: one puts a question up, and
// one answers the question a person is looking at.
export interface Asking {
  /**
   * Eva needs a person, and this terminal is one of the two doors to one. The
   * other is the socket: the gate races them, so an answer from a browser
   * watching the same Session interrupts this call.
   *
   * That interrupt is what retires the prompt. There is nothing to watch the
   * record for — a question nobody has answered is not on it — and the
   * interrupt is the fact itself: this door lost, so the line above stops
   * asking to be answered.
   */
  readonly ask: (request: FrontendRequest) => Effect.Effect<FrontendAnswer>
  readonly answer: (line: string) => Effect.Effect<void>
}

/**
 * The questions that stand, each waiting on its own answer. Eva may ask more
 * than one at a time — one tool group can hold two calls that both need a
 * person — and each ask is answered on its own, whichever door answers it.
 *
 * A terminal shows one line at a time, so the first question that stands is
 * the one a person is looking at and a line they type is that one's. The
 * others wait their turn behind it. One slot and one shared queue used to
 * hold this: a second ask overwrote the first, both waited on one answer,
 * and which of them it settled was whichever the runtime happened to wake.
 */
export const makeAsking = (on: (event: ConsoleEvent) => void): Asking => {
  const standing = new Map<string, Standing>()

  // The question a person is looking at, which is the first one that stands.
  const shown = (): Standing | undefined => standing.values().next().value

  // What the screen says about the questions that stand. Called whenever the
  // first one changes, so answering one shows the next rather than nothing.
  const showing = () => {
    const next = shown()
    on(
      next === undefined
        ? { kind: "answered" }
        : { kind: "asked", question: next.request.question },
    )
  }

  const answer = Effect.fn("eva.tui.answer")(function* (line: string) {
    const held = shown()
    // A line typed with nothing standing answers nothing. It used to be kept
    // for the next question to consume, which answered one nobody had read.
    if (held === undefined) return on({ kind: "answered" })

    standing.delete(held.request.id)
    yield* Deferred.succeed(
      held.waiting,
      answerFor(held.request.kind, line) satisfies FrontendAnswer,
    )
    showing()
  })

  const ask = Effect.fn("eva.tui.ask")(function* (request: FrontendRequest) {
    const waiting = yield* Deferred.make<FrontendAnswer>()
    standing.set(request.id, { request, waiting })
    // The screen changes only when this is the question now at the front.
    if (shown()?.request.id === request.id) showing()

    return yield* Effect.onInterrupt(Deferred.await(waiting), () =>
      Effect.sync(() => {
        standing.delete(request.id)
        showing()
      }),
    )
  })

  return { ask, answer }
}
