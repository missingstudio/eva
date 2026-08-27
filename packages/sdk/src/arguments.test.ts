import { describe, expect, it } from "vitest"
import { takes } from "./arguments.js"

/**
 * A tool's arguments, declared once. The schema a model is shown, the reader
 * the tool takes them with, and the sentence a model reads when it wrote
 * something else all come out of the one statement — so a tool cannot show
 * `pattern` and read `patern`.
 */

const TAKES = takes({
  path: { shape: "string", description: "The file to read." },
  count: { shape: "number", optional: true, description: "How many." },
  dry: { shape: "boolean", optional: true, description: "Write nothing." },
  command: { shape: "words", description: "The program and its arguments." },
})

const said = (id: string, input: unknown): string | undefined => {
  const found = TAKES.of(id, input)
  if (found.kind === "read") return undefined
  const first = found.result.content[0]
  return first?.type === "text" ? first.text : undefined
}

describe("the schema a declaration shows a model", () => {
  it("names every argument, and requires the ones that are not optional", () => {
    expect(TAKES.schema).toEqual({
      type: "object",
      properties: {
        path: { type: "string", description: "The file to read." },
        count: { type: "number", description: "How many." },
        dry: { type: "boolean", description: "Write nothing." },
        command: {
          type: "array",
          minItems: 1,
          items: { type: "string" },
          description: "The program and its arguments.",
        },
      },
      required: ["path", "command"],
      additionalProperties: false,
    })
  })

  // The escape for an argument richer than the four shapes. The schema is
  // stated and the reading is the caller's.
  it("carries a stated schema through, with its description", () => {
    const shaped = takes({
      hunks: {
        shape: "shaped",
        description: "The replacements.",
        schema: { type: "array", minItems: 1 },
      },
    })

    expect(shaped.schema["properties"]).toEqual({
      hunks: { type: "array", minItems: 1, description: "The replacements." },
    })
  })
})

describe("the reader a declaration produces", () => {
  it("reads every argument it was given", () => {
    const found = TAKES.of("read", {
      path: "one.md",
      count: 3,
      dry: true,
      command: ["git", "status"],
    })

    expect(found).toEqual({
      kind: "read",
      args: { path: "one.md", count: 3, dry: true, command: ["git", "status"] },
    })
  })

  // An optional one nobody wrote is nothing, and the read still answers.
  it("answers nothing for an optional argument nobody wrote", () => {
    const found = TAKES.of("read", { path: "one.md", command: ["ls"] })
    expect(found.kind === "read" && found.args.count).toBeUndefined()
    expect(found.kind === "read" && found.args.dry).toBeUndefined()
  })

  /**
   * Nothing is coerced. A model that wrote a number where a string was asked
   * for wrote no string, and an empty string is nothing — a tool asked for a
   * path and handed `""` was handed no path.
   */
  it.each([
    ["nothing", undefined],
    ["no arguments at all", {}],
    ["a number", { path: 5, command: ["ls"] }],
    ["an empty string", { path: "", command: ["ls"] }],
  ])("refuses a required string written as %s", (_case, input) => {
    expect(said("read", input)).toBe("read wants a `path` string")
  })

  it.each([
    ["nothing", { path: "one.md" }],
    ["a string", { path: "one.md", command: "git status" }],
    ["an empty list", { path: "one.md", command: [] }],
    ["a list holding something else", { path: "one.md", command: ["git", 1] }],
  ])("refuses a required list of words written as %s", (_case, input) => {
    expect(said("read", input)).toBe("read wants a `command` list of words")
  })

  // The sentence names the tool that refused, because that is what a model
  // reads back.
  it("names the tool in the refusal", () => {
    expect(said("grep", {})).toBe("grep wants a `path` string")
  })

  // An optional argument written in another shape is nothing rather than a
  // refusal: the tool asked for it and can go on without it.
  it("drops an optional argument written in another shape", () => {
    const found = TAKES.of("read", { path: "one.md", command: ["ls"], count: "many" })
    expect(found.kind).toBe("read")
    expect(found.kind === "read" && found.args.count).toBeUndefined()
  })

  // The first argument the tool wanted is the one it names, so a model fixes
  // them in the order they are declared.
  it("names the first argument it wanted, and only that one", () => {
    expect(said("read", { count: 1 })).toBe("read wants a `path` string")
  })
})
