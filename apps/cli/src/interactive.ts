import { Cause, Effect, Exit } from "effect"
import type { Started } from "./run.js"
import { pickSurface, runSurface } from "./surface.js"

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
 * interactive row; `runSurface` is what every door does after the choice.
 */
export const runInteractive = Effect.fn("cli.interactive")(function* (started: Started) {
  const rows = yield* started.kernel.domains.surface.get
  const chosen = pickSurface(rows)
  if (chosen?.start === undefined) {
    return yield* Effect.fail(new NoSurfaceError(rows.map((row) => row.id)))
  }

  return yield* runSurface(started, { ...chosen, start: chosen.start })
})

/**
 * What an interactive run that ended exits with, and what it says on the way
 * out.
 *
 * An interrupt is how a person stops a surface — a SIGTERM, or a surface
 * whose `done` does not complete on its own — so the run exits 0 and says
 * nothing. A failure is a different thing: this build has no interactive
 * surface, and the help names the verbs it does have.
 */
export const interacted = (
  outcome: Exit.Exit<unknown, unknown>,
  err: (text: string) => void,
  help: () => void,
): number => {
  if (Exit.isSuccess(outcome) || Cause.hasInterruptsOnly(outcome.cause)) return 0
  err(`${Cause.squash(outcome.cause) as Error}\n`)
  help()
  return 1
}
