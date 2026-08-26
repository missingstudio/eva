import { numbered, sequenced, type StampedStore } from "@missingstudio/eva-core"
import { sessionID, type Event, type SessionID } from "@missingstudio/eva-schema"
import { define } from "@missingstudio/eva-sdk"
import { Effect, Scope, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { committed, withKernel } from "./context.js"

const ONE = sessionID("sess_context_one")
const TWO = sessionID("sess_context_two")

// A record of one payload, with the sink to stamp its position.
const record = (session: SessionID, text: string): Event =>
  ({
    session,
    parent: null,
    payload: { kind: "text", block: 0, content: { type: "text", text } },
  }) as unknown as Event

/**
 * A sink plugin the testkit may define, because the testkit may not import
 * one. It is the memory store `sequenced` turns into a TraceSink, so
 * `committed` is read through the same contract every shipped sink honors.
 */
const held: Event[] = []
const sink = define({
  id: "test.sink.held",
  effect: Effect.fn("test.sink.held")(function* (ctx) {
    const store: StampedStore = {
      highWater: () => Effect.succeed(0),
      write: (group) => Effect.sync(() => void held.push(...group)),
      replay: (session) =>
        Stream.suspend(() => Stream.fromIterable(held.filter((one) => one.session === session))),
      sessions: Effect.sync(() => [...new Set(held.map((one) => one.session))]),
      close: Effect.void,
    }
    yield* ctx.slot.traceSink.provide(ctx.id, yield* sequenced(yield* numbered(store)))
  }),
})

// Which plugin ran, in load order, so a test can assert the order it asked
// for is the order it got.
const ran: string[] = []
const marking = (id: string, seen?: (options: Record<string, unknown>) => void) =>
  define({
    id,
    effect: Effect.fn(id)(function* (ctx) {
      ran.push(id)
      seen?.(ctx.options)
      yield* Effect.void
    }),
  })

// A plugin that leaves a finalizer behind, so a test can say when the scope
// it was loaded into closed.
const closing = (id: string, closed: string[]) =>
  define({
    id,
    effect: Effect.fn(id)(function* (ctx) {
      ran.push(id)
      yield* Scope.addFinalizer(
        yield* Effect.scope,
        Effect.sync(() => void closed.push(ctx.id)),
      )
    }),
  })

describe("withKernel", () => {
  it("loads the plugins in the order it was handed", async () => {
    ran.length = 0
    await withKernel([marking("test.first"), marking("test.second")], () => Effect.void)

    expect(ran).toEqual(["test.first", "test.second"])
  })

  it("closes the scope before it answers, so a finalizer has already run", async () => {
    ran.length = 0
    const closed: string[] = []
    await withKernel([closing("test.closing", closed)], () => Effect.void)

    expect(closed).toEqual(["test.closing"])
  })

  it("hands each plugin its own entry options", async () => {
    let seen: Record<string, unknown> = {}
    await withKernel(
      [
        {
          plugin: marking("test.optioned", (options) => void (seen = options)),
          options: { size: 3 },
        },
      ],
      () => Effect.void,
    )

    expect(seen).toEqual({ size: 3 })
  })

  it("hands every plugin the one config", async () => {
    let seen: unknown
    const reader = define({
      id: "test.reader",
      effect: Effect.fn("test.reader")(function* (ctx) {
        seen = (yield* ctx.config)["model"]
      }),
    })
    await withKernel([reader], () => Effect.void, { config: { model: "fake/model" } })

    expect(seen).toBe("fake/model")
  })
})

describe("committed", () => {
  it("reads every session's records back through the Slot's own contract", async () => {
    held.length = 0
    const found = await withKernel([sink], (kernel) =>
      Effect.gen(function* () {
        const behind = yield* kernel.slot.traceSink.get
        yield* behind.append([record(ONE, "one")])
        yield* behind.append([record(TWO, "two"), record(ONE, "three")])
        return yield* committed(kernel)
      }),
    )

    // Session by session, in trace order — and every position stamped from 1
    // by the sink, which is what makes this the record and not the argument.
    expect(found.map((one) => [one.session, one.seq])).toEqual([
      [ONE, 1],
      [ONE, 2],
      [TWO, 1],
    ])
  })
})
