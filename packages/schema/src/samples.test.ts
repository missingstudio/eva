import { describe, expect, it } from "vitest"
import { kinds } from "./payload.js"
import { samples } from "./samples.js"

describe("samples", () => {
  it("covers the kind registry exactly, so a new kind with no sample fails loudly", () => {
    expect(Object.keys(samples()).sort()).toEqual([...kinds()].sort())
  })

  it("stamps every sample with its own key", () => {
    for (const [kind, payload] of Object.entries(samples())) {
      expect(payload.kind).toBe(kind)
    }
  })
})
