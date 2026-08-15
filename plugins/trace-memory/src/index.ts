import { define } from "@missingstudio/eva-sdk"
import { Effect, Scope } from "effect"
import { makeMemorySink } from "./sink.js"

export * from "./sink.js"

// Exists to prove the swap: same contract, nothing durable behind it.
export const traceMemory = define({
  id: "eva.trace.memory",
  effect: Effect.fn("eva.trace.memory")(function* (ctx) {
    const sink = yield* makeMemorySink()
    const scope = yield* Effect.scope
    yield* Scope.addFinalizer(scope, sink.close)
    yield* ctx.slot.traceSink.provide(ctx.id, sink)
  }),
})
