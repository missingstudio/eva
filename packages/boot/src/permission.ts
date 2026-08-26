import {
  optionFor,
  type Approving,
  type FrontendAnswer,
  type RequestID,
} from "@missingstudio/eva-core"
import type { Frontend, SurfaceInfo } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import type { Kernel } from "./boot.js"

/**
 * How a tool call's `ask` reaches a person, and how the answer comes back.
 *
 * There are two doors and one request. `Frontend.ask` is the direct call to
 * the surface that holds a person, and it already carries what an ask needs:
 * the request id and the question. `SessionAPI.answer` is the other door — a
 * surface at the end of a socket cannot have a method called on it, so it
 * answers by naming the request. Both are answers to the same request, so
 * this races them and the first one wins.
 *
 * The request id is the tool call's id. One call is one request, the record
 * that named the call landed before the ask, and a surface that answers over
 * the socket therefore has the id from the Trace it is already watching.
 */

export interface Asked {
  /**
   * The surface Eva asks, read at the moment of use rather than captured: a
   * surface is started, stopped, and started again.
   */
  readonly frontend: Effect.Effect<Frontend | undefined>
  // Opens the request and waits for an answer. `Api.request` is this.
  readonly request: (id: RequestID) => Effect.Effect<FrontendAnswer>
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
      return { kind: "reject_once", reason: `nobody answered: ${question}` } as const
  }
}

/**
 * The gate's answering half, over the seam that already exists. A permission
 * request with nobody to answer it is a denial: no surface running, or a
 * surface whose row takes no input, is `reject_once` and the reason says so.
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
      const surface = yield* asked.frontend
      if (surface === undefined) return yield* refused(`nobody is there to answer: ${question}`)

      const rows = yield* kernel.domains.surface.get
      if (!takesInput(rows, surface.id)) {
        return yield* refused(`${surface.id} takes no input, so nobody can answer: ${question}`)
      }

      const answer = yield* Effect.race(
        surface.ask({
          kind: "permission",
          id: request.toolCall.toolCallId,
          question,
        }),
        asked.request(request.toolCall.toolCallId),
      )
      return outcomeOf(answer, question)
    })
