import { describe, expect, it } from "vitest"
import { dispositions, errorClasses, kinds, resolutions } from "./payload.js"

// The glossary in docs/context.md fixes these sets. Drift fails here.
describe("the closed sets", () => {
  it("holds twenty payload kinds", () => {
    expect(kinds()).toHaveLength(20)
    expect(new Set(kinds()).size).toBe(20)
  })

  // A Question that cannot be answered in the record is a Trace that
  // cannot rebuild the exchange.
  it("pairs needs_human with resolved", () => {
    expect(kinds()).toContain("needs_human")
    expect(kinds()).toContain("resolved")
  })

  it("holds the four resolutions", () => {
    expect([...resolutions()]).toEqual(["answered", "rejected", "expired", "cancelled"])
  })

  it("holds the eight error classes, and none of them means unclassified", () => {
    expect([...errorClasses()]).toEqual([
      "rate_limit",
      "overloaded",
      "auth_failed",
      "unreachable",
      "server_error",
      "no_such_model",
      "billing",
      "other",
    ])
  })

  it("holds the seven dispositions", () => {
    expect([...dispositions()]).toEqual([
      "ok",
      "denied",
      "failed",
      "skipped",
      "cancelled",
      "unknown_tool",
      "budget_denied",
    ])
  })
})
