import { Effect, Fiber, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { makeBroadcast } from "./broadcast.js"

interface Events {
  "slot.filled": { slot: string }
  "slot.emptied": { slot: string }
  "command.updated": { count: number }
}

// The capacity boot passes: `.updated` snapshots slide, events stay whole.
const sliding = (type: keyof Events) => (String(type).endsWith(".updated") ? 1 : undefined)

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

/**
 * A subscriber that stops taking used to accumulate every published value
 * for as long as the process lives. A sliding topic keeps only the latest:
 * its payload is a snapshot, so a subscriber that missed three and reads
 * the fourth knows everything the four would have told it.
 */
describe("a sliding topic", () => {
  // The pull subscribes on its first use, so a sentinel is pulled first:
  // a received value proves the subscription was live before the burst.
  it("answers a lagging subscriber the latest value, and only it", async () => {
    const found = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* makeBroadcast<Events>(sliding)
          const pull = yield* Stream.toPull(bus.subscribe("command.updated"))
          const attaching = yield* Effect.forkChild(pull)
          yield* Effect.yieldNow
          yield* bus.publish("command.updated", { count: -1 })
          yield* Fiber.join(attaching)
          for (let count = 0; count < 100; count++) {
            yield* bus.publish("command.updated", { count })
          }
          return [...(yield* pull)]
        }),
      ),
    )
    expect(found).toEqual([{ count: 99 }])
  })

  it("answers a lagging subscriber on an unbounded topic all values", async () => {
    const found = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* makeBroadcast<Events>(sliding)
          const pull = yield* Stream.toPull(bus.subscribe("slot.filled"))
          const attaching = yield* Effect.forkChild(pull)
          yield* Effect.yieldNow
          yield* bus.publish("slot.filled", { slot: "sentinel" })
          yield* Fiber.join(attaching)
          for (let count = 0; count < 100; count++) {
            yield* bus.publish("slot.filled", { slot: `sink_${count}` })
          }
          const all: { slot: string }[] = []
          while (all.length < 100) all.push(...(yield* pull))
          return all
        }),
      ),
    )
    expect(found).toHaveLength(100)
    expect(found.at(-1)).toEqual({ slot: "sink_99" })
  })

  // Sliding drops only under lag.
  it("gives a subscriber that keeps pace every value", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBroadcast<Events>(sliding)
        const listening = yield* Effect.forkChild(
          bus.subscribe("command.updated").pipe(Stream.take(3), Stream.runCollect),
        )
        yield* Effect.yieldNow
        for (const count of [1, 2, 3]) {
          yield* bus.publish("command.updated", { count })
          // The pace: the subscriber drains each commit before the next.
          yield* Effect.yieldNow
        }
        return yield* Fiber.join(listening)
      }),
    )
    expect([...found].map((event) => event.count)).toEqual([1, 2, 3])
  })
})
