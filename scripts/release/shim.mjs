#!/usr/bin/env node
// The wrapper package's bin. It resolves the one platform package the
// installer's package manager chose from optionalDependencies and runs its
// binary. No postinstall, so --ignore-scripts installs still work.
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"

const os = process.platform === "win32" ? "windows" : process.platform
const name = `@missingstudio/eva-${os}-${process.arch}`
const binary = os === "windows" ? "eva.exe" : "eva"

let resolved
try {
  resolved = createRequire(import.meta.url).resolve(`${name}/bin/${binary}`)
} catch {
  process.stderr.write(
    `eva: no prebuilt binary for ${os}-${process.arch}.\n` +
      `Install from https://github.com/missingstudio/eva/releases instead.\n`,
  )
  process.exit(1)
}

const result = spawnSync(resolved, process.argv.slice(2), { stdio: "inherit" })
process.exit(result.status ?? 1)
