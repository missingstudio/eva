import { canonical, conflicts } from "@missingstudio/eva-tui-core"
import { describe, expect, it } from "vitest"
import { withPlugin } from "@missingstudio/eva-testkit"
import { BINDINGS, keymap } from "./index.js"

describe("the default bindings", () => {
  it("carry no conflict", () => {
    expect(conflicts(BINDINGS)).toEqual([])
  })

  // The surface holds bindings in their one spelling; a default that is not
  // already canonical would read as a different key than it fires as.
  it("are written in their canonical spelling", () => {
    for (const row of BINDINGS) {
      expect(canonical(row.binding)).toBe(row.binding)
    }
  })
})

/**
 * Through a live kernel, because the transform is the half a unit test on
 * `BINDINGS` cannot reach: a row written under the wrong id, or a field left
 * off, reads as a working plugin until a surface looks for the binding.
 */
describe("the keymap plugin", () => {
  it("writes every binding into the keymap domain", async () => {
    const rows = await withPlugin(keymap, (kernel) => kernel.domains.keymap.get)

    expect(rows.map((row) => row.id)).toEqual(BINDINGS.map((binding) => binding.id))
    expect(conflicts(rows)).toEqual([])
  })

  it("carries the binding, the command, and the surface onto each row", async () => {
    const rows = await withPlugin(keymap, (kernel) => kernel.domains.keymap.get)

    expect(rows.find((row) => row.id === "submit")).toEqual({
      id: "submit",
      binding: "enter",
      command: "session.submit",
      surface: "eva.tui",
    })
  })
})
