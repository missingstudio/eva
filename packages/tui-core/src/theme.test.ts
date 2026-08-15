import { describe, expect, it } from "vitest"
import { THEME_KEYS, themeColors } from "./theme.js"

const full = Object.fromEntries(THEME_KEYS.map((key) => [key, "#e6e6e6"]))

describe("themeColors", () => {
  // Welds the gate to the vocabulary: the keys the contract names are
  // exactly the keys the gate demands, no more and no fewer.
  it("accepts a row that fills every key the contract names", () => {
    expect(themeColors(full)).toEqual(full)
  })

  it.each(THEME_KEYS)("answers nothing when %s is missing", (key) => {
    const { [key]: _, ...partial } = full
    expect(themeColors(partial)).toBeUndefined()
  })

  it.each(THEME_KEYS)("answers nothing when %s is empty", (key) => {
    expect(themeColors({ ...full, [key]: "" })).toBeUndefined()
  })

  // A row may carry more than the contract; the contract takes its own.
  it("passes over keys the contract does not name", () => {
    expect(themeColors({ ...full, background: "#101014" })).toEqual(full)
  })
})
