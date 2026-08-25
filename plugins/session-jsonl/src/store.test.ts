import type { TraceSink } from "@missingstudio/eva-core"
import { eventID, runID, type Event, type Payload, type SessionID } from "@missingstudio/eva-schema"
import { Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { newSessionID } from "@missingstudio/eva-core"
import { makeSessionStore } from "./index.js"

let counter = 0
const event = (session: SessionID, payload: Payload): Event => ({
  id: eventID(`evt_${(counter += 1)}`),
  seq: counter,
  at: { wall: "2026-01-01T00:00:00.000Z" },
  run: runID("run_1"),
  session,
  parent: null,
  payload,
})

// Stands for a trace an earlier process wrote: the store has opened none of
// these sessions, so anything it lists came from the sink.
const seeded = (events: readonly Event[]): TraceSink => ({
  append: (group) => Effect.succeed(group),
  highWater: Effect.sync(() => {
    const water = new Map<SessionID, number>()
    for (const one of events) water.set(one.session, Math.max(water.get(one.session) ?? 0, one.seq))
    return water
  }),
  replay: (session) => Stream.fromIterable(events.filter((one) => one.session === session)),
  follow: () => Effect.succeed(Stream.empty),
  sessions: Effect.succeed([...new Set(events.map((one) => one.session))]),
  close: Effect.void,
})

const store = (sink: TraceSink | undefined) => makeSessionStore({ sink: Effect.succeed(sink) })

describe("the session store", () => {
  // It used to know only the sessions this process had opened, so a new
  // process listed nothing however much the trace held.
  it("lists the sessions the sink reports, not the ones it opened", async () => {
    const first = newSessionID()
    const second = newSessionID()
    const sink = seeded([
      event(first, { kind: "started", intent: "the first question" }),
      event(second, { kind: "started", intent: "the second question" }),
    ])

    const listed = await Effect.runPromise(Effect.flatMap(store(sink), (one) => one.list))

    expect(listed.map((one) => one.id).sort()).toEqual([first, second].sort())
    expect(listed.find((one) => one.id === first)?.title).toBe("the first question")
  })

  it("lists a session opened in this process before anything commits", async () => {
    const listed = await Effect.runPromise(
      Effect.gen(function* () {
        const one = yield* store(seeded([]))
        const made = yield* one.create
        return { made, found: yield* one.list }
      }),
    )

    expect(listed.found.map((one) => one.id)).toEqual([listed.made.id])
  })

  it("lists nothing rather than failing when the slot is empty", async () => {
    expect(await Effect.runPromise(Effect.flatMap(store(undefined), (one) => one.list))).toEqual([])
  })

  it("folds a session back into its messages", async () => {
    const session = newSessionID()
    const sink = seeded([
      event(session, { kind: "started", intent: "hi" }),
      event(session, { kind: "text", block: 0, content: { type: "text", text: "hello" } }),
    ])

    const folded = await Effect.runPromise(Effect.flatMap(store(sink), (one) => one.fold(session)))

    expect(folded.messages().at(-1)?.blocks).toContainEqual({
      type: "content",
      block: 0,
      content: { type: "text", text: "hello" },
    })
  })

  it("reads the sink at the point of use, so a swap moves the next fold", async () => {
    const session = newSessionID()
    let current: TraceSink = seeded([])
    const one = await Effect.runPromise(makeSessionStore({ sink: Effect.sync(() => current) }))

    expect(await Effect.runPromise(one.list)).toEqual([])
    current = seeded([event(session, { kind: "started", intent: "after the swap" })])
    expect((await Effect.runPromise(one.list)).map((row) => row.id)).toEqual([session])
  })
})
