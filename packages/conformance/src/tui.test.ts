import { BINDINGS } from "@missingstudio/eva-keymap"
import { THEMES } from "@missingstudio/eva-themes"
import { DEFAULT_PALETTE, paletteFrom } from "@missingstudio/eva-tui"
import { canonical, makeKeymap, themeColors, type KeyPress } from "@missingstudio/eva-tui-core"
import { edit } from "@missingstudio/eva-tui-surface"
import { describe, expect, it } from "vitest"

/**
 * The joins no plugin may test for itself: the shipped bindings against the
 * surface that acts on them, and the shipped default theme against the
 * palette the renderer falls back to. A plugin may not import a plugin, so
 * the place these meet is here.
 */

// A canonical binding names its own press: the last part is the key, the
// rest are the modifiers it holds. A one-character key with no modifier is
// what a person types, which is what the normalizer would say of it.
const pressOf = (binding: string): KeyPress => {
  const parts = binding.split("+")
  const key = parts[parts.length - 1] ?? ""
  const held = parts.slice(0, -1)
  return {
    key,
    ctrl: held.includes("ctrl"),
    meta: held.includes("meta"),
    shift: held.includes("shift"),
    glyph: held.length === 0 && Array.from(key).length === 1,
  }
}

// The keymap as the surface builds it, from the rows the plugin ships.
const shipped = makeKeymap(new Map(BINDINGS.map((row) => [row.binding, row.command])))

// A line with something on it and the caret at its end, which is where a
// person who just typed it would be.
const GO = { buffer: "go", cursor: 2 }

describe("the shipped bindings against the surface", () => {
  it.each(BINDINGS)("$binding resolves to $command", (row) => {
    expect(shipped.lookup(pressOf(row.binding))).toBe(row.command)
  })

  // Registered-but-inert reads as working until a person presses it: a
  // shipped binding the line editor swallows as plain typing is a defect.
  it.each(BINDINGS)("$binding is acted on, never swallowed", (row) => {
    const action = edit(GO, pressOf(row.binding), shipped)
    const swallowed = action.kind === "editing" && action.line.buffer === GO.buffer
    expect(swallowed).toBe(false)
  })

  it("cancels, quits, submits, and breaks the line", () => {
    expect(edit(GO, pressOf("ctrl+c"), shipped)).toEqual({ kind: "cancel" })
    expect(edit(GO, pressOf("ctrl+d"), shipped)).toEqual({ kind: "quit" })
    expect(edit(GO, pressOf("enter"), shipped)).toEqual({ kind: "submit", line: "go" })
    expect(edit(GO, pressOf("shift+enter"), shipped)).toEqual({
      kind: "editing",
      line: { buffer: "go\n", cursor: 3 },
    })
  })

  // The keymap alone decides what a key means: rebind `session.submit` and
  // plain enter is released with it. It used to submit regardless, so the
  // new binding was honoured and the old key was never let go.
  it("releases plain enter when submit is bound elsewhere", () => {
    const rebound = makeKeymap(new Map([["ctrl+enter", "session.submit"]]))
    expect(edit(GO, pressOf("enter"), rebound)).toEqual({ kind: "editing", line: GO })
    expect(edit(GO, pressOf("ctrl+enter"), rebound)).toEqual({ kind: "submit", line: "go" })
  })
})

describe("the shipped themes against the renderer", () => {
  it.each(THEMES)("$id passes the contract's gate", (theme) => {
    expect(themeColors(theme.colors)).toBeDefined()
  })

  // The unthemed and the default-themed screens agree: the palette a
  // renderer falls back to is the palette the default theme produces.
  it("maps the default theme exactly onto DEFAULT_PALETTE", () => {
    const colors = themeColors(THEMES.find((one) => one.id === "default")?.colors ?? {})
    expect(colors).toBeDefined()
    if (colors !== undefined) expect(paletteFrom(colors)).toEqual(DEFAULT_PALETTE)
  })

  // `canonical` and the shipped rows never drift: a default that is not
  // already in its one spelling reads as a different key than it fires as.
  it("ships every binding in its canonical spelling", () => {
    for (const row of BINDINGS) expect(canonical(row.binding)).toBe(row.binding)
  })
})
