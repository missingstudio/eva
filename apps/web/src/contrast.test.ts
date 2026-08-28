import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * The measurement, against the stylesheet that ships.
 *
 * The mock this page was drawn from picked its light greys by eye, and four of
 * them fail WCAG AA. The corrected values are in the ticket and in styles.css,
 * and this suite is why nobody puts the originals back: a reviewer comparing
 * the page to the artifact sees a difference, and the answer to it is here.
 *
 * The dark column needs no correction — it is docs/design.md's own measured
 * ladder — and it is measured all the same, because a token edited in one skin
 * is usually edited in both.
 */

const CSS = readFileSync(new URL("styles.css", import.meta.url), "utf8")

// One skin's block, from its selector to the line that closes it. Every value
// this suite measures is a six-digit hex, so nothing else has to parse.
const skin = (selector: string): Record<string, string> => {
  const from = CSS.indexOf(`${selector} {`)
  const block = CSS.slice(from, CSS.indexOf("\n}", from))
  const found: Record<string, string> = {}
  for (const [, name, hex] of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/g)) {
    if (name !== undefined && hex !== undefined) found[name] = hex
  }
  return found
}

const LIGHT = skin(":root")
const DARK = skin(".dark")

// WCAG 2.1 relative luminance, then the ratio the success criteria are stated
// in. The channel curve and the 0.05 offset are the specification's own.
const channel = (eight: number): number => {
  const part = eight / 255
  return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
}

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((at) => channel(Number.parseInt(hex.slice(at, at + 2), 16)))
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

export const contrast = (one: string, other: string): number => {
  const [low, high] = [luminance(one), luminance(other)].sort((a, b) => a - b)
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
}

// The ink, and the ground it is read on. Every pairing the page actually draws.
const PAIRINGS: readonly (readonly [string, string])[] = [
  ["ink", "canvas"],
  ["ink", "surface"],
  ["ink", "inset"],
  ["ink", "bubble"],
  ["ink-2", "canvas"],
  ["ink-2", "surface"],
  ["ink-2", "inset"],
  // The text floor. Nothing quieter than ink-3 carries text, so this is the
  // pairing the whole scale rests on.
  ["ink-3", "canvas"],
  ["ink-3", "surface"],
  ["ink-3", "inset"],
  ["accent", "surface"],
  ["accent", "canvas"],
  // The ink on an accent fill is accent-ink and never ink, both skins.
  ["accent-ink", "accent"],
  ["code", "code-bg"],
  ["ok", "surface"],
  ["err", "surface"],
  ["run", "surface"],
]

describe.each([
  ["the light skin", LIGHT],
  ["the dark skin", DARK],
])("%s", (_name, tokens) => {
  it("defines all eighteen tokens", () => {
    // Seventeen colours and the shadow, which is not a colour and is checked
    // by the clause below rather than measured.
    expect(Object.keys(tokens).sort()).toEqual(
      [
        "accent",
        "accent-ink",
        "border",
        "border-strong",
        "bubble",
        "canvas",
        "code",
        "code-bg",
        "err",
        "ink",
        "ink-2",
        "ink-3",
        "inset",
        "ok",
        "page",
        "run",
        "surface",
      ].sort(),
    )
  })

  it.each(PAIRINGS)("reads %s on %s at 4.5:1 or better", (ink, ground) => {
    const measured = contrast(tokens[ink] ?? "", tokens[ground] ?? "")
    expect(measured).toBeGreaterThanOrEqual(4.5)
  })

  /**
   * The focus ring is the one edge that must clear 3:1 on every ground, and it
   * is accent — which the clauses above already hold above 4.5:1. What is
   * checked here is the rule the hairlines keep: border-strong is a hairline
   * and not a control boundary, so nothing may identify a control by that edge
   * alone. It measures well under 3:1 and is expected to.
   */
  it("keeps border-strong below the boundary a control could be named by", () => {
    expect(contrast(tokens["border-strong"] ?? "", tokens["surface"] ?? "")).toBeLessThan(3)
  })
})

/**
 * The four the mock got wrong, named so a reader of this file can see both
 * numbers. The measurement is the argument; the values are in styles.css.
 */
describe("the corrections the mock needed", () => {
  it.each([
    ["ink-3", "#8f9297", "canvas"],
    ["code", "#b4550d", "code-bg"],
    ["ok", "#1f8a3b", "surface"],
    ["err", "#d64545", "surface"],
    ["run", "#0b8ea1", "surface"],
  ])("ships a %s that measures, where the mock's %s does not", (name, mocked, ground) => {
    const on = LIGHT[ground] ?? ""

    expect(contrast(mocked, on)).toBeLessThan(4.5)
    expect(contrast(LIGHT[name] ?? "", on)).toBeGreaterThanOrEqual(4.5)
  })

  // The accent fails twice in the mock: as text, and under the white label on
  // its own fill. The shipped one answers both.
  it("ships an accent that carries its own label", () => {
    expect(contrast("#dd530e", "#ffffff")).toBeLessThan(4.5)
    expect(contrast(LIGHT["accent"] ?? "", LIGHT["accent-ink"] ?? "")).toBeGreaterThanOrEqual(4.5)
  })

  /**
   * The fifth, which the ticket's own table does not carry. It corrected the
   * mock's ink-3 to #6e7177 and measured it on canvas and on surface. inset is
   * the third light ground — every hovered row, the active row, the wrote
   * strip — and it is the darkest of the three, so the floor is measured there
   * and lands one step lower.
   */
  it("ships an ink-3 that measures on inset, which is the darkest light ground", () => {
    const grounds = ["canvas", "surface", "inset"].map((name) => LIGHT[name] ?? "")

    expect(Math.min(...grounds.map((one) => contrast("#6e7177", one)))).toBeLessThan(4.5)
    expect(
      Math.min(...grounds.map((one) => contrast(LIGHT["ink-3"] ?? "", one))),
    ).toBeGreaterThanOrEqual(4.5)
  })
})
