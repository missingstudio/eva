import { WEB_SURFACE } from "@missingstudio/eva-web"
import { Cause, Effect, Exit } from "effect"
import type { Started } from "./run.js"
import { runSurface } from "./surface.js"

export class NoWebSurfaceError extends Error {
  override readonly name = "NoWebSurfaceError"
  constructor(known: readonly string[]) {
    super(
      known.length === 0
        ? "no surface is registered, so nothing serves the page"
        : `no ${WEB_SURFACE} surface is registered; this build has ${known.join(", ")}`,
    )
  }
}

/**
 * Serves the web surface until the process stops it. This door's rule is the
 * row **by id**; `runSurface` is what every door does after the choice.
 *
 * `eva` with no verb takes the first interactive surface and this row is
 * registered after the terminal's, so a person who typed `eva` gets the
 * terminal — and a verb that named a posture names the surface too.
 *
 * The gate is the same one the terminal runs under, because `runSurface` is
 * where it is wired: a permission request reaches the page and the page's
 * answer is the one the gate reads.
 */
export const runServe = Effect.fn("cli.serve")(function* (started: Started) {
  const rows = yield* started.kernel.domains.surface.get
  const chosen = rows.find((row) => row.id === WEB_SURFACE)
  if (chosen?.start === undefined) {
    return yield* Effect.fail(new NoWebSurfaceError(rows.map((row) => row.id)))
  }

  return yield* runSurface(started, { ...chosen, start: chosen.start })
})

/**
 * What a serve that ended exits with, and what it says on the way out.
 *
 * Ctrl-C is the only way to stop this surface — the page holds until the
 * process does — so an interrupt is how a serve ends, and a person who typed
 * it is told nothing. What is left is a build with no `eva.web` row: a door
 * this build does not have, and it names the doors it does.
 */
export const served = (
  outcome: Exit.Exit<unknown, unknown>,
  err: (text: string) => void,
): number => {
  if (Exit.isSuccess(outcome) || Cause.hasInterruptsOnly(outcome.cause)) return 0
  err(`${Cause.squash(outcome.cause) as Error}\n`)
  return 1
}
