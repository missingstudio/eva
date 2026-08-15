import { describe, expect, it } from "vitest"
import { canonical, conflicts, formatKey, makeKeymap, type Chord } from "./keys.js"

const press = (over: Partial<Chord> = {}): Chord => ({
  key: "c",
  ctrl: false,
  shift: false,
  meta: false,
  ...over,
})

describe("formatKey", () => {
  it.each([
    [press({ key: "enter" }), "enter"],
    [press({ key: "return" }), "enter"],
    [press({ key: "c", ctrl: true }), "ctrl+c"],
    [press({ key: "enter", shift: true }), "shift+enter"],
    [press({ key: "return", shift: true }), "shift+enter"],
    [press({ key: "k", ctrl: true, meta: true }), "ctrl+meta+k"],
    // A press carries the typed glyph; a chord names the key.
    [press({ key: "A", shift: true }), "shift+a"],
    // + joins a chord, so the key of that name is spelled as a word.
    [press({ key: "+" }), "plus"],
    [press({ key: "+", ctrl: true }), "ctrl+plus"],
  ])("names %o as %s", (key, expected) => {
    expect(formatKey(key)).toBe(expected)
  })
})

describe("canonical", () => {
  it.each([
    ["enter", "enter"],
    ["return", "enter"],
    ["ctrl+c", "ctrl+c"],
    ["shift+ctrl+k", "ctrl+shift+k"],
    // The + key is bound by its word, so the joiner is never ambiguous.
    ["ctrl+plus", "ctrl+plus"],
    ["Shift+Enter", "shift+enter"],
    ["META+SHIFT+CTRL+K", "ctrl+meta+shift+k"],
    [" ctrl+c ", "ctrl+c"],
  ])("spells %s as %s", (written, expected) => {
    expect(canonical(written)).toBe(expected)
  })

  it.each([
    ["", "nothing"],
    ["ctrl", "a bare modifier"],
    ["ctrl+", "a modifier with no key"],
    ["cmd+k", "a modifier nobody has"],
    ["ctrl+ctrl+c", "a modifier twice"],
  ])("answers nothing for %s (%s)", (written) => {
    expect(canonical(written)).toBeUndefined()
  })
})

describe("makeKeymap", () => {
  const keymap = makeKeymap(new Map([["ctrl+c", "session.cancel"]]))

  it("resolves a bound key to its command", () => {
    expect(keymap.lookup(press({ key: "c", ctrl: true }))).toBe("session.cancel")
  })

  it("resolves nothing for an unbound key", () => {
    expect(keymap.lookup(press({ key: "c" }))).toBeUndefined()
  })

  // The binding is held in its one spelling, so how config wrote it does not
  // decide whether the key it names can fire.
  it("resolves a binding written in another order or case", () => {
    const written = makeKeymap(new Map([["Shift+Ctrl+K", "command.run"]]))
    expect(written.lookup(press({ key: "k", ctrl: true, shift: true }))).toBe("command.run")
  })

  it("holds nothing for a string that is not a binding", () => {
    const written = makeKeymap(new Map([["cmd+k", "command.run"]]))
    expect(written.lookup(press({ key: "k", meta: true }))).toBeUndefined()
  })
})

describe("conflicts", () => {
  it("finds two bindings that share a key on one surface", () => {
    const found = conflicts([
      { id: "a", binding: "ctrl+c", command: "one", surface: "eva.tui" },
      { id: "b", binding: "ctrl+c", command: "two", surface: "eva.tui" },
    ])
    expect(found).toEqual([{ surface: "eva.tui", binding: "ctrl+c", ids: ["a", "b"] }])
  })

  // Only one surface has focus, so the same key elsewhere is not a conflict.
  it("allows the same key on two surfaces", () => {
    expect(
      conflicts([
        { id: "a", binding: "ctrl+c", command: "one", surface: "eva.tui" },
        { id: "b", binding: "ctrl+c", command: "two", surface: "eva.print" },
      ]),
    ).toEqual([])
  })

  // Two spellings of one key are one key bound twice.
  it("finds a conflict between two spellings of one binding", () => {
    const found = conflicts([
      { id: "a", binding: "ctrl+shift+k", command: "one", surface: "eva.tui" },
      { id: "b", binding: "Shift+Ctrl+K", command: "two", surface: "eva.tui" },
    ])
    expect(found).toEqual([{ surface: "eva.tui", binding: "ctrl+shift+k", ids: ["a", "b"] }])
  })

  // A row that names no key is reported as that and is not also a conflict,
  // so one mistake is said once rather than twice.
  it("passes over a binding that names no key", () => {
    expect(
      conflicts([
        { id: "a", binding: "cmd+k", command: "one", surface: "eva.tui" },
        { id: "b", binding: "cmd+k", command: "two", surface: "eva.tui" },
      ]),
    ).toEqual([])
  })
})
