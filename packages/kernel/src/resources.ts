import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { isMapping, leaves } from "./mapping.js"

/**
 * A `.eva` directory holds resources beside its config file, because an
 * agent prompt wants to be a Markdown file rather than a YAML string.
 * Discovery produces the same mapping the config file produces, so one
 * merge law covers both and one origin table names either source.
 */
export interface Resources {
  readonly raw: Record<string, unknown>
  readonly origin: Record<string, string>
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

// A Markdown resource carries its fields in frontmatter and its text after.
const document = (source: string): { data: Record<string, unknown>; body: string } => {
  const found = FRONTMATTER.exec(source)
  if (found === null) return { data: {}, body: source.trim() }
  const parsed: unknown = parse(found[1] ?? "")
  return {
    data: isMapping(parsed) ? parsed : {},
    body: source.slice(found[0].length).trim(),
  }
}

const firstLine = (body: string, fallback: string): string =>
  body
    .split("\n")
    .find((line) => line.trim() !== "")
    ?.trim() ?? fallback

/**
 * One resource directory. Each file is a row keyed by its base name. A
 * directory that is not there holds nothing, which is not an error.
 */
const collect = (
  directory: string,
  extension: string,
  read: (source: string, id: string) => Record<string, unknown>,
): Resources => {
  const raw: Record<string, unknown> = {}
  const origin: Record<string, string> = {}

  let names: readonly string[]
  try {
    names = readdirSync(directory)
      .filter((name) => name.endsWith(extension) && !name.startsWith("."))
      .sort()
  } catch {
    return { raw, origin }
  }

  for (const name of names) {
    const path = join(directory, name)
    const id = name.slice(0, -extension.length)
    const row = read(readFileSync(path, "utf8"), id)
    raw[id] = row
    for (const key of leaves(row)) origin[`${id}.${key}`] = path
  }
  return { raw, origin }
}

const under = (key: string, found: Resources): Resources =>
  Object.keys(found.raw).length === 0
    ? { raw: {}, origin: {} }
    : {
        raw: { [key]: found.raw },
        origin: Object.fromEntries(
          Object.entries(found.origin).map(([path, source]) => [`${key}.${path}`, source]),
        ),
      }

/**
 * Every resource a directory holds, as one mapping. The directories are
 * the concepts the tree has: an agent, a command, and a theme. A directory
 * for a concept that does not exist yet would be structure inviting
 * occupants, so there is none.
 */
export const resources = (directory: string): Resources => {
  const found = [
    under(
      "agents",
      collect(join(directory, "agents"), ".md", (source) => {
        const { data, body } = document(source)
        return { ...data, ...(body === "" ? {} : { prompt: body }) }
      }),
    ),
    under(
      "commands",
      collect(join(directory, "commands"), ".md", (source, id) => {
        const { data, body } = document(source)
        const described = typeof data["description"] === "string"
        return { ...data, ...(described ? {} : { description: firstLine(body, id) }) }
      }),
    ),
    under(
      "themes",
      collect(join(directory, "themes"), ".yaml", (source) => {
        const parsed: unknown = parse(source)
        return isMapping(parsed) ? parsed : {}
      }),
    ),
  ]

  return {
    raw: Object.assign({}, ...found.map((one) => one.raw)) as Record<string, unknown>,
    origin: Object.assign({}, ...found.map((one) => one.origin)) as Record<string, string>,
  }
}
