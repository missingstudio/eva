#!/usr/bin/env bun
// Compile every target, archive each one, and write the checksums. Everything
// lands in dist/ and nothing here publishes.
import { $ } from "bun"
import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { DIST, TARGETS, archiveOf, binaryOf, isHost, nameOf, requireVersion } from "./context.js"

const version = requireVersion()

rmSync(DIST, { recursive: true, force: true })
mkdirSync(DIST, { recursive: true })

// OpenTUI's renderer is one prebuilt package per platform, and the compiler
// can only embed what is installed. This adds every platform's package and
// changes no manifest and no lockfile.
await $`bun install --os="*" --cpu="*" --frozen-lockfile`.quiet()

for (const target of TARGETS) {
  const name = nameOf(target)
  const binary = binaryOf(target)
  const stage = `${DIST}/stage/${name}`
  mkdirSync(stage, { recursive: true })

  // The version is injected because a compiled binary has no manifest to
  // read. apps/cli/src/version.ts prefers the injected value.
  const bunTarget = `bun-${target.os}-${target.arch}`
  await $`bun build --compile --minify --target=${bunTarget} --define ${`EVA_VERSION="${version}"`} --outfile ${stage}/eva apps/cli/src/eva.ts`.quiet()

  // "It compiled" is not "it starts": every target the host can execute is
  // asked for its version before it is archived.
  if (isHost(target)) {
    const reported = (await $`./${stage}/${binary} --version`.text()).trim()
    if (reported !== version) {
      throw new Error(`${name} reports ${reported}, expected ${version}`)
    }
    await $`./${stage}/${binary} --help`.quiet()
    console.log(`smoke test passed: ${name} reports ${reported}`)
  }

  copyFileSync("LICENSE", `${stage}/LICENSE`)
  if (target.os === "linux") {
    await $`tar -czf ${DIST}/${archiveOf(target)} -C ${stage} ${binary} LICENSE`.quiet()
  } else {
    await $`zip -j -q ${DIST}/${archiveOf(target)} ${stage}/${binary} ${stage}/LICENSE`.quiet()
  }
  console.log(`built ${archiveOf(target)}`)
}

const checksums = TARGETS.map((target) => {
  const archive = archiveOf(target)
  const digest = createHash("sha256")
    .update(readFileSync(`${DIST}/${archive}`))
    .digest("hex")
  return `${digest}  ${archive}`
})
writeFileSync(`${DIST}/checksums.txt`, checksums.join("\n") + "\n")
console.log(`wrote checksums.txt`)
