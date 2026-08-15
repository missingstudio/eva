import { sequenced, type TraceSink, type TraceStore } from "@missingstudio/eva-core"
import type { Event, SessionID } from "@missingstudio/eva-schema"
import { Effect, Stream } from "effect"

export interface MemorySink extends TraceSink {
  // Everything committed, in trace order. The swap test reads this.
  readonly all: () => readonly Event[]
}

export const makeMemorySink = (): Effect.Effect<MemorySink> =>
  Effect.gen(function* () {
    const events: Event[] = []

    // Nothing outlives the process, so a fresh store starts at nothing.
    const store: TraceStore = {
      highWater: Effect.succeed(new Map<SessionID, number>()),
      write: (group) => Effect.sync(() => void events.push(...group)),
      replay: (session) =>
        Stream.suspend(() => Stream.fromIterable(events.filter((e) => e.session === session))),
      sessions: Effect.sync(() => [...new Set(events.map((event) => event.session))]),
      close: Effect.void,
    }

    return { ...(yield* sequenced(store)), all: () => [...events] }
  })
