import { describe, expect, it } from "vitest"
import type { PromptInfo } from "./domains.js"
import { instructionOf } from "./prompt.js"

const row = (id: string, text: string): PromptInfo => ({ id, text })

describe("instructionOf", () => {
  it("fills one Variable", () => {
    const asked = instructionOf([row("greet", "hello {{name}}")], "greet", { name: "eva" })

    expect(asked).toEqual({ kind: "ready", text: "hello eva" })
  })

  it("refuses two Variables with one bound, naming only the unbound one", () => {
    const asked = instructionOf([row("greet", "{{name}} is {{age}}")], "greet", { name: "eva" })

    expect(asked).toEqual({ kind: "refused", gaps: [{ kind: "variable", name: "age" }] })
  })

  it("fills through one include", () => {
    const rows = [row("greet", "hello {{> tail}}"), row("tail", "world")]

    expect(instructionOf(rows, "greet", {})).toEqual({ kind: "ready", text: "hello world" })
  })

  it("fills through an include chain two deep", () => {
    const rows = [row("a", "one {{> b}}"), row("b", "two {{> c}}"), row("c", "three")]

    expect(instructionOf(rows, "a", {})).toEqual({ kind: "ready", text: "one two three" })
  })

  // A diamond is not a cycle: the path is what was walked to get here, so a
  // Template two others include composes once under each of them.
  it("fills a Template included by two others, once each", () => {
    const rows = [
      row("a", "{{> b}} {{> c}}"),
      row("b", "[{{> d}}]"),
      row("c", "({{> d}})"),
      row("d", "{{x}}"),
    ]

    expect(instructionOf(rows, "a", { x: "X" })).toEqual({ kind: "ready", text: "[X] (X)" })
  })

  it("refuses a self-include as a cycle", () => {
    const asked = instructionOf([row("a", "again: {{> a}}")], "a", {})

    expect(asked).toEqual({ kind: "refused", gaps: [{ kind: "cycle", name: "a" }] })
  })

  it("refuses a two-row cycle", () => {
    const rows = [row("a", "{{> b}}"), row("b", "{{> a}}")]

    expect(instructionOf(rows, "a", {})).toEqual({
      kind: "refused",
      gaps: [{ kind: "cycle", name: "a" }],
    })
  })

  it("refuses an id that names no row, and names the near miss", () => {
    const asked = instructionOf([row("commit-msg", "text")], "comit-msg", {})

    expect(asked).toEqual({
      kind: "refused",
      gaps: [{ kind: "template", name: "comit-msg", meant: "commit-msg" }],
    })
  })

  // The injection test, and the point of the one-pass rule: an inserted value
  // is never scanned again, so a staged diff holding a marker is text.
  it("carries a bound value holding a marker verbatim, with no Gap", () => {
    const asked = instructionOf([row("review", "review: {{diff}}")], "review", {
      diff: "a {{secret}} b",
    })

    expect(asked).toEqual({ kind: "ready", text: "review: a {{secret}} b" })
  })

  it("reports the same missing Variable once through a Template included twice", () => {
    const rows = [row("a", "{{> b}} {{> b}}"), row("b", "{{x}}")]

    expect(instructionOf(rows, "a", {})).toEqual({
      kind: "refused",
      gaps: [{ kind: "variable", name: "x" }],
    })
  })

  // The marker's inside is judged, not passed through: text a person never
  // sees is worse than a refusal that names it.
  it("refuses a marker with a space as a Variable named by the whole inside", () => {
    const asked = instructionOf([row("a", "{{foo bar}}")], "a", {})

    expect(asked).toEqual({ kind: "refused", gaps: [{ kind: "variable", name: "foo bar" }] })
  })

  it("fills a bound empty string, because it is a value", () => {
    const asked = instructionOf([row("a", "one{{x}}two")], "a", { x: "" })

    expect(asked).toEqual({ kind: "ready", text: "onetwo" })
  })

  // The assertion the measured number rests on: no clock, no environment, no
  // file, so the same rows, id and Variables give the identical string.
  it("gives the identical string when called twice", () => {
    const rows = [row("a", "{{> b}} and {{x}}"), row("b", "base")]
    const once = instructionOf(rows, "a", { x: "y" })
    const twice = instructionOf(rows, "a", { x: "y" })

    expect(once).toEqual(twice)
    expect(once.kind).toBe("ready")
  })
})
