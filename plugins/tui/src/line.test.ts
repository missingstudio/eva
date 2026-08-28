import { makeKeymap, type KeyPress } from "@missingstudio/eva-tui-core"
import { describe, expect, it } from "vitest"
import { BLANK, edit, pasted, type LineState } from "./line.js"

// The bindings the keymap plugin ships, as the surface would build them.
const keymap = makeKeymap(
  new Map([
    ["enter", "session.submit"],
    ["shift+enter", "input.newline"],
    ["ctrl+c", "session.cancel"],
    ["ctrl+d", "app.quit"],
    ["ctrl+s", "session.steer"],
  ]),
)

// A press as the normalizer would hand it over: one character with no chord
// modifier carries a glyph, and everything else names a key.
const press = (over: Partial<KeyPress> = {}): KeyPress => {
  const key = over.key ?? "a"
  return {
    key,
    ctrl: false,
    shift: false,
    meta: false,
    glyph: Array.from(key).length === 1 && over.ctrl !== true && over.meta !== true,
    ...over,
  }
}

// What the line became. Anything that is not an edit is a mistake in the
// test rather than a shape to carry through it.
const after = (line: LineState, key: KeyPress, recalling = false): LineState => {
  const action = edit(line, key, keymap, recalling)
  if (action.kind !== "editing") throw new Error(`expected an edit, got ${action.kind}`)
  return action.line
}

const type = (text: string, from: LineState = BLANK): LineState => {
  let line = from
  for (const character of text) {
    line = after(line, press({ key: character === " " ? "space" : character }))
  }
  return line
}

describe("typing", () => {
  it("appends a printable key and carries the caret with it", () => {
    expect(type("hello there")).toEqual({ buffer: "hello there", cursor: 11 })
  })

  // The whole point of a caret: what is typed lands where it is, not at the
  // end of whatever was typed before.
  it("inserts at the caret rather than at the end", () => {
    const line = type("helo")
    const moved = after(after(line, press({ key: "left" })), press({ key: "left" }))
    expect(type("l", moved)).toEqual({ buffer: "hello", cursor: 3 })
  })

  it("removes the character behind the caret on backspace", () => {
    expect(after({ buffer: "abc", cursor: 3 }, press({ key: "backspace" }))).toEqual({
      buffer: "ab",
      cursor: 2,
    })
    expect(after({ buffer: "abc", cursor: 1 }, press({ key: "backspace" }))).toEqual({
      buffer: "bc",
      cursor: 0,
    })
  })

  it("removes the character under the caret on delete", () => {
    expect(after({ buffer: "abc", cursor: 1 }, press({ key: "delete" }))).toEqual({
      buffer: "ac",
      cursor: 1,
    })
  })

  // Nothing to remove is not an edit that removes something else.
  it("holds the line at either end", () => {
    expect(after({ buffer: "abc", cursor: 0 }, press({ key: "backspace" }))).toEqual({
      buffer: "abc",
      cursor: 0,
    })
    expect(after({ buffer: "abc", cursor: 3 }, press({ key: "delete" }))).toEqual({
      buffer: "abc",
      cursor: 3,
    })
  })

  /**
   * One astral character is one character to type, one to cross, and one to
   * remove. The press says it carries a glyph, so nothing here counts the
   * two units that spell it — which used to swallow it going in, and used to
   * leave half of it behind coming out.
   */
  it("takes an astral character whole, crosses it whole, and gives it back whole", () => {
    expect(type("👋")).toEqual({ buffer: "👋", cursor: 1 })
    expect(after({ buffer: "hi 👋", cursor: 4 }, press({ key: "backspace" }))).toEqual({
      buffer: "hi ",
      cursor: 3,
    })
    expect(after({ buffer: "👋 hi", cursor: 1 }, press({ key: "left" }))).toEqual({
      buffer: "👋 hi",
      cursor: 0,
    })
  })
})

describe("moving the caret", () => {
  it("goes left and right one character at a time", () => {
    const line = { buffer: "abc", cursor: 1 }
    expect(after(line, press({ key: "left" })).cursor).toBe(0)
    expect(after(line, press({ key: "right" })).cursor).toBe(2)
  })

  it("stops at both ends rather than wrapping", () => {
    expect(after({ buffer: "abc", cursor: 0 }, press({ key: "left" })).cursor).toBe(0)
    expect(after({ buffer: "abc", cursor: 3 }, press({ key: "right" })).cursor).toBe(3)
  })

  it("jumps to the ends of the row on home and end", () => {
    const line = { buffer: "one\ntwo", cursor: 5 }
    expect(after(line, press({ key: "home" })).cursor).toBe(4)
    expect(after(line, press({ key: "end" })).cursor).toBe(7)
  })

  // The two chords mean what the named keys mean, for hands that never
  // leave the home row.
  it("reads ctrl+a and ctrl+e as home and end", () => {
    const line = { buffer: "one\ntwo", cursor: 5 }
    expect(after(line, press({ key: "a", ctrl: true })).cursor).toBe(4)
    expect(after(line, press({ key: "e", ctrl: true })).cursor).toBe(7)
  })

  it("moves between rows on up and down, keeping the column where it can", () => {
    const line = { buffer: "hello\nhi", cursor: 4 }
    expect(after(line, press({ key: "down" })).cursor).toBe(8)
    // Back up from the end of the short row, to the same column above.
    expect(after({ buffer: "hello\nhi", cursor: 8 }, press({ key: "up" })).cursor).toBe(2)
  })
})

