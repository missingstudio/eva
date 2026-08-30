#!/usr/bin/env bun
// The workspace entry: `bun apps/cli/src/eva.ts …` runs Eva from source.
// The published binary is bin/eva.mjs, which runs the packed build instead.
// Both call `run`, so both read `EVA_LOG`.
import { run } from "./index.js"

run()
  .then((code) => process.exit(code))
  .catch((cause: unknown) => {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exit(1)
  })
