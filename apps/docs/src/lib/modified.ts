import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import process from "node:process"

/**
 * When each documentation page last changed, according to git.
 *
 * The collection declared `lastModified: true` and it resolved to nothing for
 * every page, so the sitemap shipped without a single date. The date is read
 * here instead, from the one authority that has it.
 *
 * A date from git and not from the build clock. A sitemap claiming every page
 * changed on every deploy teaches a crawler to ignore its own dates, which
 * costs more than having none — so a date that cannot be established is left
 * out rather than guessed, and the omission is reported once.
 *
 * This runs in the build and in `vite dev`, never in a deployed request: both
 * sites are static files, and the two readers are a prerendered route and a
 * server function the prerender calls.
 */

/**
 * Where the content is, resolved from the working directory rather than from
 * `import.meta.url`. The bundler moves this module into a chunk whose depth is
 * its own business, and a path relative to the module's own URL was silently
 * wrong in the build while working in every test.
 */
const contentDirectory = () => {
  const fromCwd = path.resolve(process.cwd(), "content/docs")
  if (existsSync(fromCwd)) return fromCwd

  // A build run from the repository root rather than from the app.
  const fromRoot = path.resolve(process.cwd(), "apps/docs/content/docs")
  return existsSync(fromRoot) ? fromRoot : undefined
}

const read = (): Map<string, string> => {
  const dates = new Map<string, string>()
  const content = contentDirectory()

  if (!content) {
    console.warn("modified: no content directory found, so no page carries a date")
    return dates
  }

  let log: string

  try {
    // One pass over the history, newest first, so the first commit that names
    // a file is the one that last changed it.
    log = execFileSync(
      "git",
      ["-c", "core.quotepath=off", "log", "--format=commit:%aI", "--name-only", "--", content],
      { cwd: content, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    )
  } catch {
    // No git, or a clone with no history. Not a reason to fail a build.
    console.warn("modified: git could not be read, so no page carries a date")
    return dates
  }

  let date: string | undefined

  for (const line of log.split("\n")) {
    if (line.startsWith("commit:")) {
      date = line.slice("commit:".length).trim()
      continue
    }

    if (line.length === 0 || !date) continue

    const slug = line.replace(/^.*content\/docs\//, "").replace(/\.mdx$/, "")
    if (!dates.has(slug)) dates.set(slug, date)
  }

  if (dates.size === 0) {
    console.warn("modified: git named no content file, so no page carries a date")
  }

  return dates
}

let cached: Map<string, string> | undefined

/** The day a page last changed, as `YYYY-MM-DD`, or nothing if git cannot say. */
export const modifiedOn = (url: string): string | undefined => {
  cached ??= read()

  const slug = url === "/" ? "index" : url.replace(/^\//, "")
  const date = cached.get(slug)

  return date ? new Date(date).toISOString().slice(0, 10) : undefined
}
