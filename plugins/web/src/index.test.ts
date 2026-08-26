import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  localTransport,
  makeClient,
  memorySessionAPI,
  type Client,
} from "@missingstudio/eva-client-runtime"
import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect, Exit, Scope } from "effect"
import { describe, expect, it } from "vitest"
import { makeWeb } from "./index.js"
import { WEB_SURFACE } from "./serve.js"

const built = (): string => {
  const root = mkdtempSync(join(tmpdir(), "eva-web-row-"))
  mkdirSync(join(root, "assets"))
  writeFileSync(join(root, "index.html"), "<!doctype html><div id=page></div>")
  return root
}

const rows = (assets: () => string, config: Record<string, unknown> = {}) =>
  withPlugin(makeWeb({ assets }), (kernel) => kernel.domains.surface.get, { config })

describe("the eva.web row", () => {
  /**
   * The page answers a permission request, so the row says Eva may ask this
   * surface. It is honest because the ask channel knows whether a page is
   * open: with none, the ask is cancelled rather than held.
   */
  it("declares a surface that takes input", async () => {
    expect((await rows(built)).find((one) => one.id === WEB_SURFACE)).toMatchObject({
      id: WEB_SURFACE,
      interactive: true,
      streaming: true,
      images: false,
    })
  })

  it("knows how to start", async () => {
    expect((await rows(built)).find((one) => one.id === WEB_SURFACE)?.start).toBeTypeOf("function")
  })

  /**
   * A row is a factory, and nothing it needs is read until it starts.
   * `apps/cli/src/main.test.ts` boots the built-in table on every one of its
   * tests, so a plugin that read the disk or bound a port in its `effect`
   * would do it on each of them.
   */
  it("reads nothing and opens nothing when the plugin loads", async () => {
    let read = 0
    await rows(() => {
      read += 1
      return built()
    })
    expect(read).toBe(0)
  })
})

/**
 * The posture is read where the surface starts, so what the row printed says
 * which one was active. The artifact is the same either way, which
 * `serve.test.ts` proves over a socket.
 */
describe("the posture, read at serve time", () => {
  const client: Effect.Effect<Client> = Effect.gen(function* () {
    const memory = yield* memorySessionAPI(() => Effect.void)
    return yield* makeClient(yield* localTransport(memory.api))
  })

  const started = async (config: Record<string, unknown>): Promise<string> => {
    const said: string[] = []
    const assets = built()
    const plugin = makeWeb({
      assets: () => assets,
      write: (text) => void said.push(text),
      port: 0,
    })

    await withPlugin(
      plugin,
      (kernel) =>
        Effect.gen(function* () {
          const start = (yield* kernel.domains.surface.get).find(
            (one) => one.id === WEB_SURFACE,
          )?.start
          if (start === undefined) return
          const scope = yield* Scope.make()
          yield* Effect.provideService(start(yield* client), Scope.Scope, scope)
          yield* Scope.close(scope, Exit.void)
        }),
      { config },
    )
    return said.join("")
  }

  it("is local when config names none", async () => {
    expect(await started({})).toContain("in the local posture")
  })

  it("is what config names, and there is no second build", async () => {
    expect(await started({ posture: "hosted" })).toContain("in the hosted posture")
  })

  // Read through the declaration, so `posture: hosted` and
  // `posture: { id: hosted }` name the same posture.
  it("reads the mapping form of the name too", async () => {
    expect(await started({ posture: { id: "hosted" } })).toContain("in the hosted posture")
  })
})
