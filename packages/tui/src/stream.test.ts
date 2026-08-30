import { EventEmitter } from "node:events"
import { EMPTY, type Frame, type KeyPress } from "@missingstudio/eva-tui-core"
import { describe, expect, it } from "vitest"
import {
  BRACKETED_OFF,
  BRACKETED_ON,
  CLEAR,
  HOME,
  makeStreamRenderer,
  type Terminal,
} from "./stream.js"

const fake = (isTTY = false) => {
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
  return { terminal, input, written }
}

/**
 * A bracketed paste as readline reports it: the two markers it names, and
 * the characters between them delivered as ordinary presses.
 */
const paste = (input: EventEmitter, text: string) => {
  input.emit("keypress", "", { name: "paste-start", sequence: "[200~" })
  for (const character of text) {
    const name = character === "\n" ? "enter" : character === " " ? "space" : character
    input.emit("keypress", character, { name, sequence: character })
  }
  input.emit("keypress", "", { name: "paste-end", sequence: "[201~" })
}

const frame = (over: Partial<Frame> = {}): Frame => ({
  ...EMPTY,
  banner: { version: "0.0.0", model: "model", branch: "main", directory: "~/eva" },
  status: { model: "model", tokens: "10 in / 4 out", cost: "cost unreported", mode: "ready" },
  ...over,
})

describe("the stream renderer", () => {
  it("draws the transcript, the status, and the typed line on a screen", () => {
    const { terminal, written } = fake(true)
    makeStreamRenderer(terminal).draw(
      frame({
        session: [
          {
            author: "agent",
            blocks: [{ type: "content", block: 0, content: { type: "text", text: "hello" } }],
          },
        ],
        input: "half typed",
      }),
    )

    const out = written.join("")
    expect(out).toContain("hello")
    // The spend the record does not carry draws no figure, and the mode is
    // absent because this record holds none.
    expect(out).toContain("ready · 10 in / 4 out · — · model")
    expect(out).toContain("› half typed")
  })

  // A screen gets the chrome the rich renderer draws, so the two agree on
  // what a Frame is worth.
  it("draws the banner on a screen", () => {
    const { terminal, written } = fake(true)
    makeStreamRenderer(terminal).draw(frame())

    const out = written.join("")
    expect(out).toContain("version")
    expect(out).toContain("0.0.0")
    expect(out).toContain("~/eva")
  })

  it("draws the live area while a Run is open", () => {
    const { terminal, written } = fake(true)
    makeStreamRenderer(terminal).draw(frame({ live: "streaming" }))
    expect(written.join("")).toContain("streaming")
  })

  it("delivers a key press, and stops on unsubscribe", () => {
    const { terminal, input } = fake()
    const renderer = makeStreamRenderer(terminal)
    const seen: KeyPress[] = []
    const stop = renderer.onKey((key) => void seen.push(key))

    ;(input as unknown as EventEmitter).emit("keypress", "c", { name: "c", ctrl: true })
    stop()
    ;(input as unknown as EventEmitter).emit("keypress", "d", { name: "d" })

    expect(seen).toEqual([{ key: "c", ctrl: true, shift: false, meta: false, glyph: false }])
  })

  // A piped run reaches the end of its input. The surface must be told, or
  // it waits for a key that can never arrive — and it is told in the
  // renderer's own word, never as a key the keymap could reassign.
  it("says the input ended, and stops on unsubscribe", () => {
    const { terminal, input } = fake()
    const renderer = makeStreamRenderer(terminal)
    let ended = 0
    const stop = renderer.onEnd(() => void (ended += 1))

    ;(input as unknown as EventEmitter).emit("end")
    stop()
    ;(input as unknown as EventEmitter).emit("end")

    expect(ended).toBe(1)
  })

  /**
   * A paste is the terminal's own word, and readline reports the markers a
   * bracketed paste is wrapped in. What is between them is text: it never
   * becomes a key, so no rebinding decides what a pasted character means.
   */
  it("delivers a bracketed paste whole, and as no key at all", () => {
    const { terminal, input } = fake(true)
    const renderer = makeStreamRenderer(terminal)
    const seen: KeyPress[] = []
    const blocks: string[] = []
    renderer.onKey((key) => void seen.push(key))
    renderer.onPaste((text) => void blocks.push(text))

    paste(input as unknown as EventEmitter, "one\ntwo")

    expect(blocks).toEqual(["one\ntwo"])
    expect(seen).toEqual([])
  })

  // The newline that used to submit the first line of a pasted block.
  it("never reads a newline inside a paste as a key", () => {
    const { terminal, input } = fake(true)
    const renderer = makeStreamRenderer(terminal)
    const seen: string[] = []
    renderer.onKey((key) => void seen.push(key.key))

    paste(input as unknown as EventEmitter, "a\nb")

    expect(seen).not.toContain("enter")
  })

  it("asks the terminal for bracketed paste, and gives it back on stop", () => {
    const { terminal, written } = fake(true)
    const renderer = makeStreamRenderer(terminal)
    expect(written.join("")).toContain(BRACKETED_ON)

    renderer.stop()
    expect(written.join("")).toContain(BRACKETED_OFF)
  })

  it("says nothing about a paste after unsubscribe", () => {
    const { terminal, input } = fake(true)
    const renderer = makeStreamRenderer(terminal)
    const blocks: string[] = []
    const stop = renderer.onPaste((text) => void blocks.push(text))

    stop()
    paste(input as unknown as EventEmitter, "dropped")

    expect(blocks).toEqual([])
  })

  it("never reads the end of input as a key press", () => {
    const { terminal, input } = fake()
    const seen: KeyPress[] = []
    makeStreamRenderer(terminal).onKey((key) => void seen.push(key))

    ;(input as unknown as EventEmitter).emit("end")

    expect(seen).toEqual([])
  })
})

