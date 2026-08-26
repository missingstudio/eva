#!/usr/bin/env bun
// Compile every target, archive each one, and write the checksums. Everything
// lands in dist/ and nothing here publishes.
import { $ } from "bun"
import { spawn, type ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  BUILT_PAGE,
  DIST,
  PAGE,
  TARGETS,
  archiveOf,
  binaryOf,
  isHost,
  nameOf,
  requireVersion,
  type Target,
} from "./context.js"

const version = requireVersion()

/**
 * The address the surface bound to, read from what it said. The port asked for
 * is 0, so the machine picks a free one and the binary is the only thing that
 * knows which. A stream that ends said no address at all.
 */
const boundURL = async (server: ChildProcess): Promise<string> => {
  let said = ""
  for await (const chunk of server.stdout ?? []) {
    said += String(chunk)
    const found = /http:\/\/\S+/.exec(said)
    if (found !== null) return found[0]
  }
  throw new Error(`the binary bound nothing and said: ${said.trim()}`)
}

/**
 * The page, asked for over a real socket. The page travels beside the binary
 * as files, and files that did not travel look exactly like a build nobody
 * ran — so the bundle the page names is fetched too: an archive that flattens
 * the tree serves the HTML and 404s everything it asks for.
 */
const servesThePage = async (binary: string): Promise<void> => {
  const server = spawn(binary, ["serve", "--web", "--port", "0"], {
    stdio: ["ignore", "pipe", "inherit"],
  })
  try {
    const url = await boundURL(server)
    const page = await fetch(url)
    const html = await page.text()
    if (page.status !== 200 || html !== readFileSync(`${BUILT_PAGE}/index.html`, "utf8")) {
      throw new Error(`the page answered ${page.status}: ${html.trim().slice(0, 120)}`)
    }

    const named = /src="([^"]+)"/.exec(html)
    if (named === null) throw new Error(`the page names no bundle`)
    const bundle = await fetch(`${url}${named[1]}`)
    if (bundle.status !== 200) throw new Error(`${named[1]} answered ${bundle.status}`)
  } finally {
    server.kill()
  }
}

/**
 * What ships, proved on what ships: the archive is unpacked and the binary
 * inside it is asked for its version, its help, and the page. The staged
 * binary would prove the compile and nothing else — only the unpacked archive
 * proves that the page travelled with it.
 */
const smokeTest = async (target: Target): Promise<void> => {
  const name = nameOf(target)
  const opened = `${DIST}/smoke/${name}`
  mkdirSync(opened, { recursive: true })
  if (target.os === "linux") {
    await $`tar -xzf ${DIST}/${archiveOf(target)} -C ${opened}`.quiet()
  } else {
    await $`unzip -oq ${DIST}/${archiveOf(target)} -d ${opened}`.quiet()
  }

  const binary = `${opened}/${binaryOf(target)}`
  const reported = (await $`./${binary} --version`.text()).trim()
  if (reported !== version) {
    throw new Error(`${name} reports ${reported}, expected ${version}`)
  }
  await $`./${binary} --help`.quiet()
  await servesThePage(resolve(binary))
  console.log(`smoke test passed: ${name} reports ${reported} and serves the page`)
}

rmSync(DIST, { recursive: true, force: true })
mkdirSync(DIST, { recursive: true })

// OpenTUI's renderer is one prebuilt package per platform, and the compiler
// can only embed what is installed. This adds every platform's package and
// changes no manifest and no lockfile.
await $`bun install --os="*" --cpu="*" --frozen-lockfile`.quiet()

// The page `eva.web` serves. It is built once and copied into every target,
// because it is the same bytes on every machine — and a release that skipped
// this build would answer every browser with the "no built page" notice.
await $`bun run --cwd apps/web build`.quiet()

for (const target of TARGETS) {
  const name = nameOf(target)
  const binary = binaryOf(target)
  const stage = `${DIST}/stage/${name}`
  mkdirSync(stage, { recursive: true })

  // The version is injected because a compiled binary has no manifest to
  // read. apps/cli/src/version.ts prefers the injected value.
  const bunTarget = `bun-${target.os}-${target.arch}`
  await $`bun build --compile --minify --target=${bunTarget} --define ${`EVA_VERSION="${version}"`} --outfile ${stage}/eva apps/cli/src/eva.ts`.quiet()

  copyFileSync("LICENSE", `${stage}/LICENSE`)
  // The page is a directory, so the zip may not junk paths: `-j` would flatten
  // the bundle into the archive root and serve a page that names nothing.
  cpSync(BUILT_PAGE, `${stage}/${PAGE}`, { recursive: true })
  if (target.os === "linux") {
    await $`tar -czf ${DIST}/${archiveOf(target)} -C ${stage} ${binary} LICENSE ${PAGE}`.quiet()
  } else {
    await $`zip -r -q ${resolve(DIST, archiveOf(target))} ${binary} LICENSE ${PAGE}`
      .cwd(stage)
      .quiet()
  }

  // "It compiled" is not "it starts", and "it starts" is not "it serves":
  // every target the host can execute is asked all three.
  if (isHost(target)) await smokeTest(target)
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
