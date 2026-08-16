#!/usr/bin/env bun
// Finish the publish of a release that already exists. The release job is
// not re-enterable — a tag that exists is a release that already happened —
// so a failed publish is completed here: download the release's own assets,
// prove them against checksums.txt, rebuild the packages from those bytes,
// and let publish.ts fill only what is missing.
import { $ } from "bun"
import { DIST, TARGETS, archiveOf, nameOf, requireVersion } from "./context.js"

const version = requireVersion()

await $`rm -rf ${DIST}`
await $`mkdir -p ${DIST}`
await $`gh release download v${version} -D ${DIST} ${["-p", "*.zip", "-p", "*.tar.gz", "-p", "checksums.txt"]}`
await $`shasum -a 256 -c checksums.txt`.cwd(DIST).quiet()

for (const target of TARGETS) {
  const stage = `${DIST}/stage/${nameOf(target)}`
  const archive = `${DIST}/${archiveOf(target)}`
  await $`mkdir -p ${stage}`
  if (archive.endsWith(".tar.gz")) {
    await $`tar -xzf ${archive} -C ${stage}`
  } else {
    await $`unzip -oq ${archive} -d ${stage}`
  }
}

await $`bun scripts/release/npm.ts`
await $`bun scripts/release/cask.ts`
await $`bun scripts/release/publish.ts`
