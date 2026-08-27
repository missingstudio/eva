import { Effect } from "effect"
import type { Started } from "./run.js"
import { pickSurface, runDoor } from "./surface.js"

export class NoSurfaceError extends Error {
  override readonly name = "NoSurfaceError"
  constructor(known: readonly string[]) {
    super(
      known.length === 0
        ? "no surface is registered, so there is nothing to run interactively"
        : `no registered surface can run interactively: ${known.join(", ")}`,
    )
  }
}

/**
 * Runs the selected surface until it stops. This door's rule is the first
 * interactive row; `runDoor` is what every door does after the choice, and
 * `closed` is what every one of them exits with.
 */
export const runInteractive = Effect.fn("cli.interactive")(function* (started: Started) {
  return yield* runDoor(started, pickSurface, (known) => new NoSurfaceError(known))
})
