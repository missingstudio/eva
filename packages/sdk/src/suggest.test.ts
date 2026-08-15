import { describe, expect, it } from "vitest"
import { nearest } from "./suggest.js"

const KEYS = ["model", "plugins", "agents", "commands", "keymap", "theme", "themes"]

describe("nearest", () => {
  it.each([
    ["keympa", "keymap"],
    ["agent", "agents"],
    ["mdoel", "model"],
    ["plugin", "plugins"],
  ])("reads %s as %s", (typo, meant) => {
    expect(nearest(typo, KEYS)).toBe(meant)
  })

  it("answers nothing when no candidate is close", () => {
    expect(nearest("telemetry", KEYS)).toBeUndefined()
  })

  it("answers nothing when there are no candidates at all", () => {
    expect(nearest("model", [])).toBeUndefined()
  })

  it("takes the closest of several near candidates", () => {
    expect(nearest("themes", KEYS)).toBe("themes")
  })

  // A short name needs a near-exact match, or every typo matches it.
  it("holds a short candidate to a tighter tolerance than a long one", () => {
    expect(nearest("xyz", ["id"])).toBeUndefined()
    expect(nearest("configuratoin", ["configuration"])).toBe("configuration")
  })
})
