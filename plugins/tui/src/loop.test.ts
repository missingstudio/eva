import { describe, expect, it } from "vitest"
import { idle, stepped, type LoopAction, type LoopState, type LoopStep } from "./loop.js"

// Every step, in order, and where the loop ended up.
const walk = (
  state: LoopState,
  ...steps: readonly LoopStep[]
): { readonly state: LoopState; readonly actions: readonly LoopAction[] } =>
  steps.reduce<{ state: LoopState; actions: readonly LoopAction[] }>(
    (over, step) => {
      const next = stepped(over.state, step)
      return { state: next.state, actions: [...over.actions, ...next.actions] }
    },
    { state, actions: [] },
  )

const typed = (line: string): LoopStep => ({ kind: "line", line, asking: false })

const opened = (line: string): LoopStep => ({ kind: "handled", line, ran: false, moved: false })

const commanded = (line: string, moved = false): LoopStep => ({
  kind: "handled",
  line,
  ran: true,
  moved,
})

// A loop with one Run open on this line, and the number that names it.
const running = (line = "ask"): LoopState => walk(idle, typed(line), opened(line)).state

describe("a line", () => {
  it("is dispatched when nothing is open", () => {
    expect(stepped(idle, typed("hello")).actions).toEqual([{ kind: "handle", line: "hello" }])
  })

  it("answers the open question rather than meaning anything else", () => {
    const asked: LoopStep = { kind: "line", line: "yes", asking: true }
    expect(stepped(idle, asked).actions).toEqual([{ kind: "answer", line: "yes" }])
    // Even with a Run open: a question outranks the queue.
    expect(stepped(running(), asked).actions).toEqual([{ kind: "answer", line: "yes" }])
  })

  it("waits its turn while a Run is open, rather than racing it", () => {
    const after = walk(running(), typed("second"), typed("third"))
    expect(after.actions).toEqual([])
    expect(after.state.pending).toEqual(["second", "third"])
  })
})

describe("what a line turned out to mean", () => {
  it("opens a Run when no command answered it", () => {
    const after = walk(idle, typed("ask"), opened("ask"))
    expect(after.actions).toEqual([
      { kind: "handle", line: "ask" },
      { kind: "open", run: 1, line: "ask" },
    ])
    expect(after.state.open).toBe(1)
  })

  it("opens nothing when a command answered it", () => {
    const after = walk(idle, typed("/help"), commanded("/help"))
    expect(after.actions).toEqual([{ kind: "handle", line: "/help" }])
    expect(after.state.open).toBeUndefined()
  })

  it("follows a command that opened another Session", () => {
    const after = walk(idle, typed("/clear"), commanded("/clear", true))
    expect(after.actions.at(-1)).toEqual({ kind: "refresh" })
  })

  it("never gives two Runs of one Console the same number", () => {
    const first = walk(idle, typed("one"), opened("one"))
    const second = walk(first.state, { kind: "settled", run: 1 }, typed("two"), opened("two"))
    expect(second.state.open).toBe(2)
    expect(second.state.runs).toBe(2)
  })
})

describe("a Run that stopped", () => {
  it("is read for how it ended, and the queue moves on", () => {
    const queued = walk(running("first"), typed("second"))
    const after = walk(queued.state, { kind: "settled", run: 1 })

    expect(after.actions).toEqual([
      { kind: "settle", run: 1 },
      { kind: "handle", line: "second" },
    ])
    expect(after.state.open).toBeUndefined()
    expect(after.state.pending).toEqual([])
  })

  it("takes the waiting lines oldest first, one per close", () => {
    const queued = walk(running("first"), typed("second"), typed("third"))
    const one = walk(queued.state, { kind: "settled", run: 1 })
    expect(one.actions).toContainEqual({ kind: "handle", line: "second" })
    expect(one.state.pending).toEqual(["third"])
  })

  it("does nothing when it is not the Run the loop is holding", () => {
    // The race the numbers exist for: a Run that ended while a cancel was
    // landing must not close the Run that followed it.
    const cancelled = walk(running("first"), { kind: "cancel" })
    const opened = walk(cancelled.state, typed("second"), {
      kind: "handled",
      line: "second",
      ran: false,
      moved: false,
    })
    const stale = stepped(opened.state, { kind: "settled", run: 1 })

    expect(stale.actions).toEqual([])
    expect(stale.state.open).toBe(2)
  })

  it("closes nothing when the loop is holding no Run at all", () => {
    expect(stepped(idle, { kind: "settled", run: 1 }).actions).toEqual([])
  })
})

describe("a cancel", () => {
  it("stops the open Run, drops what was waiting, and tells Eva", () => {
    const queued = walk(running("first"), typed("second"), typed("third"))
    const after = walk(queued.state, { kind: "cancel" })

    // The order is the order: stop the Run before saying it was cancelled.
    expect(after.actions).toEqual([{ kind: "interrupt", run: 1 }, { kind: "cancelled" }])
    expect(after.state.open).toBeUndefined()
    expect(after.state.pending).toEqual([])
  })

  it("still tells Eva when no Run is open, because a question may be", () => {
    expect(stepped(idle, { kind: "cancel" }).actions).toEqual([{ kind: "cancelled" }])
  })

  it("leaves the next line free to open a Run", () => {
    const after = walk(running("first"), { kind: "cancel" }, typed("second"))
    expect(after.actions.at(-1)).toEqual({ kind: "handle", line: "second" })
  })
})

describe("quitting", () => {
  it("stops the open Run first, then leaves", () => {
    expect(walk(running(), { kind: "quit" }).actions).toEqual([
      { kind: "interrupt", run: 1 },
      { kind: "stop" },
    ])
  })

  it("leaves at once when nothing is open", () => {
    expect(stepped(idle, { kind: "quit" }).actions).toEqual([{ kind: "stop" }])
  })
})
