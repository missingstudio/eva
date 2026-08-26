import { calling, virtualFileSystem, withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { toolRead } from "./index.js"

/**
 * Through a live kernel, because the half that matters is the transform and
 * the pipeline that runs the row: a plugin whose id is right and whose effect
 * registers nothing looks identical from outside until something calls it.
 */
describe("the read tool plugin", () => {
  it("carries the id the kernel registers it under", () => {
    expect(toolRead.id).toBe("eva.tool.read")
  })

  it("registers one row in the tool domain, under the name the model calls", async () => {
    const rows = await withPlugin(toolRead, (kernel) => kernel.domains.tool.get)

    expect(rows.map((row) => [row.id, row.kind])).toEqual([["read", "read"]])
    expect(rows[0]?.execute).toBeTypeOf("function")
  })

  it("reads a file end to end, through the pipeline and the virtual slot", async () => {
    const virtual = virtualFileSystem({ "notes/one.md": "read through the slot" })

    const ran = await withPlugin(
      toolRead,
      (kernel) => {
        const calls = calling(kernel)
        return Effect.map(calls.call("read", { path: "notes/one.md" }), (result) => ({
          result,
          said: calls.said().map((payload) => payload.kind),
        }))
      },
      { before: [virtual.plugin] },
    )

    expect(ran.result).toEqual({
      disposition: "ok",
      content: [{ type: "text", text: "read through the slot" }],
    })
    expect(ran.said).toEqual(["tool_call", "tool_update", "tool_result"])
  })

  it("takes its row with it when it unloads", async () => {
    const rows = await withPlugin(toolRead, (kernel) =>
      Effect.gen(function* () {
        yield* kernel.runtime.remove("eva.tool.read")
        return yield* kernel.domains.tool.get
      }),
    )

    expect(rows).toEqual([])
  })
})
