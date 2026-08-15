import { describe, expect, it } from "vitest"
import { declare, fitsShape, readShape, stringOption, type Shape } from "./options.js"

// Every shape there is, so a shape added without a case here is a gap a test
// names rather than one a run finds.
const SHAPES: readonly Shape[] = ["string", "number", "boolean", "list", "mapping", "name"]

// A spread of values a person may actually write in YAML.
const WRITTEN: readonly unknown[] = [
  "mono",
  "",
  42,
  0,
  -3,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  true,
  false,
  null,
  undefined,
  {},
  { id: "mono" },
  { name: "mono" },
  ["a"],
  [],
]

describe("readShape", () => {
  it.each([
    ["string", "mono", "mono"],
    // An empty string is a value a person may mean.
    ["string", "", ""],
    ["string", 42, undefined],
    ["number", 8, 8],
    ["number", 0, 0],
    ["number", -3, -3],
    // A limit of NaN or Infinity would pass every comparison it is used in.
    ["number", Number.NaN, undefined],
    ["number", Number.POSITIVE_INFINITY, undefined],
    // A numeric string is not parsed: a fallback beats a coercion.
    ["number", "8", undefined],
    ["boolean", true, true],
    ["boolean", false, false],
    ["boolean", "true", undefined],
    ["list", ["a"], ["a"]],
    ["list", "a", undefined],
    ["mapping", { a: 1 }, { a: 1 }],
    ["mapping", ["a"], undefined],
    // A name is written either way, and both spell the same thing.
    ["name", "mono", "mono"],
    ["name", { id: "mono" }, "mono"],
    ["name", { name: "mono" }, undefined],
    ["name", { id: 7 }, undefined],
  ] as const)("reads %s written as %o", (shape, value, expected) => {
    expect(readShape(value, shape)).toEqual(expected)
  })
})

/**
 * The invariant the two used to hold only by convention, in two
 * implementations that had to agree. `fitsShape` is the reader answering, so
 * a value the sweep passes is a value the plugin that declared that shape can
 * read — for every shape, not for `name` alone, which was as far as the old
 * pair could be checked.
 */
describe("the sweep and the reader are one answer", () => {
  it.each(SHAPES)("passes exactly what a %s reads", (shape) => {
    for (const value of WRITTEN) {
      expect(fitsShape(value, shape)).toBe(readShape(value, shape) !== undefined)
    }
  })
})

/**
 * A key used to be spelled twice — beside the plugin's id, and again at the
 * reader — with nothing holding the two together. Read through the
 * declaration, an undeclared name does not compile and the shape decides what
 * comes back.
 */
describe("declare", () => {
  const KEYS = declare({ theme: "name", maxTokens: "number", quiet: "boolean" })

  it("carries the shapes, to put beside the plugin's id", () => {
    expect(KEYS.shapes).toEqual({ theme: "name", maxTokens: "number", quiet: "boolean" })
  })

  it("reads a key in the shape it was declared as", () => {
    expect(KEYS.read({ theme: "mono" }, "theme", "default")).toBe("mono")
    expect(KEYS.read({ theme: { id: "mono" } }, "theme", "default")).toBe("mono")
    expect(KEYS.read({ maxTokens: 8 }, "maxTokens", 0)).toBe(8)
    expect(KEYS.read({ quiet: false }, "quiet", true)).toBe(false)
  })

  it("falls back when the key is absent", () => {
    expect(KEYS.read({}, "theme", "default")).toBe("default")
    expect(KEYS.read({}, "maxTokens", 0)).toBe(0)
  })

  it("falls back when the key is written in another shape", () => {
    expect(KEYS.read({ maxTokens: "8" }, "maxTokens", 0)).toBe(0)
    expect(KEYS.read({ theme: 12 }, "theme", "default")).toBe("default")
  })

  /**
   * What the sweep reports and what the plugin then reads agree, because both
   * are this reader. A key the sweep passes is read; a key it names as
   * misshapen falls back, which is the Finding the person is shown.
   */
  it("reads exactly the keys the sweep passes", () => {
    for (const value of WRITTEN) {
      const fits = fitsShape(value, KEYS.shapes.theme)
      expect(KEYS.read({ theme: value }, "theme", "default") !== "default" || !fits).toBe(true)
    }
  })
})

// The escape hatch, for a key whose name is known when it runs rather than
// when it is written: `eva.auth` reads `<provider>.auth`.
describe("stringOption", () => {
  it("reads a string and falls back for anything else", () => {
    expect(stringOption({ "anthropic.auth": "oauth" }, "anthropic.auth", "api_key")).toBe("oauth")
    expect(stringOption({ "anthropic.auth": 12 }, "anthropic.auth", "api_key")).toBe("api_key")
    expect(stringOption({}, "anthropic.auth", "api_key")).toBe("api_key")
  })
})
