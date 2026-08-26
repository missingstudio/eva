import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { commandTool, toolBash } from "./index.js"

/**
 * The plugin definition. The tool domain arrives with the execution pipeline,
 * so what a load can be held to today is that it reads its options and loads
 * clean; what the row holds is asserted on the row itself.
 */
describe("the eva.tool.bash plugin", () => {
  it("carries the id the kernel registers it under", () => {
    expect(toolBash.id).toBe("eva.tool.bash")
  })

  // Every option a plugin reads is declared, so a misspelling under its
  // config entry is named rather than falling back in silence.
  it("declares the two options it reads", () => {
    expect(toolBash.takes).toEqual({ timeout: "number", maxOutput: "number" })
  })

  it("loads over a live kernel", async () => {
    const loaded = await withPlugin(toolBash, (kernel) => kernel.runtime.list)

    expect(loaded).toContain("eva.tool.bash")
  })

  it("names the tool a model calls, and what kind of tool it is", () => {
    const row = commandTool({ sandbox: Effect.succeed(undefined), timeout: 1, maxOutput: 1 })

    expect(row.id).toBe("bash")
    expect(row.kind).toBe("execute")
    expect(row.run).toBeTypeOf("function")
  })

  // The words are already split, and a model has to be told so or it writes
  // a shell line into one of them.
  it("tells the model the command is already split into words", () => {
    const row = commandTool({ sandbox: Effect.succeed(undefined), timeout: 1, maxOutput: 1 })

    expect(row.description).toContain("already split into words")
  })
})
