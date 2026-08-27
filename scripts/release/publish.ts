#!/usr/bin/env bun
// Publish what build.ts, npm.ts, and cask.ts produced. Order: npm, then the
// tap — the tap is last so an expired tap token leaves a public release and a
// stale tap rather than a failed release. Every step skips what is already
// published, so a re-run fills only what is missing.
import { $ } from "bun"
import { readdirSync, readFileSync } from "node:fs"
import { DIST, requireVersion } from "./context.js"

// Publishing needs the release workflow's OIDC identity and its tokens.
// A desk has neither, and should not.
if (process.env["GITHUB_ACTIONS"] !== "true") {
  throw new Error("publish.ts runs in the release workflow — rehearse with snapshot.ts")
}

const version = requireVersion()

// A prerelease publishes under next, and never becomes latest.
const channel = version.includes("-") ? "next" : "latest"

// Platform packages first: the wrapper names them as optionalDependencies,
// so it must never be resolvable before they are.
const dirs = readdirSync(`${DIST}/npm`).sort((a, b) =>
  a === "eva" ? 1 : b === "eva" ? -1 : a.localeCompare(b),
)
for (const dir of dirs) {
  const manifest = JSON.parse(readFileSync(`${DIST}/npm/${dir}/package.json`, "utf8")) as {
    name: string
  }
  const name = manifest.name
  const published = await $`npm view ${`${name}@${version}`} version`.quiet().nothrow()
  if (published.exitCode === 0) {
    console.log(`already published ${name}@${version}`)
    continue
  }
  await $`npm publish --access public --tag ${channel} --provenance`.cwd(`${DIST}/npm/${dir}`)
  console.log(`published ${name}@${version} (${channel})`)
}

// The tap holds the stable channel only, by the same fact that decides the
// npm dist-tag rather than by a second setting.
if (channel === "latest") {
  const token = process.env["HOMEBREW_TAP_TOKEN"]
  if (!token) throw new Error("HOMEBREW_TAP_TOKEN is not set")

  const tap = `https://x-access-token:${token}@github.com/missingstudio/homebrew-tap.git`
  await $`rm -rf ${DIST}/tap`
  await $`git clone --depth 1 ${tap} ${DIST}/tap`.quiet()
  await $`mkdir -p ${DIST}/tap/Casks`
  await $`cp ${DIST}/homebrew/Casks/eva.rb ${DIST}/tap/Casks/eva.rb`
  await $`git -C ${DIST}/tap add Casks/eva.rb`
  const changed = await $`git -C ${DIST}/tap status --porcelain`.text()
  if (changed.trim() === "") {
    console.log("the tap already carries this cask")
  } else {
    await $`git -C ${DIST}/tap -c user.name=eva-release -c user.email=eva@evafactory.co commit -m ${`eva ${version}`}`.quiet()
    await $`git -C ${DIST}/tap push`.quiet()
    console.log(`pushed eva.rb to the tap`)
  }
}
