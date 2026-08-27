import { WEB_SURFACE } from "@missingstudio/eva-web"
import { Effect } from "effect"
import type { Started } from "./run.js"
import { runDoor } from "./surface.js"

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
  return yield* runDoor(
    started,
    (rows) => rows.find((row) => row.id === WEB_SURFACE),
    (known) => new NoWebSurfaceError(known),
  )
})
