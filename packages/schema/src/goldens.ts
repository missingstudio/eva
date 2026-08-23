import { readFileSync } from "node:fs"
import { decodeLine } from "./codec.js"
import type { Event } from "./event.js"

/**
 * Reads one Trace file: one encoded Event per line, blank lines dropped.
 * Every fixture pipeline and every golden test reads a Trace this way, and
 * the read was spelled at four sites before it lived here.
 */
export const readTrace = (path: string): readonly Event[] =>
  readFileSync(path, "utf8").split("\n").filter(Boolean).map(decodeLine)

// The exact bytes a golden file holds, so a generator and the test that
// replays it cannot drift apart on formatting.
export const writtenGolden = (golden: unknown): string => JSON.stringify(golden, null, 2) + "\n"
