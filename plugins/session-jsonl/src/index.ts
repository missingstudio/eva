import {
  foldTranscript,
  headerOf,
  newSessionID,
  type Session,
  type SessionHeader,
  type SessionStore,
  type TraceSink,
} from "@missingstudio/eva-core"
import type { Event, PriceLookup, SessionID } from "@missingstudio/eva-schema"
import { define } from "@missingstudio/eva-sdk"
import { Effect, Stream } from "effect"

export interface SessionStoreDeps {
  // Read at the point of use, so replacing the sink moves the next fold.
  readonly sink: Effect.Effect<TraceSink | undefined>
  // The rates a fold prices an Estimate at. `ctx.prices` is what a plugin
  // hands over; without one a fold answers with the estimate absent.
  readonly prices?: Effect.Effect<PriceLookup>
}

/**
 * A Session is the durable transcript, and every projection of it is a fold
 * over the Trace. Nothing is stored twice: this reads the sink back.
 */
export const makeSessionStore = (deps: SessionStoreDeps): Effect.Effect<SessionStore> =>
  Effect.sync(() => {
    const known = new Set<SessionID>()

    const replay = Effect.fn("eva.session.jsonl.replay")(function* (id: SessionID) {
      const sink = yield* deps.sink
      if (sink === undefined) return [] as readonly Event[]
      return [...(yield* Stream.runCollect(sink.replay(id)))]
    })

    const open = Effect.fn("eva.session.jsonl.open")(function* (id: SessionID) {
      known.add(id)
      const events = yield* replay(id)
      return { id, header: headerOf(id, events) } satisfies Session
    })

    return {
      create: Effect.sync(() => {
        const id = newSessionID()
        known.add(id)
        return { id, header: { id } } satisfies Session
      }),
      open,
      fold: Effect.fn("eva.session.jsonl.fold")(function* (id: SessionID) {
        const events = yield* replay(id)
        return foldTranscript(
          id,
          events,
          deps.prices === undefined ? undefined : yield* deps.prices,
        )
      }),
      // The trace is the source. A session opened in this process but not
      // yet committed is listed too, so a new Session is visible at once.
      list: Effect.fn("eva.session.jsonl.list")(function* () {
        const sink = yield* deps.sink
        const onDisk = sink === undefined ? [] : yield* sink.sessions
        const headers: SessionHeader[] = []
        for (const id of new Set([...onDisk, ...known])) {
          headers.push(headerOf(id, yield* replay(id)))
        }
        return headers
      })(),
    }
  })

export const sessionJsonl = define({
  id: "eva.session.jsonl",
  effect: Effect.fn("eva.session.jsonl")(function* (ctx) {
    const store = yield* makeSessionStore({ sink: ctx.slot.traceSink.peek, prices: ctx.prices })
    yield* ctx.slot.sessionStore.provide(ctx.id, store)
  }),
})
