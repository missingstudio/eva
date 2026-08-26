import { remembering } from "@missingstudio/eva-approval"
import { makeSessionAPI, overSurface, type Gate, type Kernel } from "@missingstudio/eva-boot"
import { localTransport, makeClient } from "@missingstudio/eva-client-runtime"
import type { Frontend, SurfaceInfo } from "@missingstudio/eva-sdk"
import { Cause, Effect, Exit, Scope } from "effect"
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
 * How a tool call's `ask` reaches the person at this terminal, and how the
 * answer is remembered.
 *
 * Both halves meet here and nowhere else. `overSurface` is boot's — it races
 * the surface Eva can call against the request a surface across a socket
 * answers by naming — and `remembering` is `eva.approval`'s, because the rule
 * language a grant is written in is that plugin's. Neither may import the
 * other, so the composition root composes them: the `makeTui({ renderer })`
 * precedent.
 *
 * The surface is read through the cell rather than captured, because it is
 * started after the API is built and may be stopped and started again.
 */
export const gateFor =
  (kernel: Kernel, surface: () => Frontend | undefined): Gate =>
  (request) =>
    remembering(overSurface(kernel, { frontend: Effect.sync(surface), request }))

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
  // Filled the moment the surface starts, which is after the API it answers
  // through is built. Until then an ask has nobody to reach, which is a denial.
  let surface: Frontend | undefined
  const api = yield* makeSessionAPI(
    started.kernel,
    started.model,
    scope,
    gateFor(started.kernel, () => surface),
  )
  const client = yield* makeClient(yield* localTransport(api.session))
  const frontend = yield* Effect.provideService(chosen.start(client), Scope.Scope, scope)
  surface = frontend
  yield* Effect.ensuring(frontend.done, Scope.close(scope, Exit.void))
  return chosen.id
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
