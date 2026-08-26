import { readFileSync } from "node:fs"
import { decodeLine } from "./codec.js"
import type { Event } from "./event.js"

/**
 * Reads one file of encoded Events, one per line, blank lines dropped.
 * This is the codec reading its own bytes back, which is why it lives here
 * and refuses nothing: a fixture or a golden that will not decode is a
 * test failure worth seeing whole.
 *
 * How a Trace is laid out on disk — one file, or a directory of them, or a
 * tear at the end of one — is not the codec's question. `readArchive` in
 * core owns that.
 */
export const readTrace = (path: string): readonly Event[] =>
  readFileSync(path, "utf8").split("\n").filter(Boolean).map(decodeLine)

// The exact bytes a golden file holds, so a generator and the test that
// replays it cannot drift apart on formatting.
export const writtenGolden = (golden: unknown): string => JSON.stringify(golden, null, 2) + "\n"
