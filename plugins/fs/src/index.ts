import { expand } from "@missingstudio/eva-core/local"
import { declare, define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { makeFileSystem } from "./fs.js"

export * from "./fs.js"

const OPTIONS = declare({ root: "string" })

/**
 * Fills the `FileSystem` slot: reads and writes files under one root, and
 * refuses a path outside it. The root is where Eva was started unless config
 * names another, because a tool works on the workspace a person opened.
 */
export const fs = define({
  id: "eva.fs",
  takes: OPTIONS.shapes,
  effect: Effect.fn("eva.fs")(function* (ctx) {
    const root = expand(OPTIONS.read(ctx.options, "root", process.cwd()))
    yield* ctx.slot.fileSystem.provide(ctx.id, makeFileSystem(root))
  }),
})
