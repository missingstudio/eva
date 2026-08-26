import { mergeText, type Event, type SessionID } from "@missingstudio/eva-schema"
import { Effect, PubSub, Stream } from "effect"
import type { TraceSink } from "./contracts.js"
import { headerOf, type SessionHeader } from "./transcript.js"

export class SinkClosedError extends Error {
  override readonly name = "SinkClosedError"
  constructor() {
    super("the sink is closed")
  }
}

/**
 * What a sink stores. It is handed a coalesced group with no trace
 * positions, and it owns the allocation: each event is numbered one past
 * its session's high water inside the same act that makes it durable.
 * A store that allocates in its own transaction is safe against a second
 * writer; one that cannot implements `StampedStore` instead.
 */
export interface TraceStore {
  // Numbers a group and stores it. Returns the stamped group once durable.
  readonly append: (group: readonly Event[]) => Effect.Effect<readonly Event[]>
  readonly highWater: (session: SessionID) => Effect.Effect<number>
  readonly replay: (session: SessionID) => Stream.Stream<Event>
  readonly sessions: Effect.Effect<readonly SessionID[]>
  /**
   * Every session's Header, when the store can answer without replaying
   * every Session — a table beside the log, or a first line and an `mtime`.
   * Optional here and never optional at the seam: a store without one is
   * folded by `sinkOf`, so the listing is never wrong, only slower.
   */
  readonly headers?: Effect.Effect<readonly SessionHeader[]>
  readonly close: Effect.Effect<void>
}

/**
 * A store that keeps what it is given and numbers nothing: `write` is
 * handed records that already carry their trace positions, and `highWater`
 * answers from whatever the store kept — asked per session, so a store
 * that recovers lazily reads one session's records and not the world's.
 */
export interface StampedStore {
  readonly highWater: (session: SessionID) => Effect.Effect<number>
  // Writes a stamped group. It returns once the group is durable.
  readonly write: (group: readonly Event[]) => Effect.Effect<void>
  readonly replay: (session: SessionID) => Stream.Stream<Event>
  readonly sessions: Effect.Effect<readonly SessionID[]>
  readonly headers?: Effect.Effect<readonly SessionHeader[]>
  readonly close: Effect.Effect<void>
}

/**
 * Either kind of store. A sink author writes one of them and hands it to
 * `sinkOf`; which one is the single question they answer, and the answer is
 * whether the store can number inside the act that makes a group durable.
 */
export type AnyStore = TraceStore | StampedStore

/**
 * In-memory allocation over a store that cannot allocate for itself: the
 * high water is asked once per session, held here, and moved only after
 * the write is durable — a group that never landed leaves the next one to
 * take the numbers it wanted. One process only, which is the trade the
 * JSONL and memory stores accept and a transactional store must not.
 *
 * An internal seam of `sinkOf`, with its own tests. Sink authors reach it
 * by handing `sinkOf` a `StampedStore`, never by name.
 */
export const numbered = (store: StampedStore): Effect.Effect<TraceStore> =>
  Effect.sync(() => {
    const highWater = new Map<SessionID, number>()

    const headOf = (session: SessionID): Effect.Effect<number> =>
      Effect.suspend(() => {
        const held = highWater.get(session)
        if (held !== undefined) return Effect.succeed(held)
        return Effect.map(store.highWater(session), (found) => {
          highWater.set(session, found)
          return found
        })
      })

    return {
      append: (group) =>
        Effect.gen(function* () {
          const next = new Map<SessionID, number>()
          const stamped: Event[] = []
          for (const event of group) {
            const seq = (next.get(event.session) ?? (yield* headOf(event.session))) + 1
            next.set(event.session, seq)
            stamped.push({ ...event, seq })
          }
          yield* store.write(stamped)
          // Positions are provisional until the write is durable, so the
          // high water moves only after the store says the group landed.
          for (const [session, seq] of next) highWater.set(session, seq)
          return stamped
        }),
      highWater: headOf,
      replay: store.replay,
      sessions: store.sessions,
      ...(store.headers === undefined ? {} : { headers: store.headers }),
      close: store.close,
    }
  })

/**
 * Every Session's Header, folded from the record a Session at a time. What
 * a store answers when it keeps no Headers of its own — right by
 * construction, because it is the same fold every other projection is, and
 * slower for exactly that reason.
 */
const folded = (store: TraceStore): Effect.Effect<readonly SessionHeader[]> =>
  Effect.gen(function* () {
    const found: SessionHeader[] = []
    for (const session of yield* store.sessions) {
      found.push(headerOf(session, [...(yield* Stream.runCollect(store.replay(session)))]))
    }
    return found
  })

/**
 * Turns a store into a sink by holding what every sink owes and no store
 * should repeat: coalesce text chunks before the store numbers them —
 * numbering before merging would leave holes — hand a committed record to
 * its followers, answer for a store that keeps no Headers, and refuse a
 * group after the close. It is written once for every store, because two
 * sinks once paid these rules separately and drifted.
 *
 * An internal seam of `sinkOf`, with its own tests.
 */
export const sequenced = (store: TraceStore): Effect.Effect<TraceSink> =>
  Effect.sync(() => {
    let closed = false

    // One hub per followed session, made when the first follower arrives.
    // A session nobody follows costs nothing, and a hub is never removed —
    // the sessions one process opens are few, and a follower may return.
    const followers = new Map<SessionID, PubSub.PubSub<Event>>()
    const hubOf = (session: SessionID): Effect.Effect<PubSub.PubSub<Event>> =>
      Effect.suspend(() => {
        const found = followers.get(session)
        if (found !== undefined) return Effect.succeed(found)
        // Unbounded, so a slow follower cannot stall the commit that feeds it.
        return Effect.map(PubSub.unbounded<Event>(), (hub) => {
          followers.set(session, hub)
          return hub
        })
      })

    return {
      append: (group: readonly Event[]) =>
        Effect.gen(function* () {
          if (closed) return yield* Effect.die(new SinkClosedError())
          const merged = mergeText(group)
          if (merged.length === 0) return [] as readonly Event[]
          const stamped = yield* store.append(merged)
          // Followers hear the record only once it is the record.
          for (const event of stamped) {
            const hub = followers.get(event.session)
            if (hub !== undefined) yield* PubSub.publish(hub, event)
          }
          return stamped
        }),

      highWater: store.highWater,

      follow: (session: SessionID) =>
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(yield* hubOf(session))
          return Stream.fromSubscription(subscription)
        }),

      replay: store.replay,
      sessions: store.sessions,
      headers: store.headers ?? folded(store),

      // Safe to repeat, and the store is closed exactly once.
      close: Effect.suspend(() => {
        if (closed) return Effect.void
        closed = true
        return store.close
      }),
    }
  })

/**
 * The one way a store becomes a sink. A store that numbers for itself is
 * sequenced over directly; one that does not is numbered in this process
 * first. Every sink plugin and every test that wants a sink comes through
 * here, so the composition is one thing to change rather than eight.
 */
export const sinkOf = (store: AnyStore): Effect.Effect<TraceSink> =>
  "append" in store ? sequenced(store) : Effect.flatMap(numbered(store), sequenced)
