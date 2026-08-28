import { remembering } from "@missingstudio/eva-approval"
import { makeSessionAPI, overSurface, type Gate, type Kernel } from "@missingstudio/eva-boot"
import { localTransport, makeClient, type Client } from "@missingstudio/eva-client-runtime"
import type { Frontend, SurfaceInfo } from "@missingstudio/eva-sdk"
import { Cause, Effect, Exit, Scope } from "effect"
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
 * The surfaces are read through the cell rather than captured, because they
 * start after the API is built and may be stopped and started again — and
 * because a run that named a second door holds two of them at once.
 */
export const gateFor =
  (kernel: Kernel, surfaces: () => readonly Frontend[], env: NodeJS.ProcessEnv): Gate =>
  (request) =>
    remembering(overSurface(kernel, { frontends: Effect.sync(surfaces), request }), env)

// The first row that is interactive and knows how to start. Registration
// order decides, so a config that loads its own surface last wins.
export const pickSurface = (rows: readonly SurfaceInfo[]): SurfaceInfo | undefined =>
  rows.find((row) => row.interactive && row.start !== undefined)

/**
 * The Client this run drives Eva through: the Session API over this kernel,
 * behind the local transport, under the gate.
 *
 * A door with no Surface hands over an empty set, and an `ask` is then a
 * denial that says nobody is there — which is the same sentence a Surface that
 * takes no input gets, from the same gate, rather than a second denial worded
 * somewhere else.
 */
export const openClient = Effect.fn("cli.openClient")(function* (
  started: Started,
  scope: Scope.Scope,
  surfaces: () => readonly Frontend[] = () => [],
) {
  const api = yield* makeSessionAPI(started.kernel, started.model, scope, {
    gate: gateFor(started.kernel, surfaces, started.env),
    ...(started.harness === undefined ? {} : { harness: started.harness }),
  })
  return yield* makeClient(yield* localTransport(api.session))
})

// A row this build can run: the row itself, with the factory proven present.
export type Startable = SurfaceInfo & { readonly start: NonNullable<SurfaceInfo["start"]> }

/**
 * How this run reached Eva, and how Eva reaches the person here.
 *
 * Both halves are one choice. A door in this process opens the Session API
 * over this kernel and wires the gate to the surfaces it starts, so there is
 * nothing left to run; a door at the end of a socket opens the same contract
 * over HTTP and leaves the gate to the process that owns it — and that process
 * cannot call a surface it does not hold, so the reaching is a thing this side
 * does for as long as the surfaces are up.
 */
export interface Reached {
  readonly client: Client
  readonly reaching?: Effect.Effect<void>
}

/**
 * How a door reaches Eva. The surfaces arrive as a cell for the reason
 * `gateFor` takes one: they start after the Client they answer through is
 * built, and `reaching` is run once they have.
 */
export type Opening = (
  scope: Scope.Scope,
  surfaces: () => readonly Frontend[],
) => Effect.Effect<Reached>

// The local runtime: this kernel behind the local transport, under the gate.
export const locally =
  (started: Started): Opening =>
  (scope, surfaces) =>
    Effect.map(openClient(started, scope, surfaces), (client) => ({ client }))

/**
 * Runs the Surfaces a door named, until the one that holds the person stops.
 * A Surface owns its own loop; this hands each of them the client runtime and
 * waits on the first.
 *
 * Which rows are chosen is the door's own rule — the terminal takes the first
 * interactive one, `eva serve` names `eva.web` by id, `eva --web` takes the
 * terminal and the page — and what happens after the choice is the same for
 * all of them.
 *
 * One Client, one scope, one wait. Every row starts against the same Client,
 * so two rows watch one Session rather than one each; the run ends when the
 * row that holds the person ends, because a page holds nobody to end it; and
 * the scope is what lets the rows beside it go.
 *
 * Where that Client comes from is the door's, because it is the one thing an
 * attached run does differently: the rows, the scope and the wait are the
 * same whether Eva is in this process or at the end of a socket.
 */
export const runSurface = Effect.fn("cli.runSurface")(function* (
  started: Started,
  chosen: Startable,
  beside: readonly Startable[] = [],
  open: Opening = locally(started),
) {
  const scope = yield* Scope.make()
  // Filled as each surface starts, which is after the API they answer through
  // is built. Until then an ask has nobody to reach, which is a denial.
  const live: Frontend[] = []
  const reached = yield* open(scope, () => live)
  const client = reached.client
  const frontend = yield* Effect.provideService(chosen.start(client), Scope.Scope, scope)
  live.push(frontend)
  for (const row of beside) {
    live.push(yield* Effect.provideService(row.start(client), Scope.Scope, scope))
  }
  // After the rows are live, because what this runs is how Eva reaches them.
  if (reached.reaching !== undefined) yield* Effect.forkIn(reached.reaching, scope)
  yield* Effect.ensuring(frontend.done, Scope.close(scope, Exit.void))
  return chosen.id
})

/**
 * A door: which row it wants, and what it says when this build has no such
 * row. It owns those two things and nothing else.
 */
export interface Door {
  readonly choose: (rows: readonly SurfaceInfo[]) => SurfaceInfo | undefined
  readonly refuse: (known: readonly string[]) => Error
}

// The row a door named, or that door's own refusal when this build carries
// none it can start.
const rowFor = (door: Door, rows: readonly SurfaceInfo[]): Effect.Effect<Startable, Error> => {
  const chosen = door.choose(rows)
  return chosen?.start === undefined
    ? Effect.fail(door.refuse(rows.map((row) => row.id)))
    : Effect.succeed({ ...chosen, start: chosen.start })
}

/**
 * Runs the surfaces this door names, whichever door named it.
 *
 * Everything after the choice — the `start`-is-absent refusal, the Client, the
 * scope, the wait — is the same for every door, so `--acp` at a later stage
 * adds a door rather than a third module.
 *
 * `beside` is the rows a flag named: `eva --web` is the terminal's door with
 * the page's beside it. They are doors of the same shape, because a flag that
 * names a surface this build does not have is refused in the same words as a
 * verb that named it. A row named twice is started once — with no terminal in
 * the build, `eva --web` takes the page as its interactive row and the flag
 * has nothing left to add.
 */
export const runDoor = Effect.fn("cli.runDoor")(function* (
  started: Started,
  door: Door,
  beside: readonly Door[] = [],
  open: Opening = locally(started),
) {
  const rows = yield* started.kernel.domains.surface.get
  const chosen = yield* rowFor(door, rows)
  const extra = yield* Effect.forEach(beside, (one) => rowFor(one, rows))
  return yield* runSurface(
    started,
    chosen,
    extra.filter((row) => row.id !== chosen.id),
    open,
  )
})

/**
 * What a door that ran a surface exits with, and what it says on the way out.
 *
 * An interrupt is how a person stops a surface — a SIGTERM, or a surface whose
 * `done` does not complete on its own — so the run exits 0 and says nothing. A
 * failure is a different thing: this build has no such surface, and the door
 * names what it does have. A door that offers help passes it, and the one that
 * does not passes nothing.
 */
export const closed = (
  outcome: Exit.Exit<unknown, unknown>,
  err: (text: string) => void,
  help?: () => void,
): number => {
  if (Exit.isSuccess(outcome) || Cause.hasInterruptsOnly(outcome.cause)) return 0
  err(`${Cause.squash(outcome.cause) as Error}\n`)
  help?.()
  return 1
}
