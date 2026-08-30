import { describe, expect, it } from "vitest"
import { asked, holding, told, whileDrawn } from "./held.js"

/**
 * What one answer the page holds does, proved without a page.
 *
 * These are the rules five reads used to keep five ways and no test reached:
 * one answer told to every reader, one call in flight however many ask, a
 * channel opened once and never closed, and an answer dropped when nobody is
 * drawing it any more. Every one of them is a plain function here, so it is
 * proved the way `follow` and `watchAsking` already are.
 */

// A promise and the two calls that settle it, so a test decides when an
// answer arrives rather than waiting for one.
const pending = <A>() => {
  let settle: (now: A) => void = () => undefined
  const answer = new Promise<A>((wake) => {
    settle = wake
  })
  return { answer, settle }
}

// Lets every settled promise run its handlers before the next assertion.
const drain = (): Promise<void> => new Promise((wake) => setTimeout(wake, 0))

describe("an answer the page works out for itself", () => {
  it("tells every reader at once", () => {
    const one = holding("first")
    const seen: string[] = []
    const other: string[] = []

    one.reading((now) => void seen.push(now))
    one.reading((now) => void other.push(now))
    one.tell("second")

    expect(seen).toEqual(["second"])
    expect(other).toEqual(["second"])
    expect(one.now()).toBe("second")
  })

  it("says nothing to a reader that let go", () => {
    const one = holding("first")
    const seen: string[] = []

    const letGo = one.reading((now) => void seen.push(now))
    letGo()
    one.tell("second")

    expect(seen).toEqual([])
    expect(one.now()).toBe("second")
  })
})

describe("an answer the far side pushes", () => {
  it("opens the channel for the first reader and not again for the second", () => {
    let opened = 0
    const one = told("first", () => void (opened += 1))

    expect(opened).toBe(0)
    one.reading(() => undefined)
    one.reading(() => undefined)

    expect(opened).toBe(1)
  })

  it("keeps the channel open after every reader has gone", () => {
    let opened = 0
    let push: (now: string) => void = () => undefined
    const one = told("first", (tell) => {
      opened += 1
      push = tell
    })

    one.reading(() => undefined)()
    one.reading(() => undefined)

    expect(opened).toBe(1)
    push("second")
    expect(one.now()).toBe("second")
  })

  /**
   * A refusal that arrived while nothing was drawing it is still the last
   * thing the far side said, so the next reader reads it rather than the
   * value the page started on.
   */
  it("holds what arrived while nothing was drawing it", () => {
    let push: (now: string) => void = () => undefined
    const one = told("first", (tell) => void (push = tell))

    one.reading(() => undefined)()
    push("second")

    const seen: string[] = []
    one.reading((now) => void seen.push(now))

    expect(one.now()).toBe("second")
    expect(seen).toEqual([])
  })
})

describe("an answer the page asks the far side for", () => {
  it("holds one call in flight however many readers ask at once", async () => {
    let asks = 0
    const { answer, settle } = pending<string>()
    const one = asked("reading", () => {
      asks += 1
      return answer
    })

    const seen: string[] = []
    const other: string[] = []
    one.reading((now) => void seen.push(now))
    one.reading((now) => void other.push(now))

    expect(asks).toBe(1)
    expect(one.now()).toBe("reading")

    settle("read")
    await drain()

    expect(seen).toEqual(["read"])
    expect(other).toEqual(["read"])
    expect(one.now()).toBe("read")
  })

  // What a page that has just opened another Session wants: the titles the
  // Runs wrote while it was away.
  it("asks again for a reader that arrives after one settled", async () => {
    let asks = 0
    const one = asked("reading", () => {
      asks += 1
      return Promise.resolve(`read ${asks}`)
    })

    one.reading(() => undefined)
    await drain()
    expect(one.now()).toBe("read 1")

    one.reading(() => undefined)
    await drain()

    expect(asks).toBe(2)
    expect(one.now()).toBe("read 2")
  })

  it("asks again for every reader at once when a write says to", async () => {
    let asks = 0
    const one = asked("reading", () => {
      asks += 1
      return Promise.resolve(`read ${asks}`)
    })

    const seen: string[] = []
    const other: string[] = []
    one.reading((now) => void seen.push(now))
    one.reading((now) => void other.push(now))
    await drain()

    one.again()
    await drain()

    expect(asks).toBe(2)
    expect(seen).toEqual(["read 1", "read 2"])
    expect(other).toEqual(["read 1", "read 2"])
  })

  // The held call is let go of first, so what the readers share is the new
  // answer and not the one the write already made stale.
  it("lets go of the call in flight before it asks again", async () => {
    let asks = 0
    const first = pending<string>()
    const one = asked("reading", () => {
      asks += 1
      return asks === 1 ? first.answer : Promise.resolve("read 2")
    })

    one.reading(() => undefined)
    one.again()
    await drain()

    expect(asks).toBe(2)
    expect(one.now()).toBe("read 2")

    first.settle("read 1")
    await drain()

    expect(one.now()).toBe("read 2")
  })
})

describe("a read for as long as the reader draws", () => {
  it("hands over the answer while the reader is still drawing", async () => {
    const seen: string[] = []
    whileDrawn(
      () => Promise.resolve("read"),
      (now) => void seen.push(now),
    )
    await drain()

    expect(seen).toEqual(["read"])
  })

  it("drops an answer that settles after the reader has gone", async () => {
    const { answer, settle } = pending<string>()
    const seen: string[] = []

    const gone = whileDrawn(
      () => answer,
      (now) => void seen.push(now),
    )
    gone()
    settle("read")
    await drain()

    expect(seen).toEqual([])
  })

  it("runs the stop the answer gave back", async () => {
    let stopped = 0
    const gone = whileDrawn(
      () => Promise.resolve("read"),
      () => () => void (stopped += 1),
    )
    await drain()

    gone()
    expect(stopped).toBe(1)

    // The reader goes once. A second let-go runs no second stop.
    gone()
    expect(stopped).toBe(1)
  })

  it("runs no stop for a read that settled after the reader had gone", async () => {
    const { answer, settle } = pending<string>()
    let stopped = 0

    const gone = whileDrawn(
      () => answer,
      () => () => void (stopped += 1),
    )
    gone()
    settle("read")
    await drain()

    expect(stopped).toBe(0)
  })
})
