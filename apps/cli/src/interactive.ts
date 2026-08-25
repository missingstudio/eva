import { makeSessionAPI } from "@missingstudio/eva-boot"
import { makeClient } from "@missingstudio/eva-client-runtime"
import type { SurfaceInfo } from "@missingstudio/eva-sdk"
import { Effect, Exit, Scope } from "effect"
import type { Started } from "./run.js"

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

// The first row that is interactive and knows how to start. Registration
// order decides, so a config that loads its own surface last wins.
export const pickSurface = (rows: readonly SurfaceInfo[]): SurfaceInfo | undefined =>
  rows.find((row) => row.interactive && row.start !== undefined)

/**
 * Runs the selected surface until it stops. The surface owns the loop; this
 * only chooses one, hands it the client runtime, and waits.
 */
export const runInteractive = Effect.fn("cli.interactive")(function* (started: Started) {
  const rows = yield* started.kernel.domains.surface.get
  const chosen = pickSurface(rows)
  if (chosen?.start === undefined) {
    return yield* Effect.fail(new NoSurfaceError(rows.map((row) => row.id)))
  }

  const scope = yield* Scope.make()
  const api = yield* makeSessionAPI(started.kernel, started.model, scope)
  const client = makeClient(api.session)
  const frontend = yield* Effect.provideService(chosen.start(client), Scope.Scope, scope)
  yield* Effect.ensuring(frontend.done, Scope.close(scope, Exit.void))
  return chosen.id
})
