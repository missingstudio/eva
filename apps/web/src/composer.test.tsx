import { idle, type LoopState } from "@missingstudio/eva-client-runtime"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Composer, refusalOf, waitingText } from "./composer.js"
import { walk, type Composing, type Doing } from "./composing.js"
import type { Pipe } from "./session.js"

const READY: Pipe = { at: "ready", dropped: false }
const DOWN: Pipe = { at: "disconnected", dropped: true }

// What the page was asked to do, in the order it was asked. The Run a line
// opened is left open: a real one closes when `submit` answers.
const doing = () => {
  const said: string[] = []
  const opened: number[] = []
  const one: Doing = {
    open: (run, line) => {
      opened.push(run)
      said.push(`open ${run} ${line}`)
    },
    steer: (line) => said.push(`steer ${line}`),
    cancel: () => said.push("cancel"),
    answer: (line) => said.push(`answer ${line}`),
    run: (line) => said.push(`run ${line}`),
  }
  return { doing: one, said, opened }
}

const composing = (over: Partial<Composing> = {}): Composing => ({
  pending: [],
  open: false,
  send: () => undefined,
  steer: () => undefined,
  stop: () => undefined,
  ...over,
})

const drawn = (over: Partial<Composing> | undefined, pipe: Pipe = READY, running = false) =>
  renderToStaticMarkup(
    <Composer
      pipe={pipe}
      running={running}
      {...(over === undefined ? {} : { composer: composing(over) })}
    />,
  )

/**
 * The rules are `client-runtime`'s and are proved there. What is proved here
 * is what this page does with each of the answers that fold gives back — the
 * page holds no fiber and no command registry, so several of them are nothing
 * and the ones that are not are the whole of what a page can do.
 */
describe("what the page does with a line", () => {
  it("opens a Run on a line typed with nothing open", () => {
    const { doing: one, said } = doing()
    const after = walk(idle, { kind: "line", line: "change it", asking: false }, one)

    expect(said).toEqual(["open 1 change it"])
    expect(after.open).toBe(1)
    expect(after.pending).toEqual([])
  })

  /**
   * A line typed during a Run waits behind it and reaches Eva at all. Two
   * Prompts racing one Session is not what a person who typed twice asked
   * for, and a line dropped for being early is worse.
   */
  it("queues a line typed during a Run, and sends nothing", () => {
    const { doing: one, said } = doing()
    const open = walk(idle, { kind: "line", line: "change it", asking: false }, one)
    const after = walk(open, { kind: "line", line: "and rename it", asking: false }, one)

    expect(after.pending).toEqual(["and rename it"])
    expect(said).toEqual(["open 1 change it"])
  })

  // And it goes the moment the Run it waited on has closed. `submit` answers
  // when the Run closed, so that answer is what settles it here.
  it("sends the line that waited once the Run has closed", () => {
    const { doing: one, said } = doing()
    const open = walk(idle, { kind: "line", line: "change it", asking: false }, one)
    const queued = walk(open, { kind: "line", line: "and rename it", asking: false }, one)
    const after = walk(queued, { kind: "settled", run: 1 }, one)

    expect(said).toEqual(["open 1 change it", "open 2 and rename it"])
    expect(after.pending).toEqual([])
    expect(after.open).toBe(2)
  })

  /**
   * Stop means stop. The lines waiting behind the Run go with it, because a
   * person who stopped what is happening did not ask for the next thing to
   * start.
   */
  it("drops the queue on a cancel, and tells Eva", () => {
    const { doing: one, said } = doing()
    const open = walk(idle, { kind: "line", line: "change it", asking: false }, one)
    const queued = walk(open, { kind: "line", line: "and rename it", asking: false }, one)
    const after = walk(queued, { kind: "cancel" }, one)

    expect(after.pending).toEqual([])
    expect(after.open).toBeUndefined()
    expect(said).toEqual(["open 1 change it", "cancel"])
  })

  /**
   * And the Run that was cancelled cannot start the line it dropped. The
   * `submit` of a cancelled Run still answers, and the number it names is not
   * the one the loop is holding any more.
   */
  it("opens nothing when the cancelled Run finally answers", () => {
    const { doing: one, said } = doing()
    const open = walk(idle, { kind: "line", line: "change it", asking: false }, one)
    const stopped = walk(open, { kind: "cancel" }, one)
    const after = walk(stopped, { kind: "settled", run: 1 }, one)

    expect(said).toEqual(["open 1 change it", "cancel"])
    expect(after.open).toBeUndefined()
  })

  /**
   * The gesture, on the page. A plain line queues behind the open Run — the
   * test above — and a steered one rides it, opening no Run and moving no
   * queue. What the steer then does to a tool group is the harness's rule,
   * proven where the harness runs; what is proven here is that the control
   * reaches it.
   */
  it("steers the open Run rather than queueing behind it", () => {
    const { doing: one, said } = doing()
    const open = walk(idle, { kind: "line", line: "change it", asking: false }, one)
    const after = walk(open, { kind: "line", line: "go left", asking: false, steer: true }, one)

    expect(said).toEqual(["open 1 change it", "steer go left"])
    expect(after.pending).toEqual([])
    expect(after.open).toBe(1)
  })

  // A question outranks everything else a line could mean, open Run or not.
  it("answers the question that stands instead of opening a Run", () => {
    const { doing: one, said } = doing()
    const after = walk(idle, { kind: "line", line: "Allow once", asking: true }, one)

    expect(said).toEqual(["answer Allow once"])
    expect(after.open).toBeUndefined()
  })

  /**
   * One line, one meaning, at either door. A line that names a command runs
   * where the Domains are and opens no Run — the terminal at the end of a
   * socket decides the same way, off the same rule — and a line that names
   * none is the Prompt the tests above open a Run for.
   */
  it("runs a line that names a command, and opens no Run for it", () => {
    const { doing: one, said } = doing()
    const after = walk(idle, { kind: "line", line: "/mode read-only", asking: false }, one)

    expect(said).toEqual(["run /mode read-only"])
    expect(after.open).toBeUndefined()
    expect(after.runs).toBe(0)
  })

  // And it waits its turn like any other line, because a `/undo` that ran
  // during the Run it was meant to reverse would reverse the wrong write.
  it("queues a command typed during a Run, and runs it once the Run has closed", () => {
    const { doing: one, said } = doing()
    const open = walk(idle, { kind: "line", line: "change it", asking: false }, one)
    const queued = walk(open, { kind: "line", line: "/undo", asking: false }, one)
    const after = walk(queued, { kind: "settled", run: 1 }, one)

    expect(said).toEqual(["open 1 change it", "run /undo"])
    expect(after.open).toBeUndefined()
    expect(after.pending).toEqual([])
  })

  // A question outranks a command too: what a person types at one is that
  // question's answer, whatever it starts with.
  it("answers the question that stands with a line that names a command", () => {
    const { doing: one, said } = doing()
    const after = walk(idle, { kind: "line", line: "/mode", asking: true }, one)

    expect(said).toEqual(["answer /mode"])
    expect(after.open).toBeUndefined()
  })

  // A Run this page never opened settles nothing it is holding.
  it("closes nothing on a Run it is not holding", () => {
    const { doing: one, said } = doing()
    const after: LoopState = walk(idle, { kind: "settled", run: 9 }, one)

    expect(said).toEqual([])
    expect(after).toEqual(idle)
  })
})