// A pipe cannot move its cursor back, so the renderer appends there. It
// used to repaint the whole frame, which wrote it again on every keystroke.
describe("drawing to a pipe", () => {
  const piped = () => {
    const made = fake()
    return { ...made, renderer: makeStreamRenderer(made.terminal) }
  }

  const said = (author: "human" | "agent", text: string) => ({
    author,
    blocks: [{ type: "content" as const, block: 0, content: { type: "text" as const, text } }],
  })

  const message = (text: string) => said("agent", text)
  const human = (text: string) => said("human", text)

  it("writes nothing when only the typed line changed", () => {
    const { renderer, written } = piped()
    renderer.draw(frame({ input: "h" }))
    renderer.draw(frame({ input: "he" }))
    renderer.draw(frame({ input: "hel" }))
    expect(written.join("")).toBe("")
  })

  it("writes streamed text once, as it arrives", () => {
    const { renderer, written } = piped()
    renderer.draw(frame({ live: "one" }))
    renderer.draw(frame({ live: "one two" }))
    expect(written.join("")).toBe("one two")
  })

  it("does not print the answer again when the fold replaces the stream", () => {
    const { renderer, written } = piped()
    renderer.draw(frame({ live: "an answer" }))
    renderer.draw(frame({ session: [message("an answer")] }))
    expect(written.join("")).toBe("an answer\n")
  })

  // A note is the surface speaking rather than the record, and a captured
  // run still carries it: `/help` answers a person, whatever they piped it
  // through.
  it("writes a line the surface said", () => {
    const { renderer, written } = piped()
    renderer.draw(frame({ notes: ["/help output"] }))
    expect(written.join("")).toBe("/help output\n")
  })

  it("never writes a note twice", () => {
    const { renderer, written } = piped()
    renderer.draw(frame({ notes: ["one"] }))
    renderer.draw(frame({ notes: ["one", "two"] }))
    expect(written.join("")).toBe("one\ntwo\n")
  })

  /**
   * The notes and the conversation are counted apart. A fold that grows the
   * conversation must not write a note again, and notes cleared when the
   * conversation moved on must not swallow the ones that follow.
   */
  it("keeps its count of notes and of the conversation apart", () => {
    const { renderer, written } = piped()
    renderer.draw(frame({ notes: ["a notice"] }))
    renderer.draw(frame({ session: [message("an answer")], notes: [] }))
    renderer.draw(frame({ session: [message("an answer")], notes: ["said after"] }))
    expect(written.join("")).toBe("a notice\nan answer\nsaid after\n")
  })

  it("never repeats a line it already wrote", () => {
    const { renderer, written } = piped()
    renderer.draw(frame({ session: [message("first")] }))
    renderer.draw(frame({ session: [message("first"), message("second")] }))
    expect(written.join("")).toBe("first\nsecond\n")
  })

  // A pipe carries the conversation, not the chrome: the banner and the
  // status are a screen's, and captured output stays the record's own lines.
  it("never writes the banner or the status", () => {
    const { renderer, written } = piped()
    renderer.draw(frame({ session: [message("hello")] }))
    const out = written.join("")
    expect(out).not.toContain("version")
    expect(out).not.toContain("ready")
  })

  // What the Run took is part of the conversation, so a captured log says it.
  // This is the fold that arrives with no stream before it; the test below
  // drives the sequence a Run really produces.
  it("writes what the Run took when the fold carries it", () => {
    const { renderer, written } = piped()
    renderer.draw(frame({ session: [message("answer")], took: "took 1.2s" }))
    expect(written.join("")).toBe("answer\ntook 1.2s\n")
  })

  /**
   * The sequence a Run really produces: the prompt lands in the fold, the
   * answer streams, and the fold replaces the stream. The stream printed the
   * turn, so the fold does not print it again — but what the Run took stands
   * after that turn and was never written.
   */
  it("writes what the Run took after the stream it followed", () => {
    const { renderer, written } = piped()
    const asked = frame({ session: [human("hello")] })
    renderer.draw(asked)
    renderer.draw({ ...asked, live: "an " })
    renderer.draw({ ...asked, live: "an answer" })
    renderer.draw({ ...asked, live: "an answer", took: "took 1.2s" })
    renderer.draw(frame({ session: [human("hello"), message("an answer")], took: "took 1.2s" }))

    expect(written.join("")).toBe("hello\nan answer\ntook 1.2s\n")
  })

  // A count that only grows swallows a fold that got shorter. Both lists go
  // back when they start again.
  it("writes a shorter conversation that follows a longer one", () => {
    const { renderer, written } = piped()
    renderer.draw(frame({ session: [human("one"), message("two")] }))
    renderer.draw(frame({ session: [human("elsewhere")] }))

    expect(written.join("")).toBe("one\ntwo\nelsewhere\n")
  })
})

