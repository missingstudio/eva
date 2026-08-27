import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

// The test lives with a consumer rather than in `packages/ui`, because that
// package claims no ambient types on purpose: its tokens are data for two
// browser bundles, and giving it Node types to run one test would hand Node
// globals to a browser program. Both sites import these tokens, so either
// could host this; the documentation site does.
const ui = fileURLToPath(new URL("../../../../packages/ui/", import.meta.url))
const tokens = readFileSync(`${ui}src/styles/tokens.css`, "utf8")
const motion = readFileSync(`${ui}src/styles/motion.css`, "utf8")
const typography = readFileSync(`${ui}src/styles/typography.css`, "utf8")
const surfaces = readFileSync(`${ui}src/styles/surfaces.css`, "utf8")

describe("the two typefaces", () => {
  // A font from someone else's origin costs the privacy claim and the
  // largest-contentful-paint measurement at once. Both faces are files in
  // the ui package, and this test is what keeps them there.
  test("no font is loaded from a third-party origin", () => {
    const urls = [...tokens.matchAll(/url\(["']?([^"')]+)/g)].map((match) => match[1]!)

    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) {
      expect(url.startsWith("../../fonts/"), `${url} is not a local file`).toBe(true)
    }
  })

  // A `url()` is not the only way to reach a CDN. An `@import` of someone
  // else's stylesheet costs the same privacy claim, and the check above never
  // sees it.
  test("no stylesheet is imported from a third-party origin", () => {
    for (const css of [tokens, typography, surfaces, motion]) {
      for (const match of css.matchAll(/@import\s+["']([^"']+)/g)) {
        expect(match[1]!.startsWith("./"), `${match[1]} is not a local import`).toBe(true)
      }
    }
  })

  test("every declared font file exists", () => {
    const files = new Set(readdirSync(`${ui}fonts`))

    for (const match of tokens.matchAll(/url\("\.\.\/\.\.\/fonts\/([^"]+)"\)/g)) {
      expect(files.has(match[1]!), `${match[1]} is declared but missing`).toBe(true)
    }
  })

  // Two faces of one family and no more. A third is a defect, not an option.
  test("exactly two families are declared", () => {
    const families = new Set(
      [...tokens.matchAll(/@font-face\s*\{[^}]*font-family:\s*"([^"]+)"/g)].map((m) => m[1]!),
    )

    expect([...families].sort()).toEqual(["Geist", "Geist Mono"])
  })

  // Prose is the sans and machine output is the mono. A monospaced face slows
  // continuous reading, so the two stacks must stay distinct — pointing them
  // at one face is what the previous revision got wrong.
  test("the sans and the mono are distinct stacks", () => {
    const mono = tokens.match(/--font-mono:\s*([^;]+);/)?.[1] ?? ""
    const sans = tokens.match(/--font-sans:\s*([^;]+);/)?.[1] ?? ""

    expect(mono).toContain("Geist Mono")
    expect(sans).toContain("Geist")
    expect(sans).not.toContain("Geist Mono")
  })

  test("code is the mono, with figures that line up", () => {
    const block = tokens.match(/\bcode,\s*\n\s*kbd,\s*\n\s*pre,\s*\n\s*samp\s*\{([^}]*)\}/)?.[1]

    expect(block, "pre/code do not set their own type").toBeDefined()
    // A fallback face may render — tabular figures keep a column of digits
    // lined up either way.
    expect(block).toContain("tabular-nums")
    expect(block).toContain("font-family: var(--font-mono)")
  })
})

describe("the motion contract", () => {
  // The reveal system must never hide content from a reader without
  // JavaScript — which includes most AI crawlers. Every hidden state is
  // therefore gated behind `.js`, a class only JavaScript can add.
  test("every hidden state is gated behind .js", () => {
    for (const block of motion.split("}")) {
      if (!/opacity:\s*0\b/.test(block)) continue
      expect(block.includes(".js "), `an ungated hidden state: ${block.trim().slice(0, 60)}`).toBe(
        true,
      )
    }
  })

  test("the reveal system respects prefers-reduced-motion", () => {
    expect(motion).toContain("prefers-reduced-motion")
  })

  // Every surface draws from the token table, not only the reveal system:
  // surfaces.css carries more transitions than motion.css does.
  test("no animation invents a duration or an easing", () => {
    const values = [...motion.matchAll(/(?:transition|animation)[^;]*;/g)].map((m) => m[0])
    const more = [...surfaces.matchAll(/(?:transition|animation)[^;]*;/g)].map((m) => m[0])
    values.push(...more)
    expect(more.length).toBeGreaterThan(0)

    for (const value of values) {
      if (/\d+m?s/.test(value)) {
        expect(
          /var\(--dur-|var\(--reveal-index/.test(value),
          `a literal duration: ${value.trim()}`,
        ).toBe(true)
      }
      if (/cubic-bezier|\bease(-in|-out)?\b/.test(value)) {
        expect(/var\(--ease-/.test(value), `a literal easing: ${value.trim()}`).toBe(true)
      }
    }
  })
})

describe("the display scale", () => {
  // Hierarchy is size and leading; tracking travels as one token for every
  // display step rather than per step, so a step that sets its own is off
  // the system.
  test("each display step sets its own size and leading", () => {
    // A step's rules may be split between the shared selector group and its
    // own block, so the assertion is on the union of everything that names it.
    const blocks = [...typography.matchAll(/([^{}]+)\{([^}]*)\}/g)]

    for (const step of ["d-hero", "d-1", "d-2", "d-3"]) {
      const named = new RegExp(`\\.${step}(?![\\w-])`)
      const declared = blocks
        .filter((block) => named.test(block[1]!))
        .map((block) => block[2])
        .join("\n")

      expect(declared, `${step} is missing`).not.toBe("")
      expect(declared, `${step} has no size`).toContain("font-size")
      expect(declared, `${step} has no leading`).toContain("line-height")
    }
  })

  test("no display step invents a literal tracking", () => {
    for (const css of [typography, surfaces]) {
      for (const value of css.matchAll(/letter-spacing:\s*([^;]+);/g)) {
        expect(value[1]!.trim(), `a literal tracking: ${value[0]}`).toMatch(
          /^(var\(--tracking-|normal$)/,
        )
      }
    }
  })

  // Tracking travels with the size: a step that changes size at a breakpoint
  // and keeps the tracking of the step it left is the defect this catches.
  test("every display step carries its own tracking beside its size", () => {
    const blocks = [...typography.matchAll(/([^{}]+)\{([^}]*)\}/g)]

    for (const block of blocks) {
      if (!/\.d-(hero|1|2|3)(?![\w-])/.test(block[1]!)) continue
      if (!block[2]!.includes("font-size")) continue
      expect(
        block[2]!.includes("letter-spacing"),
        `a size without its tracking: ${block[1]!.trim()}`,
      ).toBe(true)
    }
  })
})
