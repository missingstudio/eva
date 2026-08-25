import type { ModelRef, SessionAPI } from "@missingstudio/eva-core"
import type { Cursor } from "@missingstudio/eva-schema"
import { Effect, Fiber, Stream, SubscriptionRef } from "effect"
import { describe, expect, it } from "vitest"
import {
  fakeApi,
  given,
  MODEL,
  PROMPT,
  SESSION,
  spoken,
  text,
  type Call,
  type Fake,
} from "./fake-api.js"
import { runPrompt, type ClientState } from "./run.js"
import { droppableTransport, localTransport } from "./transport.js"

const BOUND = 5

const OTHER: ModelRef = { provider: "other", model: "other" }

const FROM: Cursor = { session: SESSION, seq: 1 }

// Every method of the contract, once, in one order — both forms of `watch`,
// because the two differ in their error channel and one cast covers them
// both. What a filler passes through has to be all of it: a wrapper that
// forgets a method or reorders an argument is what this walk is for.
const walk = Effect.fn("test.walk")(function* (api: SessionAPI) {
  yield* api.create("/here")
  yield* api.list
  yield* Effect.scoped(api.attach(SESSION))
  yield* Effect.sync(() => void api.watch(SESSION))
  yield* Effect.sync(() => void api.watch(SESSION, FROM))
  yield* api.submit(SESSION, PROMPT)
  yield* api.cancel(SESSION, "user")
  yield* api.model.get(SESSION)
  yield* api.model.set(SESSION, OTHER)
  yield* api.answer("req_1", { kind: "cancelled" })
})

const WALKED: readonly Call[] = [
  { method: "create", args: ["/here"] },
  { method: "list", args: [] },
  { method: "attach", args: [SESSION] },
  { method: "watch", args: [SESSION] },
  { method: "watch", args: [SESSION, FROM] },
  { method: "submit", args: [SESSION, PROMPT] },
  { method: "cancel", args: [SESSION, "user"] },
  { method: "model.get", args: [SESSION] },
  { method: "model.set", args: [SESSION, OTHER] },
  { method: "answer", args: ["req_1", { kind: "cancelled" }] },
]

// The watch is running once the API behind the seam has a live subscription.
// A bounded poll on the spy, because a fixed pause misses on a loaded host.
const subscribed = Effect.fn("test.subscribed")(function* (fake: Fake) {
  for (let turn = 0; turn < 500 && fake.open() === 0; turn += 1) yield* Effect.yieldNow
  expect(fake.open()).toBe(1)
})

// Every turn a call that must not happen could have used. Nothing that has
// to happen waits on this; it is what gives a negative its chance to fail.
const turns = Effect.fn("test.turns")(function* () {
  for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow
})

describe("the transport seam", () => {
  it("passes the whole contract through the local filler, unchanged", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([text("par")])
        const transport = yield* localTransport(fake.api)

        // There is nothing between the runtime and the API in this process.
        expect(transport.api).toBe(fake.api)
        expect(yield* SubscriptionRef.get(transport.health)).toBe("ready")

        yield* walk(transport.api)
        expect(fake.calls).toEqual(WALKED)
      }),
    )
  })

  it("passes the whole contract through the droppable filler while it is ready", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([text("par")])
        const transport = yield* droppableTransport(fake.api)

        expect(yield* SubscriptionRef.get(transport.health)).toBe("ready")
        yield* walk(transport.api)
        expect(fake.calls).toEqual(WALKED)
      }),
    )
  })

  it("ends an open watch on drop, and says so through health", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([])
        const transport = yield* droppableTransport(fake.api)

        const watching = yield* Effect.forkChild(Stream.runDrain(transport.api.watch(SESSION)))
        yield* subscribed(fake)

        yield* transport.drop
        expect(yield* SubscriptionRef.get(transport.health)).toBe("disconnected")

        // The stream ends. It does not fail: `SessionAPI` has no error
        // channel, and the seam keeps it that way.
        yield* Fiber.join(watching)
        expect(fake.open()).toBe(0)

        yield* transport.restore
        expect(yield* SubscriptionRef.get(transport.health)).toBe("ready")
      }),
    )
  })

  it("holds a call made while dropped until restore", async () => {
    const answered = await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([])
        const transport = yield* droppableTransport(fake.api)

        yield* transport.drop
        const asking = yield* Effect.forkChild(transport.api.model.get(SESSION))

        // Held, not refused, and it has reached nothing behind the seam.
        yield* turns()
        expect(given(fake, "model.get")).toEqual([])

        yield* transport.restore
        const model = yield* Fiber.join(asking)
        expect(given(fake, "model.get")).toEqual([[SESSION]])
        return model
      }),
    )

    expect(answered).toEqual(MODEL)
  })

  it("carries the protocol: the record through the filler is the record without it", async () => {
    const both = await Effect.runPromise(
      Effect.gen(function* () {
        const state = yield* SubscriptionRef.make<ClientState>("ready")

        const filled = yield* fakeApi([text("par"), text("tial")])
        const transport = yield* localTransport(filled.api)
        const through = yield* runPrompt({ transport, state, session: SESSION }, PROMPT, () => {}, {
          settle: BOUND,
        })

        const plain = yield* fakeApi([text("par"), text("tial")])
        const bare = yield* runPrompt(
          { transport: yield* localTransport(plain.api), state, session: SESSION },
          PROMPT,
          () => {},
          { settle: BOUND },
        )

        return { through, bare }
      }),
    )

    expect(both.through.session).toBe(both.bare.session)
    expect(both.through.at).toEqual(both.bare.at)
    expect(spoken(both.through)).toBe(spoken(both.bare))
    expect(spoken(both.through)).toBe("partial")
  })
})