describe("the prompt history", () => {
  // Up on an empty line is a walk; the Console owns the history, so the
  // editor only says which way.
  it("walks back from an empty line", () => {
    expect(edit(BLANK, press({ key: "up" }), keymap)).toEqual({
      kind: "history",
      direction: "back",
    })
  })

  it("keeps walking while a recalled line is under the caret", () => {
    const line = { buffer: "an old prompt", cursor: 13 }
    expect(edit(line, press({ key: "up" }), keymap, true)).toEqual({
      kind: "history",
      direction: "back",
    })
    expect(edit(line, press({ key: "down" }), keymap, true)).toEqual({
      kind: "history",
      direction: "forward",
    })
  })

  // The text under the caret is the person's. Up must not overwrite a line
  // somebody is part way through writing.
  it("moves through the rows rather than the history while a line is being written", () => {
    expect(edit({ buffer: "half typed", cursor: 4 }, press({ key: "up" }), keymap).kind).toBe(
      "editing",
    )
  })

  it("does nothing going forward from an empty line", () => {
    expect(edit(BLANK, press({ key: "down" }), keymap)).toEqual({ kind: "editing", line: BLANK })
  })
})

describe("what the keymap decides", () => {
  it("submits the trimmed line on return", () => {
    expect(edit({ buffer: "  ask  ", cursor: 7 }, press({ key: "return" }), keymap)).toEqual({
      kind: "submit",
      line: "ask",
    })
  })

  // A stray return must not open a Run with nothing in it.
  it("holds the line rather than submitting an empty one", () => {
    const line = { buffer: "   ", cursor: 3 }
    expect(edit(line, press({ key: "enter" }), keymap)).toEqual({ kind: "editing", line })
  })

  /**
   * The gesture, and the plain key beside it. One line, two meanings: enter
   * queues it behind the open Run and ctrl+s steers with it, so the fold is
   * told which the person meant rather than guessing from what is open.
   */
  it("steers the trimmed line on ctrl+s", () => {
    expect(
      edit({ buffer: "  go left  ", cursor: 11 }, press({ key: "s", ctrl: true }), keymap),
    ).toEqual({ kind: "steer", line: "go left" })
  })

  // The same rule submit keeps: an empty line is not a line, so a stray
  // gesture steers with nothing.
  it("holds the line rather than steering with an empty one", () => {
    const line = { buffer: "   ", cursor: 3 }
    expect(edit(line, press({ key: "s", ctrl: true }), keymap)).toEqual({ kind: "editing", line })
  })

  it("adds a row on shift+enter, at the caret", () => {
    expect(after({ buffer: "ab", cursor: 1 }, press({ key: "enter", shift: true }))).toEqual({
      buffer: "a\nb",
      cursor: 2,
    })
  })

  it("cancels on ctrl+c and quits on ctrl+d", () => {
    expect(
      edit({ buffer: "half typed", cursor: 10 }, press({ key: "c", ctrl: true }), keymap).kind,
    ).toBe("cancel")
    expect(edit(BLANK, press({ key: "d", ctrl: true }), keymap).kind).toBe("quit")
  })

  it("leaves the line alone for a key it has no use for", () => {
    const line = { buffer: "kept", cursor: 2 }
    for (const key of ["f5", "pageup", "insert"]) {
      expect(edit(line, press({ key }), keymap)).toEqual({ kind: "editing", line })
    }
  })

  it("leaves the line alone for a modified key that is not bound", () => {
    const line = { buffer: "kept", cursor: 4 }
    expect(edit(line, press({ key: "k", meta: true }), keymap)).toEqual({ kind: "editing", line })
  })

  // The keymap alone decides what a chord means: an unbound return is not a
  // structural submit, so rebinding submit releases the old key with it.
  it("leaves the line alone when return is not bound", () => {
    const line = { buffer: "kept", cursor: 4 }
    expect(edit(line, press({ key: "return" }), makeKeymap(new Map()))).toEqual({
      kind: "editing",
      line,
    })
  })
})

/**
 * A pasted block is text and nothing else. The terminal is what told the
 * renderer this was a paste, so nothing here asks a string what it looks
 * like: a newline in it is a newline, not the key that submits a line.
 */
describe("a pasted block", () => {
  it("lands where the caret is", () => {
    expect(pasted({ buffer: "ac", cursor: 1 }, "b")).toEqual({ buffer: "abc", cursor: 2 })
  })

  it("lands whole into an empty line", () => {
    expect(pasted(BLANK, "a stack trace")).toEqual({ buffer: "a stack trace", cursor: 13 })
  })

  // The newline that would have submitted the first line of it.
  it("keeps the newlines it carries", () => {
    expect(pasted(BLANK, "one\ntwo")).toEqual({ buffer: "one\ntwo", cursor: 7 })
  })

  it("counts every line ending as the one this buffer holds", () => {
    expect(pasted(BLANK, "one\r\ntwo\rthree")).toEqual({
      buffer: "one\ntwo\nthree",
      cursor: 13,
    })
  })

  // Code points rather than units, the same as every other edit here.
  it("moves the caret one step for an astral character", () => {
    expect(pasted(BLANK, "🙂")).toEqual({ buffer: "🙂", cursor: 1 })
  })

  it("appends after a line that was already typed", () => {
    expect(pasted({ buffer: "ask ", cursor: 4 }, "this")).toEqual({
      buffer: "ask this",
      cursor: 8,
    })
  })

  // A caret past the end is a caret at the end, the same rule `edit` keeps.
  it("holds the caret inside the line it was given", () => {
    expect(pasted({ buffer: "ab", cursor: 99 }, "c")).toEqual({ buffer: "abc", cursor: 3 })
  })
})
