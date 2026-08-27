import type { CostSummary } from "@missingstudio/eva-schema"
import { describe, expect, it } from "vitest"
import { costLine, formatCount } from "./cost-line.js"

const summary = (over: Partial<CostSummary> = {}): CostSummary => ({
  inputTokens: 1200,
  outputTokens: 340,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
  serverToolTokens: 0,
  costTicks: null,
  estimatedCostTicks: null,
  ...over,
})

describe("formatCount", () => {
  it.each([
    [0, "0"],
    [1, "1"],
    [999, "999"],
    [1000, "1.0k"],
    [1200, "1.2k"],
    [1_250_000, "1250.0k"],
  ])("prints %i as %s", (value, expected) => {
    expect(formatCount(value)).toBe(expected)
  })
})

describe("costLine", () => {
  it("reads as the shape the product shows", () => {
    expect(costLine(summary())).toBe("1.2k in / 340 out · cost unreported")
  })

  it("prints a reported cost as money", () => {
    expect(costLine(summary({ costTicks: 51_000_000_000 }))).toBe("1.2k in / 340 out · $5.10")
  })

  /**
   * A Session that has not run is not a Session whose spend nobody reported.
   * One line for both tells a person their provider is silent when it has
   * simply not been asked for anything.
   */
  it("says nothing was spent rather than that nothing was reported", () => {
    expect(costLine(summary(), false)).toBe("nothing spent yet")
  })

  it("reports the silence once the session has run", () => {
    expect(costLine(summary(), true)).toContain("cost unreported")
  })

  // A figure Eva worked out never wears the same glyph as one a Provider
  // gave. Reading an estimate as a bill is the mistake worth preventing.
  it("marks an estimate and never prints it as a reported cost", () => {
    expect(costLine(summary({ estimatedCostTicks: 51_000_000_000 }))).toBe(
      "1.2k in / 340 out · ~$5.10 est",
    )
  })

  it("prefers what was reported over what was estimated", () => {
    const both = summary({ costTicks: 10_000_000_000, estimatedCostTicks: 51_000_000_000 })
    expect(costLine(both)).toBe("1.2k in / 340 out · $1.00")
  })

  // One silent record suppresses the whole total; a partial sum is never shown.
  it.each([
    ["input", { inputTokens: null }, "340 out · cost unreported"],
    ["output", { outputTokens: null }, "1.2k in · cost unreported"],
  ])("drops the %s segment when nobody reported it", (_which, over, expected) => {
    expect(costLine(summary(over))).toBe(expected)
  })

  it("says the words when nothing at all was reported", () => {
    expect(costLine(summary({ inputTokens: null, outputTokens: null }))).toBe("cost unreported")
  })

  it("prints a reported zero rather than hiding it", () => {
    expect(costLine(summary({ inputTokens: 0, outputTokens: 0, costTicks: 0 }))).toBe(
      "0 in / 0 out · $0.0000",
    )
  })
})
