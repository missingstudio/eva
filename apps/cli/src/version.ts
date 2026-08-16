import { readFileSync } from "node:fs"

// The release build injects the version with --define, because a compiled
// binary carries no manifest to read.
declare const EVA_VERSION: string | undefined

// The manifest sits one directory above both src/ and dist/, so the same
// lookup answers from source and from the packed build.
const read = (): string => {
  try {
    const source = readFileSync(new URL("../package.json", import.meta.url), "utf8")
    const parsed: unknown = JSON.parse(source)
    const version = (parsed as Record<string, unknown>)["version"]
    return typeof version === "string" ? version : "0.0.0"
  } catch {
    return "0.0.0"
  }
}

export const VERSION = typeof EVA_VERSION === "string" ? EVA_VERSION : read()
