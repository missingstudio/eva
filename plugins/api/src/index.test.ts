import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { memorySessionAPI } from "@missingstudio/eva-client-runtime"
import type { SessionAPI } from "@missingstudio/eva-core"
import { define, modelRows } from "@missingstudio/eva-sdk"
import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { makeApi } from "./index.js"
import type { Answering } from "./routes.js"
import { commandPath, MODELS } from "./wire.js"

// A Catalog with a model in it, written by a plugin that loads first — the
// way a Provider's models really arrive.
const catalog = define({
  id: "test.catalog",
  effect: Effect.fn("test.catalog")(function* (ctx) {
    yield* ctx.catalog.transform((draft) => {
      draft.model.update("anthropic", "claude-opus-5", (model) => {
        model.contextWindow = 400_000
      })
    })
  }),
})

// A command row a plugin registered, the way `/cost` really arrives.
const commanding = define({
  id: "test.commanding",
  effect: Effect.fn("test.commanding")(function* (ctx) {
    yield* ctx.command.transform((draft) => {
      draft.set({
        id: "ping",
        description: "Say so",
        run: (command) => Effect.sync(() => command.write("pong\n")),
      })
    })
  }),
})

// The wire on a port of its own, so a request really reaches it.
const standing = async (answering: Answering) => {
  const server = createServer((request, response) => void answering(request, response))
  await new Promise<void>((settle) => void server.listen(0, "127.0.0.1", () => settle()))
  const { port } = server.address() as AddressInfo

  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((settle) => {
        server.closeAllConnections()
        server.close(() => settle())
      }),
  }
}

describe("the plugin", () => {
  it("hands over a wire when it loads, and registers no row", async () => {
    let handed: ((api: SessionAPI) => Answering) | undefined
    const rows = await withPlugin(
      makeApi({ serve: (one) => void (handed = one) }),
      (kernel) => kernel.domains.command.get,
    )

    expect(handed).toBeTypeOf("function")
    expect(rows).toEqual([])
  })

  /**
   * The one Domain this wire reads. A plugin may not import the plugin that
   * fills the Catalog, and it does not have to: the context a plugin loads
   * with carries every Domain, so `eva.api` answers the rows its own build
   * knows — the same rows `/model` picks from in that build.
   */
  it("answers the Catalog its own context holds", async () => {
    const memory = await Effect.runPromise(memorySessionAPI(() => Effect.void))
    let handed: ((api: SessionAPI) => Answering) | undefined

    const answered = await withPlugin(
      makeApi({ serve: (one) => void (handed = one) }),
      (kernel) =>
        Effect.flatMap(kernel.domains.catalog.get, (state) =>
          Effect.promise(async () => {
            if (handed === undefined) throw new Error("the plugin handed over no wire")
            const served = await standing(handed(memory.api))
            const read = (await (await fetch(`${served.origin}${MODELS}`)).json()) as unknown
            await served.close()
            return { read, rows: modelRows(state) }
          }),
        ),
      { before: [catalog] },
    )

    expect(answered.read).toEqual(answered.rows)
    expect(answered.rows.map((row) => row.id)).toEqual(["anthropic/claude-opus-5"])
  })

  /**
   * The other Domain read off the same context, and the reason it is pinned
   * here beside the Catalog: both reach the wire through one seam, so a build
   * that kept one and dropped the other would serve a page that can pick a
   * model and run no line.
   */
  it("runs a line against the commands its own context holds", async () => {
    const memory = await Effect.runPromise(memorySessionAPI(() => Effect.void))
    let handed: ((api: SessionAPI) => Answering) | undefined

    const wrote = await withPlugin(
      makeApi({ serve: (one) => void (handed = one) }),
      () =>
        Effect.promise(async () => {
          if (handed === undefined) throw new Error("the plugin handed over no wire")
          const served = await standing(handed(memory.api))
          const response = await fetch(`${served.origin}${commandPath(memory.session)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ line: "/ping" }),
          })
          const body = (await response.json()) as { readonly wrote: string }
          await served.close()
          return body.wrote
        }),
      { before: [commanding] },
    )

    expect(wrote).toBe("pong\n")
  })
})
