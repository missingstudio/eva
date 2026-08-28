import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Composer, refusalOf, type Composing } from "./composer.js"
import type { Pipe } from "./session.js"

const READY: Pipe = { at: "ready", dropped: false }
const DOWN: Pipe = { at: "disconnected", dropped: true }

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
 * The rules a line is read by — what queues, what steers, what a command
 * means, what a cancel drops — are the composer fold's, and its walk performs
 * them; both are proved in `client-runtime` beside the fold. What is proved
 * here is the drawing: what this page says about the state the walk left.
 */
describe("what the composer says", () => {
  // The words are the composer fold's — every door says a queue the same way
  // — so what is proved here is only that this page draws them.
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
   * record. So the composer that dispatched the line is where it is drawn:
   * whole, in the lines the command chose, because a listing whose line
   * breaks closed up is a listing nobody can read.
   */
  it("draws what the command it dispatched wrote", () => {
    const listed = drawn({ wrote: "mode: read-only\n  default\n  read-only" })
    expect(listed).toContain("mode: read-only")
    expect(listed).toContain("  default\n  read-only")
  })

  /**
   * Not on the program's dark panel. That surface is the live tail's — a Run
   * talking while it runs — and a command's answer is neither a Run nor live,
   * so drawing it there would say a Run had said it.
   */
  it("draws it as a strip over the field, and not on the live tail's panel", () => {
    const strip = drawn({ wrote: "mode: read-only" })
    expect(strip).toContain('class="wrote"')
    expect(strip).not.toContain("panel-terminal")
  })

  // Nothing has been run yet, so there is nothing to say it wrote. A command
  // that ran and wrote nothing says nothing either.
  it("says nothing before a line has run, and nothing for a line that wrote none", () => {
    expect(drawn({})).not.toContain('class="wrote"')
    expect(drawn({ wrote: "" })).not.toContain('class="wrote"')
  })
})

/**
 * The pill beside the field says which mode the Session runs under. It is
 * display-only: switching modes is a typed `/mode` line, and a pill that
 * looked like a picker would be a control that reaches nothing.
 */
describe("the mode the record named", () => {
  it("says the mode the record last named", () => {
    expect(
      renderToStaticMarkup(<Composer composer={composing()} mode="read-only" pipe={READY} />),
    ).toContain("read-only")
  })

  /**
   * And is not drawn at all when the record has never named one. A default
   * would be the page guessing a posture it cannot read, which is the whole
   * thing this surface exists not to do.
   */
  it("draws no pill at all when the record holds no mode", () => {
    const drawn = renderToStaticMarkup(<Composer composer={composing()} pipe={READY} />)

    expect(drawn).not.toContain("ctl")
    expect(drawn).not.toContain("supervised")
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
