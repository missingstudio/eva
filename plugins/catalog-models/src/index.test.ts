import { describe, expect, it } from "vitest"
import { ANTHROPIC_MODELS, DEFAULT_MODEL } from "./index.js"

describe("ANTHROPIC_MODELS", () => {
  it.each(ANTHROPIC_MODELS)("gives $id a name and a positive context window", (seed) => {
    expect(seed.id).not.toBe("")
    expect(seed.name).not.toBe("")
    expect(seed.contextWindow).toBeGreaterThan(0)
  })

  // The catalog keys a model by its id, so a repeat would overwrite a row.
  it("holds one seed per id", () => {
    const ids = ANTHROPIC_MODELS.map((seed) => seed.id)

    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("DEFAULT_MODEL", () => {
  // A default outside the seed list points at a model the catalog never holds.
  it("names a model the seed list holds", () => {
    expect(DEFAULT_MODEL.provider).toBe("anthropic")
    expect(ANTHROPIC_MODELS.some((seed) => seed.id === DEFAULT_MODEL.model)).toBe(true)
  })
})
