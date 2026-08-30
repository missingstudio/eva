import { existsSync, statSync } from "node:fs"
import { basename, extname, resolve, sep } from "node:path"

/**
 * The media types the build emits, and no others. A type nothing serves is a
 * type nobody has to keep right, and an unknown extension is answered as
 * bytes rather than guessed at.
 */
const TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/vnd.microsoft.icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
}

export const mediaType = (path: string): string =>
  TYPES[extname(path).toLowerCase()] ?? "application/octet-stream"

const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile()

// Whether a build has left a page here at all.
export const hasPage = (root: string): boolean => isFile(resolve(root, "index.html"))

/**
 * Whether this process runs from the source tree. A compiled binary is its own
 * executable; from source the executable is the runtime that reads the tree.
 */
export const fromSource = (executable: string): boolean =>
  RUNTIMES.includes(basename(executable, extname(executable)))

// The executables a source run has. Anything else is a build somebody
// installed, which carries no workspace and no build tool.
const RUNTIMES: readonly string[] = ["bun", "node"]

/**
 * A build that has not run, said plainly and with the step that fixes it.
 * `eva.web` serves assets it did not build, so an empty tree is a step
 * nobody took — and a surface that answers every request with 404 reads as
 * broken rather than unbuilt.
 *
 * The build command is named only to a person who has it. Somebody who
 * installed a binary has no workspace to run it in, so they are told what
 * this build carries instead of a command that cannot work.
 */
export const unbuilt = (root: string, executable: string = process.execPath): string =>
  fromSource(executable)
    ? `no built page at ${root}; run \`vp run -r build\``
    : `no built page at ${root}; this build carries no page, so use the terminal`

// The request path, with the query and the fragment off it. A path that is
// not valid percent-encoding is not a path this tree holds.
const pathOf = (url: string): string | undefined => {
  try {
    const decoded = decodeURIComponent(new URL(url, "http://eva.invalid").pathname)
    return decoded.includes("\0") ? undefined : decoded
  } catch {
    return undefined
  }
}

/**
 * The file a request is answered with, or nothing when this tree holds none.
 *
 * A path with no extension belongs to the router, so it is answered with the
 * page and the page routes it. A path that names a file and has none is a
 * miss: a script request answered with HTML reads as a broken bundle, which
 * is a much worse report than a miss.
 */
export const assetFor = (root: string, url: string): string | undefined => {
  const asked = pathOf(url)
  if (asked === undefined) return undefined

  // Resolved first and checked after, because `..` in a request is the one
  // way a static server hands out the whole disk.
  const found = resolve(root, `.${asked === "/" ? "/index.html" : asked}`)
  if (!found.startsWith(`${resolve(root)}${sep}`)) return undefined
  if (isFile(found)) return found
  if (extname(asked) !== "") return undefined

  const page = resolve(root, "index.html")
  return isFile(page) ? page : undefined
}
