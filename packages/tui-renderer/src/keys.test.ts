import { describe, expect, it } from "vitest"
import { toKeyPress } from "./keys.js"

describe("toKeyPress", () => {
  it.each([
    [
      { name: "c", ctrl: true },
      "c",
      { key: "c", ctrl: true, shift: false, meta: false, glyph: false },
    ],
    [undefined, "x", { key: "x", ctrl: false, shift: false, meta: false, glyph: true }],
    [
      { name: "return" },
      "",
      { key: "return", ctrl: false, shift: false, meta: false, glyph: false },
    ],
    [{ sequence: "ö" }, "", { key: "ö", ctrl: false, shift: false, meta: false, glyph: true }],
  ])("reads %o as %o", (raw, value, expected) => {
    expect(toKeyPress(raw, value)).toEqual(expected)
  })

  /**
   * Which presses carry a character is decided here, so nothing downstream
   * asks a string for its length: an astral character is two UTF-16 units
   * and one typed character, and the two answers differ.
   */
  it.each([
    [{ name: "a", sequence: "a" }, true],
    [{ sequence: "👋" }, true],
    [{ name: "space", sequence: " " }, false],
    [{ name: "backspace", sequence: "" }, false],
    [{ name: "up" }, false],
    [{ name: "c", ctrl: true, sequence: "" }, false],
    [{ name: "k", meta: true, sequence: "k" }, false],
  ])("says whether %o carries a character: %s", (raw, expected) => {
    expect(toKeyPress(raw).glyph).toBe(expected)
  })

  // readline names a letter in lowercase whatever was typed; the typed glyph
  // is the sequence. "A" must land in the buffer as "A".
  it("keeps the case of a shifted letter", () => {
    expect(toKeyPress({ name: "a", shift: true, sequence: "A" })).toEqual({
      key: "A",
      ctrl: false,
      shift: true,
      meta: false,
      glyph: true,
    })
  })

  it("keeps the case of a letter typed under caps lock", () => {
    expect(toKeyPress({ name: "a", sequence: "A" })).toEqual({
      key: "A",
      ctrl: false,
      shift: false,
      meta: false,
      glyph: true,
    })
  })

  // A chord names its key: the control byte in the sequence never wins.
  it("names a chord by its key, not its control byte", () => {
    expect(toKeyPress({ name: "c", ctrl: true, sequence: "\u0003" })).toEqual({
      key: "c",
      ctrl: true,
      shift: false,
      meta: false,
      glyph: false,
    })
  })

  // An astral character is one typed character, whatever its length in
  // units. It arrives whole, and the press says it is a character.
  it("carries an astral character as one glyph", () => {
    expect(toKeyPress({ sequence: "👋" })).toEqual({
      key: "👋",
      ctrl: false,
      shift: false,
      meta: false,
      glyph: true,
    })
  })

  // Named keys carry sequences too — a space, a delete — and keep the name
  // the line editor acts on.
  it.each([
    [{ name: "space", sequence: " " }, "space"],
    [{ name: "backspace", sequence: "\u007f" }, "backspace"],
    [{ name: "tab", sequence: "\t" }, "tab"],
  ])("keeps the name for %o", (raw, expected) => {
    expect(toKeyPress(raw).key).toBe(expected)
  })
})
