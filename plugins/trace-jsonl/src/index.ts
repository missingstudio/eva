import { expand } from "@missingstudio/eva-core"
import { declare, define } from "@missingstudio/eva-sdk"
import { Effect, Scope } from "effect"
import { makeJsonlSink } from "./sink.js"

export * from "./sink.js"

// One file by default, sessions interleaved, each session numbered from 1.
export const DEFAULT_PATH = "~/.eva/trace.jsonl"

const OPTIONS = declare({ path: "string" })

export const traceJsonl = define({
  id: "eva.trace.jsonl",
  takes: OPTIONS.shapes,
  effect: Effect.fn("eva.trace.jsonl")(function* (ctx) {
    const path = expand(OPTIONS.read(ctx.options, "path", DEFAULT_PATH))
    const sink = yield* makeJsonlSink(path)
    const scope = yield* Effect.scope
    yield* Scope.addFinalizer(scope, sink.close)
    yield* ctx.slot.traceSink.provide(ctx.id, sink)
  }),
})
