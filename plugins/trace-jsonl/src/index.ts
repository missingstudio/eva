import { expand } from "@missingstudio/eva-core"
import { declare, define } from "@missingstudio/eva-sdk"
import { Effect, Scope } from "effect"
import { makeJsonlSink } from "./sink.js"

export * from "./sink.js"

// One directory, one file per Session, each Session numbered from 1.
export const DEFAULT_DIR = "~/.eva/trace"

const OPTIONS = declare({ dir: "string", fsync: "boolean" })

export const traceJsonl = define({
  id: "eva.trace.jsonl",
  takes: OPTIONS.shapes,
  effect: Effect.fn("eva.trace.jsonl")(function* (ctx) {
    const dir = expand(OPTIONS.read(ctx.options, "dir", DEFAULT_DIR))
    const fsync = OPTIONS.read(ctx.options, "fsync", true)
    const sink = yield* makeJsonlSink(dir, { fsync })
    const scope = yield* Effect.scope
    yield* Scope.addFinalizer(scope, sink.close)
    yield* ctx.slot.traceSink.provide(ctx.id, sink)
  }),
})
