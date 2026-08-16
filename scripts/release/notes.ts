#!/usr/bin/env bun
// Fold the commits since the previous stable tag into release notes, grouped
// by the prefixes AGENTS.md requires. A commit without a matching prefix is
// omitted silently — the fold cannot group what does not match.
import { mkdirSync, writeFileSync } from "node:fs"
import { DIST, REPO, git, previousStableTag } from "./context.js"

// The previous stable tag, never a candidate: notes for v0.3.0 released after
// v0.3.0-rc.1 must carry everything the candidate already carried.
const previous = previousStableTag()
const range = previous ? `${previous}..HEAD` : "HEAD"
const subjects = git("log", range, "--pretty=%s").split("\n").filter(Boolean)

const groups: [title: string, test: (subject: string) => boolean][] = [
  ["Breaking", (s) => /^\w+(\([^)]+\))?!:/.test(s)],
  ["Added", (s) => /^feat(\([^)]+\))?:/.test(s)],
  ["Fixed", (s) => /^fix(\([^)]+\))?:/.test(s)],
  ["Changed", (s) => /^(refactor|perf)(\([^)]+\))?:/.test(s)],
]

const taken = new Set<string>()
const sections = groups.flatMap(([title, test]) => {
  const lines = subjects.filter((s) => !taken.has(s) && test(s))
  for (const line of lines) taken.add(line)
  if (lines.length === 0) return []
  return [`## ${title}\n\n${lines.map((line) => `- ${line}`).join("\n")}`]
})

const verify = `---

## Verify what you downloaded

\`\`\`sh
sha256sum --check --ignore-missing checksums.txt
\`\`\`

The checksums are signed, and each archive carries a provenance attestation:
\`gh attestation verify <archive> --repo ${REPO}\`.`

const body = sections.length === 0 ? "No notable changes." : sections.join("\n\n")

mkdirSync(DIST, { recursive: true })
writeFileSync(`${DIST}/notes.md`, `${body}\n\n${verify}\n`)
console.log(`wrote notes.md (${subjects.length} commits since ${previous ?? "the beginning"})`)
