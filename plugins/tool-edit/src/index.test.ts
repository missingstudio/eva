import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { toolEdit } from "./index.js"
import { EDIT_TOOL_INPUT, editToolOf } from "./row.js"

/**
 * What this package can hold to on its own. The tool's own contract runs in
 * `packages/conformance`, over the real applier and the real Recorder: a
 * plugin may not import another plugin, and a tool tested against a double of
 * the applier would be tested against a shape nothing else in the tree has.
 */
describe("the edit tool plugin", () => {
  it("carries the id the kernel registers it under", () => {
    expect(toolEdit.id).toBe("eva.tool.edit")
  })

  it("loads with every slot it reads still empty", async () => {
    const loaded = await withPlugin(toolEdit, () => Effect.succeed(true))

    expect(loaded).toBe(true)
  })

  it("builds a row that names the edit tool and the kind the Trace records", async () => {
    const found = await withPlugin(toolEdit, (kernel) =>
      Effect.map(editToolOf(kernel), (made) => made.row),
    )

    expect(found.id).toBe("edit")
    expect(found.kind).toBe("edit")
    expect(found.input).toBe(EDIT_TOOL_INPUT)
    expect(found.execute).toBeTypeOf("function")
  })

  // The undo is on the tool and not on the row: a row is what a model calls,
  // and reversing a write is not one of the calls it makes.
  it("builds a tool that answers both a write and its undo", async () => {
    const found = await withPlugin(toolEdit, (kernel) =>
      Effect.map(editToolOf(kernel), (made) => made.tool),
    )

    expect(found.execute).toBeTypeOf("function")
    expect(found.undo).toBeTypeOf("function")
  })
})
