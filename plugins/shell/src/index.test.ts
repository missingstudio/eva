import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { shell } from "./index.js"

describe("the shell plugin", () => {
  it("carries the id the kernel registers it under", () => {
    expect(shell.id).toBe("eva.shell")
  })

  it("fills the Shell slot", async () => {
    const found = await withPlugin(shell, (kernel) => kernel.slot.shell.peek)

    expect(found?.spawn).toBeTypeOf("function")
  })

  it("empties the slot when it unloads", async () => {
    const found = await withPlugin(shell, (kernel) =>
      Effect.gen(function* () {
        yield* kernel.runtime.remove("eva.shell")
        return yield* kernel.slot.shell.peek
      }),
    )

    expect(found).toBeUndefined()
  })
})
