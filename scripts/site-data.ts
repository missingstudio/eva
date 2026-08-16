/**
 * Fetch the live numbers the marketing site shows, and write them into the
 * bundle at build time.
 *
 * Nothing here runs in the browser. A page built this way renders correctly
 * with JavaScript disabled and can never be more than one deploy stale. The
 * written file is committed as a fallback, so a rate-limited or offline build
 * produces slightly old numbers rather than a hole or a failure.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("../", import.meta.url))
const target = `${repoRoot}apps/web/src/lib/site-data.json`
const repo = "missingstudio/eva"

const version = (): string => {
  const manifest = JSON.parse(readFileSync(`${repoRoot}apps/cli/package.json`, "utf8"))
  return manifest.version
}

const stars = async (): Promise<number | null> => {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { accept: "application/vnd.github+json" },
    })
    if (!response.ok) return null

    const body = (await response.json()) as { stargazers_count?: number }
    return body.stargazers_count ?? null
  } catch {
    return null
  }
}

const previous = JSON.parse(readFileSync(target, "utf8")) as { stars: number | null }
const fetched = await stars()

const data = {
  version: version(),
  // Keep the last known count rather than blanking the page when the API
  // refuses us.
  stars: fetched ?? previous.stars,
  fetchedAt: fetched === null ? null : new Date().toISOString(),
}

writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`)
console.log(`site-data: version ${data.version}, stars ${data.stars ?? "unknown"}`)
