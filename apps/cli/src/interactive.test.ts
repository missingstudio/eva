import type { Frontend, SurfaceInfo } from "@missingstudio/eva-sdk"
import { Effect, Exit, Scope } from "effect"
import { describe, expect, it } from "vitest"
import { boot } from "@missingstudio/eva-boot"
import { NoSurfaceError, pickSurface, runInteractive } from "./interactive.js"
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

describe("pickSurface", () => {
  it("passes over a surface that cannot ask a person", () => {
    const rows = [row({ id: "eva.print" }), startable("eva.tui", [])]
    expect(pickSurface(rows)?.id).toBe("eva.tui")
  })

  // A row without `start` names a surface the build knows of but cannot run.
  it("passes over an interactive row with nothing to start", () => {
    expect(pickSurface([row({ id: "eva.tui", interactive: true })])).toBeUndefined()
  })

  it("takes the first that can run, so registration order decides", () => {
    const ran: string[] = []
    const rows = [startable("first", ran), startable("second", ran)]
    expect(pickSurface(rows)?.id).toBe("first")
  })
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
