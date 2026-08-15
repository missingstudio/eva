import { mergeText, type Event, type SessionID } from "@missingstudio/eva-schema"
import { Effect, Stream } from "effect"
import type { TraceSink } from "./contracts.js"

export class SinkClosedError extends Error {
  override readonly name = "SinkClosedError"
  constructor() {
    super("the sink is closed")
  }
}

/**
 * What a sink stores. It is handed records that already carry their trace
 * positions, and it says where each session got to — on a fresh process
 * that answer comes from whatever it kept.
 */
export interface TraceStore {
  readonly highWater: Effect.Effect<ReadonlyMap<SessionID, number>>
  // Writes a stamped group. It returns once the group is durable.
  readonly write: (group: readonly Event[]) => Effect.Effect<void>
  readonly replay: (session: SessionID) => Stream.Stream<Event>
  readonly sessions: Effect.Effect<readonly SessionID[]>
  readonly close: Effect.Effect<void>
}

/**
 * The trace-position rule every sink follows: coalesce text chunks first,
 * then number each event one past its session's high water. Numbering
 * before merging would leave holes. The given map is not written; the
 * caller moves its own high water once the write is safe.
 */
const stampGroup = (
  highWater: ReadonlyMap<SessionID, number>,
  group: readonly Event[],
): readonly Event[] => {
  const next = new Map(highWater)
  return mergeText(group).map((event) => {
    const seq = (next.get(event.session) ?? 0) + 1
    next.set(event.session, seq)
    return { ...event, seq }
  })
}

/**
 * Turns a store into a sink by holding the rule every sink owed: merge,
 * number from the high water, advance only once the write is durable, and
 * refuse a group after the close. A store answers where records live; this
 * answers where they sit in the Trace, and it is written once for all of
 * them.
 */
export const sequenced = (store: TraceStore): Effect.Effect<TraceSink> =>
  Effect.gen(function* () {
    const highWater = new Map(yield* store.highWater)
    let closed = false

    return {
      append: (group: readonly Event[]) =>
        Effect.gen(function* () {
          if (closed) return yield* Effect.die(new SinkClosedError())
          const stamped = stampGroup(highWater, group)
          if (stamped.length === 0) return [] as readonly Event[]
          yield* store.write(stamped)
          // Positions are provisional until the write is durable, so the
          // high water moves only after the store says the group landed.
          for (const event of stamped) highWater.set(event.session, event.seq)
          return stamped
        }),

      replay: store.replay,
      sessions: store.sessions,

      // Safe to repeat, and the store is closed exactly once.
      close: Effect.suspend(() => {
        if (closed) return Effect.void
        closed = true
        return store.close
      }),
    }
  })
