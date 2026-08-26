import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { decodeLine, type Event } from "@missingstudio/eva-schema"

/**
 * A Trace as portable JSONL — the shape it crosses a machine boundary in,
 * and the one place that knows how to read it back. A Trace on disk is
 * either one file of encoded Events or a directory of per-Session files;
 * both are read here, so nothing else has to ask which it is holding.
 *
 * This owns reading. Writing an archive with its manifest is S2's export,
 * and it belongs here when it lands.
 */

export const SUFFIX = ".jsonl"

// A Trace file as text. A path with nothing at it is an empty Trace, which
// is what an unopened Session and a fresh install both look like.
export const traceText = (path: string): string => {
  try {
    return readFileSync(path, "utf8")
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return ""
    throw cause
  }
}

/**
 * The whole records in one file's text, in file order. The walk stops at
 * the first line it cannot decode and keeps everything before it: a killed
 * process leaves a half-written last line, and every record ahead of it is
 * still the record.
 */
export const traceEvents = (source: string): readonly Event[] => {
  const found: Event[] = []
  for (const line of source.split("\n")) {
    if (line === "") continue
    try {
      found.push(decodeLine(line))
    } catch {
      break
    }
  }
  return found
}

// One Trace file, read back whole.
export const readTraceFile = (path: string): readonly Event[] => traceEvents(traceText(path))

/**
 * A Trace stored as a directory of per-Session files, sorted by file name —
 * a time-ordered SessionID reads back in creation order — and each file in
 * its own order. Cross-Session interleaving is not recorded there, so none
 * is invented here.
 */
export const readTraceDir = (dir: string): readonly Event[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith(SUFFIX))
    .sort()
    .flatMap((name) => readTraceFile(join(dir, name)))

/**
 * A Trace at a path, whichever shape it is in: a directory of per-Session
 * files, or one file. A path with nothing at it holds no Trace, which is a
 * Run that recorded nothing rather than a failure.
 */
export const readArchive = (path: string): readonly Event[] => {
  let stat
  try {
    stat = statSync(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return []
    throw cause
  }
  return stat.isDirectory() ? readTraceDir(path) : readTraceFile(path)
}