describe("drawing to a screen", () => {
  // The cursor can go back, so a screen is written whole rather than
  // appended to.
  it("repaints the whole frame, because the cursor can go back", () => {
    const made = fake(true)
    const renderer = makeStreamRenderer(made.terminal)
    renderer.draw(frame({ input: "a" }))
    renderer.draw(frame({ input: "ab" }))

    const repaints = made.written.filter((one) => one.startsWith(HOME))
    expect(repaints).toHaveLength(2)
    expect(repaints[1]).toContain("› ab")
  })

  /**
   * It writes over what is there rather than erasing the screen first. A
   * screen blanked between two frames is the flicker a person sees on every
   * streamed word, and a Run writes a frame per word.
   */
  it("never erases the screen before it writes", () => {
    const made = fake(true)
    makeStreamRenderer(made.terminal).draw(frame({ input: "a" }))
    expect(made.written.join("")).not.toContain(CLEAR)
  })

  // Every event is drawn and most change nothing a person sees.
  it("writes nothing when the frame would say what the screen already says", () => {
    const made = fake(true)
    const renderer = makeStreamRenderer(made.terminal)
    renderer.draw(frame({ input: "a" }))
    const after = made.written.length
    renderer.draw(frame({ input: "a" }))

    expect(made.written).toHaveLength(after)
  })
})
