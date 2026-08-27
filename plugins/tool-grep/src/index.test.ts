import { calling, virtualFileSystem, withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { toolGrep } from "./index.js"

describe("the grep tool plugin", () => {
  it("carries the id the kernel registers it under", () => {
    expect(toolGrep.id).toBe("eva.tool.grep")
  })

  it("registers one row in the tool domain, under the name the model calls", async () => {
    const rows = await withPlugin(toolGrep, (kernel) => kernel.domains.tool.get)

    expect(rows.map((row) => [row.id, row.kind])).toEqual([["grep", "search"]])
    expect(rows[0]?.execute).toBeTypeOf("function")
  })

  it("searches end to end, through the execution and the virtual slot", async () => {
    const virtual = virtualFileSystem({ "src/one.ts": "const UserSvc = 1\n" })

    const ran = await withPlugin(
      toolGrep,
      (kernel) => {
        const calls = calling(kernel)
        return Effect.map(calls.call("grep", { pattern: "UserSvc" }), (result) => ({
          result,
          said: calls.said().map((payload) => payload.kind),
        }))
      },
      { before: [virtual.plugin] },
    )

    expect(ran.result).toEqual({
      disposition: "ok",
      content: [{ type: "text", text: "src/one.ts:1:const UserSvc = 1" }],
    })
    expect(ran.said).toEqual(["tool_call", "tool_update", "tool_result"])
  })

  it("takes its row with it when it unloads", async () => {
    const rows = await withPlugin(toolGrep, (kernel) =>
      Effect.gen(function* () {
        yield* kernel.runtime.remove("eva.tool.grep")
        return yield* kernel.domains.tool.get
      }),
    )

    expect(rows).toEqual([])
  })
})
