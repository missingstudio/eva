import { declare, define } from "@missingstudio/eva-sdk"
import { Effect, Scope } from "effect"
import { makePostgresSink } from "./sink.js"

export * from "./sink.js"

// Where the connection string comes from when config does not carry one. A
// URL holds a password, and the environment is where a deployment puts one.
export const URL_VARIABLE = "EVA_POSTGRES_URL"

export const DEFAULT_SCHEMA = "eva"
export const DEFAULT_POOL = 4

const OPTIONS = declare({ url: "string", schema: "string", pool: "number" })

export const tracePostgres = define({
  id: "eva.trace.postgres",
  takes: OPTIONS.shapes,
  effect: Effect.fn("eva.trace.postgres")(function* (ctx) {
    const url = OPTIONS.read(ctx.options, "url", process.env[URL_VARIABLE] ?? "")
    // Without a URL there is no server to fill the slot with. The slot
    // stays empty, and a Run that commits says `degraded` — the same
    // sentence any missing sink gets — rather than this plugin guessing at
    // a localhost.
    if (url === "") return
    const sink = yield* makePostgresSink(url, {
      schema: OPTIONS.read(ctx.options, "schema", DEFAULT_SCHEMA),
      pool: OPTIONS.read(ctx.options, "pool", DEFAULT_POOL),
    })
    const scope = yield* Effect.scope
    yield* Scope.addFinalizer(scope, sink.close)
    yield* ctx.slot.traceSink.provide(ctx.id, sink)
  }),
})
