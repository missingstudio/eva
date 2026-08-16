// What every release script shares: the targets, the names, and the git
// answers. The names here are the public contract — an archive name is what
// the install script, the cask, and the npm packages all resolve by.
import { execFileSync } from "node:child_process"

export type Target = { os: "darwin" | "linux" | "windows"; arch: "arm64" | "x64" }

export const TARGETS: Target[] = [
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "windows", arch: "x64" },
]

export const REPO = "missingstudio/eva"
export const DIST = "dist"

export const nameOf = (t: Target): string => `eva-${t.os}-${t.arch}`

// Linux archives are tar.gz and the rest are zip: tar is what Linux hands
// unpack by habit, zip is what macOS and Windows open without a flag.
export const archiveOf = (t: Target): string =>
  t.os === "linux" ? `${nameOf(t)}.tar.gz` : `${nameOf(t)}.zip`

export const binaryOf = (t: Target): string => (t.os === "windows" ? "eva.exe" : "eva")

export const isHost = (t: Target): boolean => {
  const os = process.platform === "win32" ? "windows" : process.platform
  return os === t.os && process.arch === t.arch
}

export const git = (...args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8" }).trim()

// The previous stable tag: vX.Y.Z exactly, so a release candidate never
// becomes the baseline a changelog or a bump is measured from.
export const previousStableTag = (): string | undefined => {
  const tags = git("tag", "--list", "v*")
    .split("\n")
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    .sort((a, b) => {
      const pa = a.slice(1).split(".").map(Number)
      const pb = b.slice(1).split(".").map(Number)
      return pa[0]! - pb[0]! || pa[1]! - pb[1]! || pa[2]! - pb[2]!
    })
  return tags.at(-1)
}

export const requireVersion = (): string => {
  const version = process.env["EVA_VERSION"]
  if (!version) throw new Error("EVA_VERSION is not set")
  return version
}
