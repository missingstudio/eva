import { calling, virtualFileSystem, withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { toolGlob } from "./index.js"

describe("the glob tool plugin", () => {
  it("carries the id the kernel registers it under", () => {
    expect(toolGlob.id).toBe("eva.tool.glob")
  })

  it("registers one row in the tool domain, under the name the model calls", async () => {
    const rows = await withPlugin(toolGlob, (kernel) => kernel.domains.tool.get)

    expect(rows.map((row) => [row.id, row.kind])).toEqual([["glob", "search"]])
    expect(rows[0]?.execute).toBeTypeOf("function")
  })

  it("names files end to end, through the pipeline and the virtual slot", async () => {
    const virtual = virtualFileSystem({ "src/one.ts": "one", "docs/two.md": "two" })

    const ran = await withPlugin(
      toolGlob,
      (kernel) => {
        const calls = calling(kernel)
        return Effect.map(calls.call("glob", { pattern: "**/*.ts" }), (result) => ({
          result,
          said: calls.said().map((payload) => payload.kind),
        }))
      },
      { before: [virtual.plugin] },
    )

    expect(ran.result).toEqual({
      disposition: "ok",
      content: [{ type: "text", text: "src/one.ts" }],
    })
    expect(ran.said).toEqual(["tool_call", "tool_update", "tool_result"])
  })

  it("takes its row with it when it unloads", async () => {
    const rows = await withPlugin(toolGlob, (kernel) =>
      Effect.gen(function* () {
        yield* kernel.runtime.remove("eva.tool.glob")
        return yield* kernel.domains.tool.get
      }),
    )

    expect(rows).toEqual([])
  })
})
