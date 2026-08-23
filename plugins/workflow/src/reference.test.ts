import { describe, expect, it } from "vitest"
import { readReference, resolveReference, type Reference } from "./reference.js"

describe("readReference", () => {
  it("reads the three shapes and nothing else", () => {
    expect(readReference("input")).toEqual({ kind: "input" })
    expect(readReference("summarize.output")).toEqual({
      kind: "output",
      step: "summarize",
      path: [],
    })
    expect(readReference("summarize.output.entries.first")).toEqual({
      kind: "output",
      step: "summarize",
      path: ["entries", "first"],
    })
  })

  // The language has exactly three shapes; anything else is a load problem,
  // so a typo is named at the file rather than misread at a Run.
  it.each([
    "summarize",
    "summarize.result",
    ".output",
    "summarize.output.",
    "summarize.output..deep",
    "summarize.entries.output",
    "",
  ])("reads %j as no reference at all", (written) => {
    expect(readReference(written)).toBeUndefined()
  })
})

const output = (step: string, path: readonly string[]): Reference => ({
  kind: "output",
  step,
  path,
})

describe("resolveReference", () => {
  const outputs = new Map<string, unknown>([
    ["summarize", { entries: ["one", "two"], count: 2, meta: { tone: "dry" } }],
    ["draft", "plain text"],
  ])

  it("resolves input to the whole Prompt text", () => {
    expect(resolveReference({ kind: "input" }, "the prompt", outputs)).toEqual({
      kind: "text",
      text: "the prompt",
    })
  })

  it("resolves a whole Output", () => {
    expect(resolveReference(output("draft", []), "", outputs)).toEqual({
      kind: "text",
      text: "plain text",
    })
  })

  it("resolves a dotted path to one field", () => {
    expect(resolveReference(output("summarize", ["meta", "tone"]), "", outputs)).toEqual({
      kind: "text",
      text: "dry",
    })
  })

  // Variables is Record<string, string>, so a value that is not text is
  // stringified once, in one place.
  it("stringifies a number Output once", () => {
    expect(resolveReference(output("summarize", ["count"]), "", outputs)).toEqual({
      kind: "text",
      text: "2",
    })
  })

  it("stringifies a structured Output as JSON", () => {
    expect(resolveReference(output("summarize", ["entries"]), "", outputs)).toEqual({
      kind: "text",
      text: '["one","two"]',
    })
  })

  it("misses on a dotted path that runs off the end of a value", () => {
    expect(resolveReference(output("summarize", ["meta", "voice"]), "", outputs)).toEqual({
      kind: "missing",
      why: "summarize.output.meta holds no voice",
    })
  })

  it("misses on a path into a string Output", () => {
    expect(resolveReference(output("draft", ["entries"]), "", outputs)).toEqual({
      kind: "missing",
      why: "draft.output is text and holds no entries",
    })
  })

  it("misses on a Step that has not run", () => {
    expect(resolveReference(output("group", []), "", outputs)).toEqual({
      kind: "missing",
      why: "step group has not run",
    })
  })
})
