import { Effect, Fiber, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { makeBroadcast } from "./broadcast.js"

interface Events {
  "slot.filled": { slot: string }
  "slot.emptied": { slot: string }
}

describe("the broadcast bus", () => {
  it("delivers to a subscriber as a stream", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBroadcast<Events>()
        const listening = yield* Effect.forkChild(
          bus.subscribe("slot.filled").pipe(Stream.take(2), Stream.runCollect),
        )
        yield* Effect.yieldNow
        yield* bus.publish("slot.filled", { slot: "TraceSink" })
        yield* bus.publish("slot.filled", { slot: "Recorder" })
        return yield* Fiber.join(listening)
      }),
    )
    expect([...found].map((event) => event.slot)).toEqual(["TraceSink", "Recorder"])
  })

  it("keeps types apart", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBroadcast<Events>()
        const listening = yield* Effect.forkChild(
          bus.subscribe("slot.emptied").pipe(Stream.take(1), Stream.runCollect),
        )
        yield* Effect.yieldNow
        yield* bus.publish("slot.filled", { slot: "ignored" })
        yield* bus.publish("slot.emptied", { slot: "TraceSink" })
        return yield* Fiber.join(listening)
      }),
    )
    expect([...found]).toEqual([{ slot: "TraceSink" }])
  })

  it("drops a publish nobody subscribed to", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBroadcast<Events>()
        yield* bus.publish("slot.filled", { slot: "TraceSink" })
      }),
    )
  })
})
