import { EventEmitter } from "node:events"
import { EMPTY, type Frame, type Overlay, type Renderer } from "@missingstudio/eva-tui-core"
import { describe, expect, it } from "vitest"
import { makeStreamRenderer, type Terminal } from "./stream.js"

/**
 * The three rules every Renderer holds to, whatever it draws on: `stop` is
 * safe to repeat, it releases every subscription the renderer took, and a
 * `draw` after it does nothing. A surface is started and stopped and
 * started again — the surface Domain holds factories, not instances — so a
 * renderer that keeps a listener past its own `stop` delivers keys to a
 * surface that has gone.
 *
 * The suite is written once and run against each adapter this runtime can
 * build. OpenTUI needs Bun's FFI and a real screen, so it is not one of
 * them here; the packed binary starts it in CI instead.
 */
const contract = (
  name: string,
  make: () => { readonly renderer: Renderer; readonly input: EventEmitter },
) => {
  describe(`the Renderer contract: ${name}`, () => {
    it("is safe to stop twice", () => {
      const { renderer } = make()
      renderer.stop()
      expect(() => renderer.stop()).not.toThrow()
    })

    it("delivers no key after it has stopped", () => {
      const { renderer, input } = make()
      const seen: string[] = []
      renderer.onKey((key) => void seen.push(key.key))

      input.emit("keypress", "a", { name: "a", sequence: "a" })
      renderer.stop()
      input.emit("keypress", "b", { name: "b", sequence: "b" })

      expect(seen).toEqual(["a"])
    })

    // A paste is a subscription like any other, so `stop` releases it too.
    it("delivers no paste after it has stopped", () => {
      const { renderer, input } = make()
      const blocks: string[] = []
      renderer.onPaste((text) => void blocks.push(text))

      renderer.stop()
      input.emit("keypress", "", { name: "paste-start", sequence: "[200~" })
      input.emit("keypress", "a", { name: "a", sequence: "a" })
      input.emit("keypress", "", { name: "paste-end", sequence: "[201~" })

      expect(blocks).toEqual([])
    })

    it("unsubscribes the paste it handed back", () => {
      const { renderer } = make()
      const blocks: string[] = []
      const stop = renderer.onPaste((text) => void blocks.push(text))

      expect(() => stop()).not.toThrow()
      expect(blocks).toEqual([])
    })

    it("says nothing about the input ending after it has stopped", () => {
      const { renderer, input } = make()
      let ended = 0
      renderer.onEnd(() => void (ended += 1))

      renderer.stop()
      input.emit("end")

      expect(ended).toBe(0)
    })

    it("draws nothing after it has stopped", () => {
      const { renderer } = make()
      renderer.stop()
      expect(() => renderer.draw(EMPTY)).not.toThrow()
    })

    // A surface asks this before it offers a capability that rests on it, so
    // a renderer that answered nothing would be offered everything.
    it("says what it draws", () => {
      const { renderer } = make()
      expect(typeof renderer.draws.panels).toBe("boolean")
      expect(typeof renderer.draws.colors).toBe("boolean")
    })

    it("unsubscribes what it handed back", () => {
      const { renderer, input } = make()
      const seen: string[] = []
      const stop = renderer.onKey((key) => void seen.push(key.key))

      stop()
      input.emit("keypress", "a", { name: "a", sequence: "a" })
      renderer.stop()

      expect(seen).toEqual([])
    })
  })
}

const terminalOf = (isTTY: boolean) => {
  const written: string[] = []
  const input = new EventEmitter() as unknown as NodeJS.ReadStream
  const terminal: Terminal = {
    out: {
      write: (text: string) => {
        written.push(text)
        return true
      },
      columns: 100,
      rows: 40,
      isTTY,
    } as unknown as Terminal["out"],
    in: input,
  }
  return { terminal, input: input as unknown as EventEmitter, written }
}

