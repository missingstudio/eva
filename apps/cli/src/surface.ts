import { remembering } from "@missingstudio/eva-approval"
import { makeSessionAPI, overSurface, type Gate, type Kernel } from "@missingstudio/eva-boot"
import { localTransport, makeClient } from "@missingstudio/eva-client-runtime"
import type { Frontend, SurfaceInfo } from "@missingstudio/eva-sdk"
import { Effect, Exit, Scope } from "effect"
import type { Started } from "./run.js"

/**
 * How this app opens a Session, and how it runs the Surface that drives one.
 *
 * Every door — the terminal, `eva serve`, `eva run`, `--print` — opens the
 * Session the same way, so the gate is wired in one place. A door that built
 * its own API would be a door where an `ask` is denied for a different reason
 * than at every other one, which is what happened while two of the four built
 * their own.
 */

/**
 * How a tool call's `ask` reaches the person at this surface, and how the
 * answer is remembered.
 *
 * Both halves meet here and nowhere else. `overSurface` is boot's — it races
 * the surface Eva can call against the request a surface across a socket
 * answers by naming — and `remembering` is `eva.approval`'s, because the rule
 * language a grant is written in is that plugin's. Neither may import the
 * other, and boot may import no plugin, so the composition root composes
 * them: the `makeTui({ renderer })` precedent.
 *
 * The environment is part of the interface. `allow_always` writes a rule into
 * the person's own config file, and that is the one write in the whole
 * permission lifecycle — so where it lands is read from the World this run was
 * given and never from the process. A gate that read the process would write
 * into the person's own home directory from a suite that had been handed a
 * scratch directory for exactly that reason.
 *
 * The surface is read through the cell rather than captured, because it is
 * started after the API is built and may be stopped and started again.
 */
export const gateFor =
  (kernel: Kernel, surface: () => Frontend | undefined, env: NodeJS.ProcessEnv): Gate =>
  (request) =>
    remembering(overSurface(kernel, { frontend: Effect.sync(surface), request }), env)

// The first row that is interactive and knows how to start. Registration
// order decides, so a config that loads its own surface last wins.
export const pickSurface = (rows: readonly SurfaceInfo[]): SurfaceInfo | undefined =>
  rows.find((row) => row.interactive && row.start !== undefined)

/**
 * The Client this run drives Eva through: the Session API over this kernel,
 * behind the local transport, under the gate.
 *
 * A door with no Surface hands over nothing, and an `ask` is then a denial
 * that says nobody is there — which is the same sentence a Surface that takes
 * no input gets, from the same gate, rather than a second denial worded
 * somewhere else.
 */
export const openClient = Effect.fn("cli.openClient")(function* (
  started: Started,
  scope: Scope.Scope,
  surface: () => Frontend | undefined = () => undefined,
) {
  const api = yield* makeSessionAPI(started.kernel, started.model, scope, {
    gate: gateFor(started.kernel, surface, started.env),
    ...(started.harness === undefined ? {} : { harness: started.harness }),
  })
  return yield* makeClient(yield* localTransport(api.session))
})

/**
 * Runs one Surface until it stops. The Surface owns the loop; this hands it
 * the client runtime and waits.
 *
 * Which row is chosen is the door's own rule — the terminal takes the first
 * interactive one, `eva serve` names `eva.web` by id — and what happens after
 * the choice is the same for both.
 */
export const runSurface = Effect.fn("cli.runSurface")(function* (
  started: Started,
  chosen: SurfaceInfo & { readonly start: NonNullable<SurfaceInfo["start"]> },
) {
  const scope = yield* Scope.make()
  // Filled the moment the surface starts, which is after the API it answers
  // through is built. Until then an ask has nobody to reach, which is a denial.
  let surface: Frontend | undefined
  const client = yield* openClient(started, scope, () => surface)
  const frontend = yield* Effect.provideService(chosen.start(client), Scope.Scope, scope)
  surface = frontend
  yield* Effect.ensuring(frontend.done, Scope.close(scope, Exit.void))
  return chosen.id
})
