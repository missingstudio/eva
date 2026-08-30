// @vitest-environment happy-dom
import type { SessionAPI } from "@missingstudio/eva-core"
import { BINDINGS } from "@missingstudio/eva-keymap"
import type { SessionID } from "@missingstudio/eva-schema"
import type { CommandContext } from "@missingstudio/eva-sdk"
import { withPlugin } from "@missingstudio/eva-testkit"
import { themes, THEMES } from "@missingstudio/eva-themes"
import { DEFAULT_PALETTE, paletteFrom } from "@missingstudio/eva-tui-renderer"
import { canonical, makeKeymap, themeColors, type KeyPress } from "@missingstudio/eva-tui-core"
import { edit } from "@missingstudio/eva-tui"
import { themed, THEMES as DRAWN } from "@missingstudio/eva-web-app"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

/**
 * The joins no plugin may test for itself: the shipped bindings against the
 * surface that acts on them, the shipped default theme against the palette
 * the renderer falls back to, and the shipped rows against the ones the page
 * offers. A plugin may not import a plugin and a page may import neither, so
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

/**
 * What `/theme` wrote at the terminal, for one line, without the newline a
 * terminal needs and a page does not.
 *
 * The command is the theme plugin's and the rows it picks from are the theme
 * Domain's, so it is only itself once a kernel has built it. It is handed a
 * `paint` and no `pick`: that is the surface the page is — one that draws
 * colours and offers no panel to move a selection through — so both doors are
 * asked the same question.
 */
const wrote = (argument?: string): Promise<string> => {
  const said: string[] = []
  const ctx: CommandContext = {
    // Nothing here reaches a Session: a theme is not a fact of one.
    api: {} as SessionAPI,
    session: "sess_themes" as SessionID,
    write: (text) => void said.push(text),
    select: () => {},
    paint: () => {},
    ...(argument === undefined ? {} : { argument }),
  }

  return withPlugin(themes, (kernel) =>
    Effect.gen(function* () {
      const row = (yield* kernel.domains.command.get).find((one) => one.id === "theme")
      if (row?.run === undefined) throw new Error("this build cannot run /theme")
      yield* row.run(ctx)
    }),
  ).then(() => said.join("").trimEnd())
}

/**
 * And the same rows on the page. A theme is a Domain the terminal reads in
 * process, and the page cannot: the rows travel with the renderer contract,
 * which is not a package a browser bundle may pull. So the page says them
 * again, and this is what keeps the two lists one list — two doors offering
 * different themes under one name would be two products.
 */
describe("the shipped themes against the page", () => {
  it("offers the same rows, in the same order, with the same colours", () => {
    expect(DRAWN).toEqual(THEMES)
  })

  // And the sentences, which the rows do not carry. A person picks a theme by
  // reading one of three lines, and one list held to the other while the
  // three lines drifted would still be two products.
  it("lists the rows in the same words at both doors", async () => {
    expect(await wrote()).toBe(themed("/theme"))
  })

  it.each(THEMES)("reports $id applied in the same words at both doors", async (theme) => {
    expect(await wrote(theme.id)).toBe(themed(`/theme ${theme.id}`))
  })

  it("refuses a name that is not a theme in the same words at both doors", async () => {
    expect(await wrote("dusk")).toBe(themed("/theme dusk"))
  })
})