// A screen and a pipe are two adapters in one module: they take the same
// input and write to it in opposite ways, so both answer for themselves.
contract("the stream renderer on a screen", () => {
  const made = terminalOf(true)
  return { renderer: makeStreamRenderer(made.terminal), input: made.input }
})

contract("the stream renderer on a pipe", () => {
  const made = terminalOf(false)
  return { renderer: makeStreamRenderer(made.terminal), input: made.input }
})

// A stopped renderer has handed the terminal back, so anything it wrote
// after that would print over whatever holds it now.
describe("a stopped renderer and the terminal", () => {
  it("writes nothing on a draw after stop", () => {
    const made = terminalOf(true)
    const renderer = makeStreamRenderer(made.terminal)
    renderer.stop()
    made.written.length = 0
    renderer.draw(EMPTY)
    expect(made.written).toEqual([])
  })
})

const OVERLAY: Overlay = {
  title: "commands",
  source: "query",
  query: "mo",
  rows: [
    { id: "model", label: "/model", detail: "Show or set the session model" },
    { id: "commands", label: "/commands", detail: "Open the palette" },
  ],
  selected: 1,
  hint: "↑↓ move · enter run · esc close",
}

const drawnBy = (isTTY: boolean, frame: Frame): string => {
  const made = terminalOf(isTTY)
  const renderer = makeStreamRenderer(made.terminal)
  renderer.draw(frame)
  renderer.stop()
  return made.written.join("")
}

/**
 * The panel is chrome, and chrome is what tells the two renderers apart. A
 * screen draws it; a pipe never does, and what a panel decided reaches a
 * pipe as the note the surface echoed instead.
 */
describe("a Frame with a panel open", () => {
  it("presents every row on a screen, and marks the selected one", () => {
    const out = drawnBy(true, { ...EMPTY, overlay: OVERLAY })

    for (const row of OVERLAY.rows) expect(out).toContain(row.label)
    expect(out).toContain("commands")
    // The marker stands against the selected row and nowhere else.
    expect(out).toContain("▸ /commands")
    expect(out).not.toContain("▸ /model")
  })

  it("draws nothing of it on a pipe", () => {
    const out = drawnBy(false, { ...EMPTY, overlay: OVERLAY })

    expect(out).not.toContain("/model")
    expect(out).not.toContain("commands")
  })

  // And it says so before it is asked to: a surface reads this to decide
  // whether to offer a choice at all, because a choice a pipe cannot draw
  // is a choice nobody can answer.
  it("says a pipe draws no panel, and a screen does", () => {
    expect(makeStreamRenderer(terminalOf(false).terminal).draws.panels).toBe(false)
    expect(makeStreamRenderer(terminalOf(true).terminal).draws.panels).toBe(true)
  })

  // The sentence the fold/pipe separation rests on: a pipe run writes the
  // same bytes for a Frame with a panel as for the same Frame without one.
  it("writes the same bytes on a pipe as a Frame with no panel", () => {
    const said = { ...EMPTY, notes: ["a note"], live: "streaming" }
    expect(drawnBy(false, { ...said, overlay: OVERLAY })).toBe(drawnBy(false, said))
  })
})

/**
 * The caret is a number on the Frame, and a renderer draws it where it is
 * told. A line printer has no cursor to move, so it says the same bytes
 * wherever the caret is — an honest degrade, and one worth holding: a
 * stream renderer that drew the caret would print the line twice.
 */
describe("a Frame with the caret inside the line", () => {
  const line = { ...EMPTY, input: "half typed" }

  it("says the same bytes on a pipe wherever the caret is", () => {
    expect(drawnBy(false, { ...line, cursor: 4 })).toBe(drawnBy(false, { ...line, cursor: 10 }))
  })

  it("says the same bytes on a screen wherever the caret is", () => {
    expect(drawnBy(true, { ...line, cursor: 4 })).toBe(drawnBy(true, { ...line, cursor: 10 }))
  })
})
