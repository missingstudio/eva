import { describe, expect, it } from "vitest"
import { cursorIn, framesIn, frameOut } from "./frames.js"

// The one framing both wires speak, held to itself: what the writer spells
// is what the reader reads back, split however the socket splits it.
describe("a frame of the stream", () => {
  it("reads back what it wrote, position and all", () => {
    const read = framesIn(frameOut({ seq: 4, data: "a payload" }) + frameOut({ data: "another" }))

    expect(read.frames).toEqual([{ seq: 4, data: "a payload" }, { data: "another" }])
    expect(read.rest).toBe("")
  })

  // A socket hands over bytes and not frames, so a frame split across two
  // reads is still one frame: the remainder waits for the rest of itself.
  it("keeps a split frame as the remainder until the rest arrives", () => {
    const whole = frameOut({ seq: 9, data: "split" })
    const first = framesIn(whole.slice(0, 8))
    expect(first.frames).toEqual([])

    const second = framesIn(first.rest + whole.slice(8))
    expect(second.frames).toEqual([{ seq: 9, data: "split" }])
    expect(second.rest).toBe("")
  })

  // A block with no `data` is a comment or a keep-alive and names no payload.
  it("reads no frame out of a comment or a keep-alive", () => {
    expect(framesIn(": keep-alive\n\n").frames).toEqual([])
  })
})

describe("a position", () => {
  it("is a whole number, and anything else names none", () => {
    expect(cursorIn("12")).toBe(12)
    expect(cursorIn(" 3 ")).toBe(3)
    expect(cursorIn("later")).toBeUndefined()
    expect(cursorIn("1.5")).toBeUndefined()
    expect(cursorIn(undefined)).toBeUndefined()
  })
})
