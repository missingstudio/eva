import { errorClasses } from "@missingstudio/eva-schema"
import { describe, expect, it } from "vitest"
import { DEFAULTS, RETRYABLE, backoff, shouldRetry } from "./index.js"

describe("RETRYABLE", () => {
  // An auth failure, a missing model, and a billing problem do not improve
  // by being asked again.
  it("holds only the classes another attempt can fix", () => {
    const permanent = errorClasses().filter((one) => !RETRYABLE.has(one))
    expect([...permanent].sort()).toEqual(
      ["auth_failed", "billing", "no_such_model", "other"].sort(),
    )
  })
})

describe("backoff", () => {
  it.each([
    [1, 500],
    [2, 1000],
    [3, 2000],
    [8, 30_000],
  ])("waits %ims on attempt %i", (attempt, expected) => {
    expect(backoff(attempt)).toBe(expected)
  })

  it("never exceeds the cap", () => {
    expect(backoff(50, { baseMs: 1000, capMs: 4000 })).toBe(4000)
  })
})

describe("shouldRetry", () => {
  it("retries a transient failure until the attempt cap", () => {
    expect(shouldRetry("overloaded", 1)).toBe(true)
    expect(shouldRetry("overloaded", DEFAULTS.maxAttempts)).toBe(false)
  })

  it.each(["auth_failed", "no_such_model", "billing", "other"] as const)(
    "never retries %s",
    (errorClass) => {
      expect(shouldRetry(errorClass, 1)).toBe(false)
    },
  )
})
