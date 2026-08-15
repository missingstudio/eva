import type { Payload } from "@missingstudio/eva-schema"
import { describe, expect, it } from "vitest"
import { normalize } from "./index.js"

const usage = (over: Partial<Extract<Payload, { kind: "usage" }>> = {}): Payload => ({
  kind: "usage",
  model: "anthropic/claude-opus-5",
  inputTokens: 10,
  outputTokens: 5,
  cacheWriteTokens: null,
  cacheReadTokens: 0,
  ...over,
})

describe("normalize", () => {
  it("clamps a negative count to zero", () => {
    expect(normalize(usage({ outputTokens: -3 }))).toMatchObject({ outputTokens: 0 })
  })

  it("truncates a fractional count", () => {
    expect(normalize(usage({ inputTokens: 10.9 }))).toMatchObject({ inputTokens: 10 })
  })

  // Silence is not zero: a normalizer must not invent a figure.
  it("leaves an unreported count unreported", () => {
    expect(normalize(usage({ cacheWriteTokens: null }))).toMatchObject({ cacheWriteTokens: null })
  })

  it("leaves an absent optional counter absent", () => {
    expect(normalize(usage())).not.toHaveProperty("reasoningTokens")
  })

  it("passes every other kind through untouched", () => {
    const other: Payload = { kind: "edit", path: "a.ts", hunks: 2 }
    expect(normalize(other)).toBe(other)
  })
})
