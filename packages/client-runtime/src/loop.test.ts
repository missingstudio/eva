import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  idle,
  stepped,
  waitingText,
  walk,
  type Doing,
  type Handled,
  type LoopAction,
  type LoopState,
  type LoopStep,
  type Walked,
} from "./loop.js"

// Every step, in order, and where the loop ended up.
const folded = (
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

const steered = (line: string): LoopStep => ({ kind: "line", line, asking: false, steer: true })

const opened = (line: string): LoopStep => ({ kind: "handled", line, ran: false, moved: false })

const commanded = (line: string, moved = false): LoopStep => ({
  kind: "handled",
  line,
  ran: true,
  moved,
})

// A loop with one Run open on this line, and the number that names it.
const running = (line = "ask"): LoopState => folded(idle, typed(line), opened(line)).state

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
    const after = folded(running(), typed("second"), typed("third"))
    expect(after.actions).toEqual([])
    expect(after.state.pending).toEqual(["second", "third"])
  })

  it("steers rather than dispatches when the person steered it", () => {
    const after = folded(idle, steered("go left"))
    expect(after.actions).toEqual([{ kind: "steer", line: "go left" }])
    expect(after.state).toEqual(idle)
  })

  it("steers the open Run rather than waiting behind it", () => {
    const open = running("first")
    const after = folded(open, steered("go left"))
    // A steer opens no Run, so it takes no number and moves no queue.
    expect(after.actions).toEqual([{ kind: "steer", line: "go left" }])
    expect(after.state).toEqual(open)
  })

  it("answers the open question first, however the line was sent", () => {
    const asked: LoopStep = { kind: "line", line: "yes", asking: true, steer: true }
    expect(stepped(idle, asked).actions).toEqual([{ kind: "answer", line: "yes" }])
  })
})

describe("what a line turned out to mean", () => {
  it("opens a Run when no command answered it", () => {
    const after = folded(idle, typed("ask"), opened("ask"))
    expect(after.actions).toEqual([
      { kind: "handle", line: "ask" },
      { kind: "open", run: 1, line: "ask" },
    ])
    expect(after.state.open).toBe(1)
  })

  it("opens nothing when a command answered it", () => {
    const after = folded(idle, typed("/help"), commanded("/help"))
    expect(after.actions).toEqual([{ kind: "handle", line: "/help" }])
    expect(after.state.open).toBeUndefined()
  })

  it("follows a command that opened another Session", () => {
    const after = folded(idle, typed("/clear"), commanded("/clear", true))
    expect(after.actions.at(-1)).toEqual({ kind: "refresh" })
  })

  it("never gives two Runs of one Console the same number", () => {
    const first = folded(idle, typed("one"), opened("one"))
    const second = folded(first.state, { kind: "settled", run: 1 }, typed("two"), opened("two"))
    expect(second.state.open).toBe(2)
    expect(second.state.runs).toBe(2)
  })
})

