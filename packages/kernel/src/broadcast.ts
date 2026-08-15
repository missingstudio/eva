import type { Broadcast } from "@missingstudio/eva-core"
import { Effect, PubSub, Stream } from "effect"

/**
 * A process-local notification bus. A Broadcast is never written to the
 * Trace and carries no schema guarantee, so nothing here is an Event.
 */
export const makeBroadcast = <Map>(): Effect.Effect<Broadcast<Map>> =>
  Effect.sync(() => {
    const topics = new Map<keyof Map, PubSub.PubSub<Map[keyof Map]>>()

    const topic = Effect.fn("kernel.broadcast.topic")(function* (type: keyof Map) {
      const found = topics.get(type)
      if (found !== undefined) return found
      const made = yield* PubSub.unbounded<Map[keyof Map]>()
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
