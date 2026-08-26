#!/usr/bin/env bun
// Write the npm packages into dist/npm: one package per target holding one
// binary, and the wrapper that names them all as optionalDependencies. This
// writes manifests and copies files; publish.ts is what talks to a registry.
import { copyFileSync, cpSync, mkdirSync, writeFileSync } from "node:fs"
import { DIST, PAGE, REPO, TARGETS, binaryOf, nameOf, requireVersion } from "./context.js"

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
  // The page eva serves sits beside the binary, because that is where the
  // binary looks for it. `files` names `bin`, so it is packed with it.
  cpSync(`${DIST}/stage/${nameOf(target)}/${PAGE}`, `${dir}/bin/${PAGE}`, { recursive: true })
  copyFileSync("LICENSE", `${dir}/LICENSE`)
  // npm packs a README regardless of the files list, so the page is never bare.
  writeFileSync(
    `${dir}/README.md`,
    `# ${name}\n\nThe eva binary for ${nameOf(target).slice(4)}. npm has no per-platform download,\nso [@missingstudio/eva](https://www.npmjs.com/package/@missingstudio/eva) names one binary package per platform as an\noptional dependency, and installing it selects the one that matches your\nmachine. Install that package; this one arrives with it.\n`,
  )
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
copyFileSync("scripts/release/npm-readme.md", `${dir}/README.md`)
writeFileSync(
  `${dir}/package.json`,
  JSON.stringify(
    {
      name: "@missingstudio/eva",
      version,
      description: "An AI-native software factory",
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
