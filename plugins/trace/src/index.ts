import { shortID } from "@missingstudio/eva-core"
import { define } from "@missingstudio/eva-sdk"
import type { Timestamp } from "@missingstudio/eva-schema"
import { Effect } from "effect"
import { makeRecorder } from "./recorder.js"

export * from "./recorder.js"

const wallClock = (): Timestamp => ({ wall: new Date().toISOString() })

export const trace = define({
  id: "eva.trace",
  effect: Effect.fn("eva.trace")(function* (ctx) {
    const recorder = yield* makeRecorder({
      // Reading the slot here, inside the Effect, is what makes a sink
      // replacement take effect on the next commit.
      sink: ctx.slot.traceSink.peek,
      now: wallClock,
      nextID: shortID,
    })

    yield* ctx.slot.recorder.provide(ctx.id, recorder)
  }),
})
