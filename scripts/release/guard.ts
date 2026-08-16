#!/usr/bin/env bun
// What only a release can get wrong, asserted on the built artifact: the
// binary's answer, not the manifest's. What ships is what the program says,
// and this is what catches a broken --define. The empty-release refusal
// lives in version.ts, before the bump commit muddies the count.
import { $ } from "bun"
import { DIST, TARGETS, binaryOf, isHost, nameOf, requireVersion } from "./context.js"

const version = requireVersion()

const host = TARGETS.find(isHost)
if (!host) throw new Error(`no build target matches this host`)
const binary = `${DIST}/stage/${nameOf(host)}/${binaryOf(host)}`
const reported = (await $`./${binary} --version`.text()).trim()
if (reported !== version) {
  throw new Error(`the binary reports ${reported}, the release says ${version}`)
}
console.log(`the binary reports ${reported}`)
