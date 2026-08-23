#!/usr/bin/env node
// The binary runs the packed build. In the workspace, run the source with
// `bun apps/cli/src/eva.ts` instead.
import { run } from "../dist/index.mjs"

run()
  .then((code) => process.exit(code))
  .catch((cause) => {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exit(1)
  })
