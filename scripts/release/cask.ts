#!/usr/bin/env bun
// Write the Homebrew cask into dist/homebrew/Casks. The rehearsal reads this
// file to catch a wrong archive name before a release does; publish.ts is
// what pushes it to the tap.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { DIST, REPO, requireVersion } from "./context.js"

const version = requireVersion()

const checksums = new Map(
  readFileSync(`${DIST}/checksums.txt`, "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const [digest, archive] = line.split(/\s+/) as [string, string]
      return [archive, digest] as const
    }),
)

const sha = (archive: string): string => {
  const digest = checksums.get(archive)
  if (!digest) throw new Error(`${archive} is not in checksums.txt`)
  return digest
}

// The binary is not notarized, so the cask clears quarantine on install.
// That gap is named in docs/reference/ci-cd.md §9.
const cask = `cask "eva" do
  version "${version}"

  arch arm: "arm64", intel: "x64"
  sha256 arm:   "${sha("eva-darwin-arm64.zip")}",
         intel: "${sha("eva-darwin-x64.zip")}"

  url "https://github.com/${REPO}/releases/download/v#{version}/eva-darwin-#{arch}.zip"
  name "Eva"
  desc "An AI-native software factory"
  homepage "https://github.com/${REPO}"

  binary "eva"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{staged_path}/eva"]
  end
end
`

mkdirSync(`${DIST}/homebrew/Casks`, { recursive: true })
writeFileSync(`${DIST}/homebrew/Casks/eva.rb`, cask)
console.log(`wrote homebrew/Casks/eva.rb`)
