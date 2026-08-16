#!/usr/bin/env bun
// The release path, run without a dispatch: build every target, archive,
// checksum, write the cask and the npm packages, publish nothing. It needs no
// token and no tag, so a broken release path is caught at a desk or on a pull
// request rather than on the run where finishing matters most.
import { $ } from "bun"
import { DIST } from "./context.js"

const env = { ...process.env, EVA_VERSION: process.env["EVA_VERSION"] ?? "0.0.0-snapshot" }

await $`bun scripts/release/build.ts`.env(env)
await $`bun scripts/release/guard.ts`.env(env)
await $`bun scripts/release/npm.ts`.env(env)
await $`bun scripts/release/cask.ts`.env(env)
await $`bun scripts/release/notes.ts`.env(env)

// The installer, against the build it just made. This is what asserts the
// archive names install.sh derives and the ones build.ts wrote agree.
await $`sh scripts/install.sh --from-dist ${DIST} --dir ${DIST}/install-test`.env(env)

console.log(`\nrehearsed ${env.EVA_VERSION} into ${DIST}/ — nothing was published`)
