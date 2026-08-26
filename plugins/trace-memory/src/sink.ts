import { sinkOf, type StampedStore, type TraceSink } from "@missingstudio/eva-core"
import type { Event } from "@missingstudio/eva-schema"
import { Effect, Stream } from "effect"

export interface MemorySink extends TraceSink {
  // Everything committed, in trace order. The swap test reads this.
  readonly all: () => readonly Event[]
}

export const makeMemorySink = (): Effect.Effect<MemorySink> =>
  Effect.gen(function* () {
    const events: Event[] = []

    // Nothing outlives the process, so a fresh store starts at nothing and
    // the in-memory numbering `numbered` holds is the only numbering.
    const store: StampedStore = {
      highWater: () => Effect.succeed(0),
      write: (group) => Effect.sync(() => void events.push(...group)),
      replay: (session) =>
        Stream.suspend(() => Stream.fromIterable(events.filter((e) => e.session === session))),
      sessions: Effect.sync(() => [...new Set(events.map((event) => event.session))]),
      close: Effect.void,
    }

    return { ...(yield* sinkOf(store)), all: () => [...events] }
  })
