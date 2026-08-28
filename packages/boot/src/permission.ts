import {
  optionFor,
  unanswered,
  type Approving,
  type FrontendAnswer,
  type RequestID,
} from "@missingstudio/eva-core"
import type { Frontend, SurfaceInfo } from "@missingstudio/eva-sdk"
import { Deferred, Effect } from "effect"
import type { Kernel } from "./boot.js"

/**
 * The permission request, whole: how a tool call's `ask` opens one, how the
 * two doors answer it, and how it retires.
 *
 * There is one request and as many doors as this run holds open.
 * `Frontend.ask` is the direct call to a surface that holds a person, and it
 * already carries what an ask needs: the request id and the question. One run
 * may hold more than one such surface — `eva --web` holds the terminal and the
 * page — and each of them is a door. `SessionAPI.answer` is one more: a
 * surface at the end of a socket cannot have a method called on it, so it
 * answers by naming the request. Every one of them answers the same request,
 * so `overSurface` races them all and the first answer wins.
 *
 * The lifecycle is `makeAsking`'s: a request is open exactly while somebody
 * waits on it, the first answer settles it, and it retires however the wait
 * ends — so every door that lost the race is interrupted, a stale answer lands
 * on nothing, and each door's only obligations are the two `Frontend.ask`
 * states.
 *
 * The request id is the tool call's id. One call is one request, the record
 * that named the call landed before the ask, and a surface that answers over
 * the socket therefore has the id from the Trace it is already watching.
 */

export interface Asked {
  /**
   * The surfaces Eva asks, read at the moment of use rather than captured: a
   * surface is started, stopped, and started again, and one run holds as many
   * of them at once as its door named.
   */
  readonly frontends: Effect.Effect<readonly Frontend[]>
  // Opens the request and waits for an answer. `Asking.request` is this.
  readonly request: (id: RequestID) => Effect.Effect<FrontendAnswer>
}

/**
 * The socket door's half of one request: `request` waits on an answer that
 * `answer` lands by naming it. `Api.request` and `SessionAPI.answer` are the
 * two, so what a surface across a socket reaches is exactly this pair.
 */
export interface Asking {
  // Opens the request and waits. However the wait ends, the request retires.
  readonly request: (id: RequestID) => Effect.Effect<FrontendAnswer>
  // An answer to a request that is not open is dropped. A surface that
  // reconnects and replays a stale answer must not stop Eva.
  readonly answer: (id: RequestID, given: FrontendAnswer) => Effect.Effect<void>
}

export const makeAsking = (): Asking => {
  const pending = new Map<RequestID, Deferred.Deferred<FrontendAnswer>>()

  return {
    /**
     * The request is open exactly while somebody is waiting on it. A tool
     * call's `ask` races this door against the surface Eva can call, so the
     * door that loses is interrupted — and a request left open by the loser
     * would take a later answer and give it to nobody.
     *
     * This is what makes the first answer the only answer: once one has
     * landed, from either door, the request is no longer open and the second
     * one is refused as already answered. The guard on the delete keeps a
     * retiring request from closing the next one of the same id — a call id
     * repeats across Runs.
     */
    request: (id: RequestID): Effect.Effect<FrontendAnswer> => {
      const waiting = Deferred.makeUnsafe<FrontendAnswer>()
      pending.set(id, waiting)
      return Effect.ensuring(
        Deferred.await(waiting),
        Effect.sync(() => {
          if (pending.get(id) === waiting) pending.delete(id)
        }),
      )
    },

    answer: Effect.fn("boot.asking.answer")(function* (id: RequestID, given: FrontendAnswer) {
      const waiting = pending.get(id)
      if (waiting === undefined) return
      pending.delete(id)
      yield* Deferred.succeed(waiting, given)
    }),
  }
}

const refused = (reason: string) => Effect.succeed({ kind: "reject_once", reason } as const)

/**
 * Whether this surface takes input. It is read off the `SurfaceInfo` row and
 * never off the `Frontend`, because the row is the one place a surface says
 * what it can do — and a surface that says `interactive: false` turns every
 * ask into a rejection rather than a wait.
 */
const takesInput = (rows: readonly SurfaceInfo[], id: string): boolean =>
  rows.find((row) => row.id === id)?.interactive === true

// Why nobody can answer: either no surface is running, or the ones that are
// say on their rows that they take no input.
const nobody = (live: readonly Frontend[]): string =>
  live.length === 0
    ? "nobody is there to answer"
    : `${live.map((one) => one.id).join(", ")} takes no input, so nobody can answer`

// The option this answer named, whichever way the surface spelled it. A
// terminal that offers the four as words answers with the words.
const namedIn = (answer: FrontendAnswer): string => {
  switch (answer.kind) {
    case "permission":
      return answer.optionId
    case "text":
      return answer.text
    case "cancelled":
      return ""
  }
}

/**
 * What the answer named, as one of the four options. An answer naming none of
 * them is a denial for this call only: a person who cancelled or typed
 * something else has not refused for good.
 */
const outcomeOf = (answer: FrontendAnswer, question: string) => {
  const kind = optionFor(namedIn(answer))
  switch (kind) {
    case "allow_once":
    case "allow_always":
      return { kind } as const
    case "reject_once":
    case "reject_always":
      return { kind, reason: `a person refused: ${question}` } as const
    case undefined:
      return { kind: "reject_once", reason: unanswered(question) } as const
  }
}

/**
 * The gate's answering half, over the seam that already exists. A permission
 * request with nobody to answer it is a denial: no surface running, or every
 * surface that is running takes no input, is `reject_once` and the reason says
 * which of the two it was.
 *
 * A row that takes no input takes one door out of the race and never the
 * whole call, because the doors beside it can still answer. A run that holds
 * a terminal and a page asks both, and the first answer is the answer.
 *
 * This is the shape `HarnessClient.requestPermission` takes, so the ACP
 * client half at a later stage asks through this gate rather than getting one
 * of its own. It remembers nothing — an answer that says "always" is written
 * down by whoever owns the rule language, and this only reports it.
 */
export const overSurface =
  (kernel: Kernel, asked: Asked): Approving =>
  (request) =>
    Effect.gen(function* () {
      const question = request.toolCall.title
      const live = yield* asked.frontends
      const rows = yield* kernel.domains.surface.get
      const asking = live.filter((one) => takesInput(rows, one.id))
      if (asking.length === 0) return yield* refused(`${nobody(live)}: ${question}`)

      const answer = yield* Effect.raceAll([
        ...asking.map((one) =>
          one.ask({
            kind: "permission",
            id: request.toolCall.toolCallId,
            question,
          }),
        ),
        asked.request(request.toolCall.toolCallId),
      ])
      return outcomeOf(answer, question)
    })
