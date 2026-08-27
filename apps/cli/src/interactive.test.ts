import { boot } from "@missingstudio/eva-boot"
import type { Frontend, SurfaceInfo } from "@missingstudio/eva-sdk"
import { Effect, Exit, Fiber, Scope } from "effect"
import { describe, expect, it } from "vitest"
import { interacted, NoSurfaceError, runInteractive } from "./interactive.js"
import type { Started } from "./run.js"

const row = (over: Partial<SurfaceInfo> & { id: string }): SurfaceInfo => ({
  interactive: false,
  streaming: true,
  images: false,
  ...over,
})

const startable = (id: string, ran: string[]): SurfaceInfo =>
  row({
    id,
    interactive: true,
    start: () =>
      Effect.succeed({
        id,
        ask: () => Effect.succeed({ kind: "cancelled" }),
        done: Effect.sync(() => void ran.push(id)),
      } satisfies Frontend),
  })

const withKernel = <A>(
  surfaces: readonly SurfaceInfo[],
  body: (started: Started) => Effect.Effect<A, unknown>,
) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const kernel = yield* boot({ scope, resolved: [] })
      yield* kernel.domains.surface
        .transform((draft) => {
          for (const one of surfaces) draft.set(one)
        })
        .pipe(Effect.provideService(Scope.Scope, scope))

      const started: Started = {
        kernel,
        // The environment this run was given, as every door hands it on.
        env: {},
        config: { plugins: [], raw: {}, origin: {} },
        model: { provider: "fake", model: "model" },
      }
      const result = yield* body(started)
      yield* Scope.close(scope, Exit.void)
      return result
    }),
  )

describe("runInteractive", () => {
  it("starts the surface it picked and waits for it to stop", async () => {
    const ran: string[] = []
    const outcome = await withKernel([startable("eva.tui", ran)], runInteractive)

    expect(Exit.isSuccess(outcome)).toBe(true)
    expect(ran).toEqual(["eva.tui"])
  })

  // A build with no interactive surface must say so, not exit as though it ran.
  it("fails when no registered surface can run interactively", async () => {
    const outcome = await withKernel([row({ id: "eva.print" })], runInteractive)
    expect(Exit.isFailure(outcome)).toBe(true)
  })

  it("names what it did find", () => {
    expect(new NoSurfaceError(["eva.print"]).message).toContain("eva.print")
    expect(new NoSurfaceError([]).message).toContain("no surface is registered")
  })
})

// A surface that holds until the process stops it, the way one that is not a
// terminal does. Its `done` never completes on its own.
const holding = (id: string): SurfaceInfo =>
  row({
    id,
    interactive: true,
    start: () =>
      Effect.succeed({
        id,
        ask: () => Effect.succeed({ kind: "cancelled" }),
        done: Effect.never,
      } satisfies Frontend),
  })

// The exit of a run that a signal stopped: the surface holds, and the fiber
// that waits on it is interrupted. This is what a SIGTERM does.
const interrupted = async (): Promise<Exit.Exit<unknown, unknown>> => {
  const outcome = await withKernel([holding("eva.tui")], (started) =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(runInteractive(started))
      yield* Effect.sleep(0)
      yield* Fiber.interrupt(fiber)
      return yield* Fiber.await(fiber)
    }),
  )
  return Exit.isSuccess(outcome) ? outcome.value : outcome
}

describe("how an interactive run ends", () => {
  // What the person is told, beside the code they exit with.
  const ended = (outcome: Exit.Exit<unknown, unknown>) => {
    const said: string[] = []
    let helped = false
    const code = interacted(
      outcome,
      (text) => void said.push(text),
      () => {
        helped = true
      },
    )
    return { code, said: said.join(""), helped }
  }

  it("exits 0 and says nothing when the surface stopped", async () => {
    const outcome = await withKernel([startable("eva.tui", [])], runInteractive)
    expect(ended(outcome)).toEqual({ code: 0, said: "", helped: false })
  })

  /**
   * A signal interrupts the fiber rather than failing it. This used to print
   * "All fibers interrupted without error", print the whole help below it,
   * and exit 1, so a deliberate stop read as a usage error.
   */
  it("exits 0, says nothing, and shows no help on an interrupt", async () => {
    const outcome = await interrupted()

    // The run did not end on its own, so the 0 is the interrupt rule and not
    // the rule that a surface which stopped is a success.
    expect(Exit.isFailure(outcome)).toBe(true)
    expect(ended(outcome)).toEqual({ code: 0, said: "", helped: false })
  })

  // A build with no interactive surface is a different thing: the person
  // asked for a door this build does not have, so the help names the ones it
  // does.
  it("exits 1, names what it did find, and shows the help on a failure", async () => {
    const outcome = await withKernel([row({ id: "eva.print" })], runInteractive)
    const stop = ended(outcome)

    expect(stop.code).toBe(1)
    expect(stop.said).toContain("eva.print")
    expect(stop.helped).toBe(true)
  })
})