describe("a Run that stopped", () => {
  it("is read for how it ended, and the queue moves on", () => {
    const queued = folded(running("first"), typed("second"))
    const after = folded(queued.state, { kind: "settled", run: 1 })

    expect(after.actions).toEqual([
      { kind: "settle", run: 1 },
      { kind: "handle", line: "second" },
    ])
    expect(after.state.open).toBeUndefined()
    expect(after.state.pending).toEqual([])
  })

  it("takes the waiting lines oldest first, one per close", () => {
    const queued = folded(running("first"), typed("second"), typed("third"))
    const one = folded(queued.state, { kind: "settled", run: 1 })
    expect(one.actions).toContainEqual({ kind: "handle", line: "second" })
    expect(one.state.pending).toEqual(["third"])
  })

  it("does nothing when it is not the Run the loop is holding", () => {
    // The race the numbers exist for: a Run that ended while a cancel was
    // landing must not close the Run that followed it.
    const cancelled = folded(running("first"), { kind: "cancel" })
    const opened = folded(cancelled.state, typed("second"), {
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
    const queued = folded(running("first"), typed("second"), typed("third"))
    const after = folded(queued.state, { kind: "cancel" })

    // The order is the order: stop the Run before saying it was cancelled.
    expect(after.actions).toEqual([{ kind: "interrupt", run: 1 }, { kind: "cancelled" }])
    expect(after.state.open).toBeUndefined()
    expect(after.state.pending).toEqual([])
  })

  it("still tells Eva when no Run is open, because a question may be", () => {
    expect(stepped(idle, { kind: "cancel" }).actions).toEqual([{ kind: "cancelled" }])
  })

  it("leaves the next line free to open a Run", () => {
    const after = folded(running("first"), { kind: "cancel" }, typed("second"))
    expect(after.actions.at(-1)).toEqual({ kind: "handle", line: "second" })
  })
})

describe("quitting", () => {
  it("stops the open Run first, then leaves", () => {
    expect(folded(running(), { kind: "quit" }).actions).toEqual([
      { kind: "interrupt", run: 1 },
      { kind: "stop" },
    ])
  })

  it("leaves at once when nothing is open", () => {
    expect(stepped(idle, { kind: "quit" }).actions).toEqual([{ kind: "stop" }])
  })
})

// The queue's words live beside the queue, so every door says them the same
// way.
describe("what the queue says", () => {
  it("says nothing while nothing waits", () => {
    expect(waitingText(0)).toBeUndefined()
  })

  it("says how many lines wait", () => {
    expect(waitingText(1)).toBe("1 waiting")
    expect(waitingText(2)).toBe("2 waiting")
  })
})

/**
 * The walk, with a doing that only records. The fold above decides; what is
 * proved here is that the walk carries every answer out in order, and that
 * what dispatching found out walks on through the same fold — so no door has
 * an ordering rule of its own to get wrong.
 */

// What the walk asked for, in the order it asked. `handled` is what
// dispatching each line turns out to mean here.
const recorded = (handled: (line: string) => Handled = () => ({ ran: false, moved: false })) => {
  const said: string[] = []
  const doing: Doing = {
    answer: (line) => Effect.sync(() => void said.push(`answer ${line}`)),
    handle: (line) =>
      Effect.sync(() => {
        said.push(`handle ${line}`)
        return handled(line)
      }),
    open: (run, line) => Effect.sync(() => void said.push(`open ${run} ${line}`)),
    steer: (line) => Effect.sync(() => void said.push(`steer ${line}`)),
    refresh: () => Effect.sync(() => void said.push("refresh")),
    interrupt: (run) => Effect.sync(() => void said.push(`interrupt ${run}`)),
    settle: (run) => Effect.sync(() => void said.push(`settle ${run}`)),
    cancelled: () => Effect.sync(() => void said.push("cancelled")),
  }
  const one = (state: LoopState, step: LoopStep): Walked => Effect.runSync(walk(state, step, doing))
  return { one, said }
}

describe("the walk", () => {
  it("dispatches a line and opens the Run it turned out to mean", () => {
    const { one, said } = recorded()
    const after = one(idle, typed("change it"))

    expect(said).toEqual(["handle change it", "open 1 change it"])
    expect(after.state.open).toBe(1)
    expect(after.stopped).toBe(false)
  })

  it("opens no Run for a line a command answered", () => {
    const { one, said } = recorded(() => ({ ran: true, moved: false }))
    const after = one(idle, typed("/mode read-only"))

    expect(said).toEqual(["handle /mode read-only"])
    expect(after.state.open).toBeUndefined()
    expect(after.state.runs).toBe(0)
  })

  it("refreshes behind a command that moved the Session", () => {
    const { one, said } = recorded(() => ({ ran: true, moved: true }))
    one(idle, typed("/clear"))

    expect(said).toEqual(["handle /clear", "refresh"])
  })

  // The order is the fold's order, carried out whole: read how the Run
  // ended, then dispatch the line that waited, then open what it meant.
  it("settles the closed Run before the line that waited moves", () => {
    const { one, said } = recorded()
    const opened = one(idle, typed("first"))
    const queued = one(opened.state, typed("second"))
    const after = one(queued.state, { kind: "settled", run: 1 })

    expect(said).toEqual([
      "handle first",
      "open 1 first",
      "settle 1",
      "handle second",
      "open 2 second",
    ])
    expect(after.state.open).toBe(2)
  })

  it("answers the question that stands instead of dispatching", () => {
    const { one, said } = recorded()
    one(idle, { kind: "line", line: "Allow once", asking: true })

    expect(said).toEqual(["answer Allow once"])
  })

  it("steers the open Run rather than queueing behind it", () => {
    const { one, said } = recorded()
    const opened = one(idle, typed("first"))
    const after = one(opened.state, { kind: "line", line: "go left", asking: false, steer: true })

    expect(said).toEqual(["handle first", "open 1 first", "steer go left"])
    expect(after.state.open).toBe(1)
  })

  it("stops the Run on a cancel before telling Eva, and drops the queue", () => {
    const { one, said } = recorded()
    const opened = one(idle, typed("first"))
    const queued = one(opened.state, typed("second"))
    const after = one(queued.state, { kind: "cancel" })

    expect(said.slice(2)).toEqual(["interrupt 1", "cancelled"])
    expect(after.state.pending).toEqual([])
    // And the cancelled Run's late answer starts nothing.
    const late = one(after.state, { kind: "settled", run: 1 })
    expect(late.state.open).toBeUndefined()
    expect(said).toHaveLength(4)
  })

  it("says the loop was asked to leave, after stopping what was open", () => {
    const { one, said } = recorded()
    const opened = one(idle, typed("first"))
    const after = one(opened.state, { kind: "quit" })

    expect(said.slice(2)).toEqual(["interrupt 1"])
    expect(after.stopped).toBe(true)
  })
})
