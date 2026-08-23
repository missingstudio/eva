import { describe, expect, it } from "vitest"
import { project } from "./project.js"

describe("project", () => {
  it("makes a row of a mapping entry, keyed by its id", () => {
    expect(project({ "commit-msg": { text: "Write one line." } })).toEqual([
      { id: "commit-msg", text: "Write one line." },
    ])
  })

  it("drops a text written as a number or a list rather than coercing it", () => {
    expect(project({ x: { text: 5 }, y: { text: ["a", "b"] } })).toEqual([])
  })

  // A Template with nothing in it is not one.
  it("drops an empty text", () => {
    expect(project({ x: { text: "" } })).toEqual([])
  })

  it("drops an entry that is not a mapping", () => {
    expect(project({ x: "bare text", y: 5 })).toEqual([])
  })
})
