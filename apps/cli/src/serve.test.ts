import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { API_PLUGIN } from "@missingstudio/eva-api"
import { boot, buildOf } from "@missingstudio/eva-boot"
import type { Frontend, SurfaceInfo } from "@missingstudio/eva-sdk"
import { WEB_SURFACE } from "@missingstudio/eva-web"
import { Effect, Exit, Scope } from "effect"
import { describe, expect, it } from "vitest"
import { assetRoot, BUILT_IN, serving } from "./plugins.js"
import type { Started } from "./run.js"
import { NoWebSurfaceError, runServe } from "./serve.js"
import { closed } from "./surface.js"

const row = (over: Partial<SurfaceInfo> & { id: string }): SurfaceInfo => ({
  interactive: false,
  streaming: true,
  images: false,
  ...over,
})

// A row that records that it started and then stops at once, so the branch is
// reachable without a socket.
const startable = (id: string, ran: string[], interactive = false): SurfaceInfo =>
  row({
    id,
    interactive,
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

describe("runServe", () => {
  it("starts the eva.web row and waits for it to stop", async () => {
    const ran: string[] = []
    const outcome = await withKernel([startable(WEB_SURFACE, ran)], runServe)

    expect(Exit.isSuccess(outcome)).toBe(true)
    expect(ran).toEqual([WEB_SURFACE])
  })

  /**
   * The row is found by id, not by the rule the interactive branch uses. Both
   * rows are interactive, so a verb that named a posture must name the surface
   * too — this one names `eva.web` whatever else is registered.
   */
  it("starts the row by id, and never the first interactive one", async () => {
    const ran: string[] = []
    const outcome = await withKernel(
      [startable("eva.tui", ran, true), startable(WEB_SURFACE, ran)],
      runServe,
    )

    expect(Exit.isSuccess(outcome)).toBe(true)
    expect(ran).toEqual([WEB_SURFACE])
  })

  // A build without `eva.web` is missing a door, and it says which doors it
  // has rather than exiting as though it served.
  it("fails when this build registered no eva.web row", async () => {
    const outcome = await withKernel([startable("eva.tui", [], true)], runServe)
    expect(Exit.isFailure(outcome)).toBe(true)
  })

  // A row without `start` names a surface the build knows of but cannot run.
  it("fails on an eva.web row with nothing to start", async () => {
    const outcome = await withKernel([row({ id: WEB_SURFACE })], runServe)
    expect(Exit.isFailure(outcome)).toBe(true)
  })

  it("names what it did find", () => {
    expect(new NoWebSurfaceError(["eva.tui"]).message).toContain("eva.tui")
    expect(new NoWebSurfaceError([]).message).toContain("no surface is registered")
  })
})

describe("how a serve ends", () => {
  it("exits 0 when the surface stopped", async () => {
    const outcome = await withKernel([startable(WEB_SURFACE, [])], runServe)
    expect(closed(outcome, () => undefined)).toBe(0)
  })

  /**
   * Ctrl-C is the only way to stop this surface — the page holds until the
   * process does — so an interrupt is how a serve ends. It used to print
   * "All fibers interrupted without error" and exit 1.
   */
  it("exits 0 and says nothing on an interrupt", async () => {
    const lines: string[] = []
    const outcome = await Effect.runPromiseExit(Effect.interrupt)

    expect(closed(outcome, (text: string) => void lines.push(text))).toBe(0)
    expect(lines).toEqual([])
  })

  it("exits 1 and names what it did find when the row is not there", async () => {
    const lines: string[] = []
    const outcome = await withKernel([startable("eva.tui", [], true)], runServe)

    expect(closed(outcome, (text: string) => void lines.push(text))).toBe(1)
    expect(lines.join("")).toContain("eva.tui")
  })
})

/**
 * A surface row is started with a Client and nothing else, so the bind and
 * the writer are closed over when the plugin is made. `serving` is where the
 * command line's flags and the plugin meet.
 */
describe("the build a serve runs on", () => {
  const table = buildOf([...BUILT_IN])

  it("carries an eva.web, and only one", () => {
    const built = serving(table, {}, () => undefined)
    expect(built.all.filter((plugin) => plugin.id === WEB_SURFACE)).toHaveLength(1)
    expect(built.carries(WEB_SURFACE)).toBeDefined()
  })

  // Both halves of the one port, because the cell they are wired to is one
  // run's own.
  it("carries an eva.api beside it, and only one", () => {
    const built = serving(table, {}, () => undefined)
    expect(built.all.filter((plugin) => plugin.id === API_PLUGIN)).toHaveLength(1)
    expect(built.carries(API_PLUGIN)).not.toBe(table.carries(API_PLUGIN))
  })

  it("replaces the table's entry rather than adding beside it", () => {
    const built = serving(table, {}, () => undefined)
    expect(built.carries(WEB_SURFACE)).not.toBe(table.carries(WEB_SURFACE))
    expect(built.all).toHaveLength(table.all.length)
  })

  it("leaves every plugin but those two exactly as it was", () => {
    const built = serving(table, { port: 0 }, () => undefined)
    for (const plugin of table.all) {
      if (plugin.id === WEB_SURFACE || plugin.id === API_PLUGIN) continue
      expect(built.carries(plugin.id)).toBe(plugin)
    }
  })
})

describe("where the built page is looked for", () => {
  // A binary with a page staged beside it, as the release build leaves one.
  const packed = (page?: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "eva-packed-"))
    if (page !== undefined) {
      mkdirSync(join(dir, "eva-page"), { recursive: true })
      writeFileSync(join(dir, "eva-page", "index.html"), page)
    }
    return join(dir, "eva")
  }

  // The same lookup answers from `src` and from the packed `dist`, because
  // they sit at the same depth under `apps/cli`.
  it("is apps/web/dist, beside this app", () => {
    expect(assetRoot().replaceAll("\\", "/")).toContain("apps/web/dist")
  })

  // A compiled binary has no workspace over it, so the release stages the page
  // beside it and the binary's own path is what finds it.
  it("is eva-page beside the binary, when a release staged one there", () => {
    const binary = packed("<!doctype html>")
    expect(assetRoot(binary)).toBe(join(dirname(binary), "eva-page"))
  })

  // An empty directory beside the binary is not a page, so the notice a person
  // reads names the build they can run rather than a path nobody staged.
  it("is apps/web/dist when nothing is staged beside the binary", () => {
    expect(assetRoot(packed()).replaceAll("\\", "/")).toContain("apps/web/dist")
  })
})
