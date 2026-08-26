import { expand } from "@missingstudio/eva-core"
import { declare, define } from "@missingstudio/eva-sdk"
import { Effect, Scope } from "effect"
import { makeSqliteSink } from "./sink.js"

export * from "./sink.js"

// One database, every Session, each numbered from 1 inside the write
// transaction — so a second Eva process on the same file cannot collide.
export const DEFAULT_PATH = "~/.eva/trace.sqlite"

// Where the one-file JSONL trace used to live. An empty store loads it
// whole at open, keeping every trace position, and never looks again.
export const LEGACY_PATH = "~/.eva/trace.jsonl"

const OPTIONS = declare({ path: "string", synchronous: "string", import: "string" })

export const traceSqlite = define({
  id: "eva.trace.sqlite",
  takes: OPTIONS.shapes,
  effect: Effect.fn("eva.trace.sqlite")(function* (ctx) {
    const path = expand(OPTIONS.read(ctx.options, "path", DEFAULT_PATH))
    const synchronous = OPTIONS.read(ctx.options, "synchronous", "normal")
    // The legacy import is offered unasked only at the default location: a
    // store config pointed somewhere else is a hermetic run or a second
    // Eva, and neither may read the operator's home unprompted.
    const legacy = path === expand(DEFAULT_PATH) ? LEGACY_PATH : ""
    const importFrom = OPTIONS.read(ctx.options, "import", legacy)
    const sink = yield* makeSqliteSink(path, {
      synchronous: synchronous === "full" ? "full" : "normal",
      ...(importFrom === "" ? {} : { importFrom: expand(importFrom) }),
    })
    const scope = yield* Effect.scope
    yield* Scope.addFinalizer(scope, sink.close)
    yield* ctx.slot.traceSink.provide(ctx.id, sink)
  }),
})
