import type { Broadcast } from "@missingstudio/eva-core"
import { Effect, PubSub, Stream } from "effect"

/**
 * A process-local notification bus. A Broadcast is never written to the
 * Trace and carries no schema guarantee, so nothing here is an Event.
 *
 * `capacity` bounds a topic: a number means sliding with that bound, so a
 * lagging subscriber sees the latest values and nothing grows; absent means
 * unbounded. Only a topic whose payload is a snapshot may slide — an event
 * a consumer counts stays unbounded, because a dropped event makes the
 * count wrong.
 */
export const makeBroadcast = <Map>(
  capacity?: (type: keyof Map) => number | undefined,
): Effect.Effect<Broadcast<Map>> =>
  Effect.sync(() => {
    const topics = new Map<keyof Map, PubSub.PubSub<Map[keyof Map]>>()

    const topic = Effect.fn("kernel.broadcast.topic")(function* (type: keyof Map) {
      const found = topics.get(type)
      if (found !== undefined) return found
      const bound = capacity?.(type)
      const made =
        bound === undefined
          ? yield* PubSub.unbounded<Map[keyof Map]>()
          : yield* PubSub.sliding<Map[keyof Map]>(bound)
      topics.set(type, made)
      return made
    })

    return {
      subscribe: <Type extends keyof Map>(type: Type) =>
        Stream.unwrap(topic(type).pipe(Effect.map(Stream.fromPubSub))) as Stream.Stream<Map[Type]>,
      publish: <Type extends keyof Map>(type: Type, payload: Map[Type]) =>
        topic(type).pipe(
          Effect.andThen((found) => PubSub.publish(found, payload as Map[keyof Map])),
          Effect.asVoid,
        ),
    }
  })
