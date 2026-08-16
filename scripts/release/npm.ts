#!/usr/bin/env bun
// Write the npm packages into dist/npm: one package per target holding one
// binary, and the wrapper that names them all as optionalDependencies. This
// writes manifests and copies files; publish.ts is what talks to a registry.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs"
import { DIST, REPO, TARGETS, binaryOf, nameOf, requireVersion } from "./context.js"

const version = requireVersion()
const license = "MIT"
const repository = { type: "git", url: `git+https://github.com/${REPO}.git` }

const platformPackages: Record<string, string> = {}

for (const target of TARGETS) {
  const name = `@missingstudio/${nameOf(target)}`
  const dir = `${DIST}/npm/${nameOf(target)}`
  platformPackages[name] = version

  mkdirSync(`${dir}/bin`, { recursive: true })
  copyFileSync(
    `${DIST}/stage/${nameOf(target)}/${binaryOf(target)}`,
    `${dir}/bin/${binaryOf(target)}`,
  )
  copyFileSync("LICENSE", `${dir}/LICENSE`)
  writeFileSync(
    `${dir}/package.json`,
    JSON.stringify(
      {
        name,
        version,
        description: `The eva binary for ${nameOf(target).slice(4)}`,
        license,
        repository,
        // npm spells Windows win32, and the package name spells it windows —
        // the name is ours, the field is npm's.
        os: [target.os === "windows" ? "win32" : target.os],
        cpu: [target.arch],
        files: ["bin"],
      },
      null,
      2,
    ) + "\n",
  )
}

const dir = `${DIST}/npm/eva`
mkdirSync(`${dir}/bin`, { recursive: true })
copyFileSync("scripts/release/shim.mjs", `${dir}/bin/eva.mjs`)
copyFileSync("LICENSE", `${dir}/LICENSE`)
writeFileSync(
  `${dir}/package.json`,
  JSON.stringify(
    {
      name: "@missingstudio/eva",
      version,
      description: "An autonomous, AI-native software factory",
      license,
      repository,
      bin: { eva: "./bin/eva.mjs" },
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
      optionalDependencies: platformPackages,
    },
    null,
    2,
  ) + "\n",
)

console.log(`wrote ${TARGETS.length + 1} npm packages to ${DIST}/npm`)