describe("what the composer says", () => {
  it("says nothing about a queue that is empty", () => {
    expect(waitingText([])).toBeUndefined()
  })

  it("says how many lines wait", () => {
    expect(waitingText(["one"])).toBe("1 waiting")
    expect(waitingText(["one", "two"])).toBe("2 waiting")
  })

  it("draws the queue where the person who typed it is looking", () => {
    expect(drawn({ pending: ["and rename it"], open: true })).toContain("1 waiting")
  })

  // A stop for something that is running, and nothing to press while nothing
  // is. A stop that is always drawn is a control that means nothing.
  it("offers a stop only while a Run is open", () => {
    expect(drawn({})).not.toContain("Stop")
    expect(drawn({ open: true })).toContain("Stop")
  })

  // And a steer for the same reason: steering rides a Run, so it is offered
  // while one is going and not before.
  it("offers a steer only while a Run is open", () => {
    expect(drawn({})).not.toContain("Steer")
    expect(drawn({ open: true })).toContain("Steer")
  })

  /**
   * Including a Run this page did not open. The stream says a Run is going
   * whichever door started it, and the person watching it is who wants it
   * stopped.
   */
  it("offers a stop for a Run another door opened", () => {
    expect(drawn({}, READY, true)).toContain("Stop")
  })

  /**
   * What a command wrote is the whole of its answer, and it arrives nowhere
   * else — a command is the one write on this page whose outcome is not on the
   * record. So the composer that dispatched the line is where it is drawn.
   */
  it("draws what the command it dispatched wrote", () => {
    expect(drawn({ wrote: "mode: read-only" })).toContain("mode: read-only")
    expect(drawn({})).not.toContain("panel-terminal")
  })
})

/**
 * A send that spooled behind a dead pipe would reach Eva eventually and say
 * nothing meanwhile, which reads as a Run that started. So the refusal is
 * drawn and the send is off.
 */
describe("a send during a drop", () => {
  it("says nothing while the pipe is up", () => {
    expect(refusalOf(READY)).toBeUndefined()
  })

  it("says why nothing can go out while the pipe is down", () => {
    expect(refusalOf(DOWN)).toContain("the pipe is down")
  })

  it("refuses the send visibly rather than taking the line", () => {
    const off = drawn({}, DOWN)

    expect(off).toContain("The line waits here")
    expect(off).toContain('data-disabled=""')
    expect(off).toContain("disabled")
  })

  // And a composer drawn with nowhere to send a line is off for the same
  // reason the permission card's options are.
  it("takes no line when it was drawn with nowhere to send one", () => {
    expect(drawn(undefined)).toContain('data-disabled=""')
    expect(drawn({})).not.toContain('data-disabled=""')
  })
})
