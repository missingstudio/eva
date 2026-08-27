/**
 * A static host for a built site, with the parts of `vercel.json` the sites
 * depend on: rewrites conditioned on a header or a query, and response
 * headers.
 *
 * This is not Vercel, and it does not claim to be. It exists so
 * `scripts/agent-ready.ts` can run the whole matrix before a deploy rather
 * than after one — which catches the two mistakes that config makes most
 * often: a destination naming a file the build does not write, and a pattern
 * that never matches. The deployed site still has to be checked with the same
 * script, because only the deployed site proves the host agrees.
 *
 * Usage:
 *   bun scripts/serve-static.ts apps/www 3000
 */

import { existsSync, readFileSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { join, resolve } from "node:path"
import process from "node:process"
// A path into the ui package rather than its name: `scripts/` is not a
// workspace package, so a bare specifier does not resolve here.
import { json, markdown, plain, xml } from "../packages/machine/src/serve.js"

const [app, port = "3000"] = process.argv.slice(2)

if (!app) {
  console.error("usage: bun scripts/serve-static.ts <app directory> [port]")
  process.exit(1)
}

const root = resolve(app)
const client = join(root, "dist/client")

type Rule = {
  source: string
  destination?: string
  has?: { type: "header" | "query"; key: string; value?: string }[]
  headers?: { key: string; value: string }[]
}

const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
  rewrites?: Rule[]
  headers?: Rule[]
}

/**
 * A Vercel source pattern as a regular expression. Only the forms the two
 * sites use are supported: `:name(a|b)`, `:name`, `:name+`, `:name*`, and an
 * unnamed `(.*)`. A dot in a pattern is a literal dot.
 */
const patternOf = (source: string) => {
  let expression = ""
  let index = 0

  while (index < source.length) {
    const rest = source.slice(index)

    const unnamed = rest.match(/^\(\.\*\)/)
    if (unnamed) {
      expression += "(.*)"
      index += unnamed[0].length
      continue
    }

    const named = rest.match(/^:([a-zA-Z]+)(?:\(([^)]+)\)|(\+)|(\*))?/)
    if (named) {
      const [whole, name, alternatives, plus, star] = named
      const body = alternatives ?? (plus ? ".+" : star ? ".*" : "[^/]+")
      expression += `(?<${name}>${body})`
      index += whole.length
      continue
    }

    expression += source[index]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    index += 1
  }

  return new RegExp(`^${expression}$`)
}

const compiled = {
  rewrites: (config.rewrites ?? []).map((rule) => ({ ...rule, pattern: patternOf(rule.source) })),
  headers: (config.headers ?? []).map((rule) => ({ ...rule, pattern: patternOf(rule.source) })),
}

const satisfies = (rule: Rule, header: (name: string) => string, url: URL) =>
  (rule.has ?? []).every((condition) => {
    const actual =
      condition.type === "header"
        ? header(condition.key)
        : (url.searchParams.get(condition.key) ?? "")

    if (actual === "") return false
    if (!condition.value) return true

    return new RegExp(condition.value).test(actual)
  })

/** `:name` in a destination or a header value, filled from the match. */
const fill = (template: string, groups: Record<string, string | undefined>) =>
  template.replace(/:([a-zA-Z]+)[+*]?/g, (whole, name: string) => groups[name] ?? whole)

/** What a route answers with, so this host cannot answer with something else. */
const stated = (response: Response) => response.headers.get("content-type")!

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  // The four the routes state. Read from the module that states them, because
  // a local host that answers a different type proves the wrong thing.
  ".md": stated(markdown("")),
  ".txt": stated(plain("")),
  ".xml": stated(xml("")),
  ".json": stated(json({})),
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".sh": "text/x-shellscript; charset=utf-8",
  ".webmanifest": "application/manifest+json",
}

const typeOf = (path: string) => {
  const dot = path.lastIndexOf(".")
  return (dot === -1 ? undefined : types[path.slice(dot)]) ?? "application/octet-stream"
}

/** The file a path names, the way static hosting resolves one. */
const fileFor = (pathname: string) => {
  const candidate = join(client, decodeURIComponent(pathname))

  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate

  const index = join(candidate, "index.html")
  if (existsSync(index)) return index

  return undefined
}

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`)
  const asked = url.pathname
  let pathname = asked

  const header = (name: string) => {
    const value = request.headers[name.toLowerCase()]
    return Array.isArray(value) ? value.join(", ") : (value ?? "")
  }

  for (const rule of compiled.rewrites) {
    const match = rule.pattern.exec(pathname)
    if (!match || !rule.destination) continue
    if (!satisfies(rule, header, url)) continue

    pathname = fill(rule.destination, match.groups ?? {}).replace(/\/{2,}/g, "/")
    break
  }

  const file = fileFor(pathname)

  if (!file) {
    const notFound = join(client, "404.html")
    const body = existsSync(notFound) ? readFileSync(notFound) : "Not found\n"
    response.writeHead(404, { "content-type": "text/html; charset=utf-8" })
    response.end(body)
    return
  }

  const headers: Record<string, string> = { "content-type": typeOf(file) }

  // Header rules read the requested path, not the rewritten one, which is how
  // a negotiated page still carries the `Vary` that made it negotiable.
  for (const rule of compiled.headers) {
    const match = rule.pattern.exec(asked)
    if (!match) continue

    for (const entry of rule.headers ?? []) {
      headers[entry.key] = fill(entry.value, match.groups ?? {})
    }
  }

  response.writeHead(200, headers)
  response.end(readFileSync(file))
}).listen(Number(port), () => {
  console.log(`Serving ${client} on http://localhost:${port}`)
})
