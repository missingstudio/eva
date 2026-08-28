import { Effect } from "effect"
import type { Started } from "./run.js"
import { pickSurface, runDoor, type Door } from "./surface.js"

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

// The terminal, as a door: the first interactive row, and what a build with
// no such row is told.
const TERMINAL_DOOR: Door = {
  choose: pickSurface,
  refuse: (known) => new NoSurfaceError(known),
}

/**
 * Runs the selected surface until it stops, with every surface a flag named
 * running beside it. This door's rule is the first interactive row; `runDoor`
 * is what every door does after the choice, and `closed` is what every one of
 * them exits with.
 *
 * The rows beside it are the caller's, because a flag is read where the
 * command line is read. This door keeps its own rule and nothing more.
 */
export const runInteractive = Effect.fn("cli.interactive")(function* (
  started: Started,
  beside: readonly Door[] = [],
) {
  return yield* runDoor(started, TERMINAL_DOOR, beside)
})
