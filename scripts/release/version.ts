#!/usr/bin/env bun
// Compute the version a dispatch asked for. EVA_INPUT_VERSION names it
// outright; EVA_BUMP derives it from the previous stable tag. The answer goes
// to GITHUB_OUTPUT as version=, and to stdout for a person.
import { appendFileSync } from "node:fs"
import { git, previousStableTag } from "./context.js"

const explicit = process.env["EVA_INPUT_VERSION"]
const bump = process.env["EVA_BUMP"]

let version: string

if (explicit) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(explicit)) {
    throw new Error(`not a version: ${explicit}`)
  }
  version = explicit
} else if (bump === "major" || bump === "minor" || bump === "patch") {
  const previous = previousStableTag()
  if (!previous) throw new Error("no previous tag to bump — give an explicit version")
  const [major, minor, patch] = previous.slice(1).split(".").map(Number) as [number, number, number]
  version =
    bump === "major"
      ? `${major + 1}.0.0`
      : bump === "minor"
        ? `${major}.${minor + 1}.0`
        : `${major}.${minor}.${patch + 1}`
} else {
  throw new Error("set EVA_BUMP to major, minor, or patch — or EVA_INPUT_VERSION")
}

// A tag that already exists is a release that already happened.
if (git("tag", "--list", `v${version}`) !== "") {
  throw new Error(`v${version} is already tagged`)
}

// An empty release is a mistake being published. This runs before the bump
// commit exists, so the count is the release's own content.
const previous = previousStableTag()
if (previous && Number(git("rev-list", "--count", `${previous}..HEAD`)) === 0) {
  throw new Error(`no commits since ${previous}`)
}

const out = process.env["GITHUB_OUTPUT"]
if (out) appendFileSync(out, `version=${version}\n`)
process.stdout.write(`${version}\n`)
