import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs"
import { dirname } from "node:path"
import { sequenced, type TraceSink, type TraceStore } from "@missingstudio/eva-core"
import { decodeLine, encodeLine, type Event, type SessionID } from "@missingstudio/eva-schema"
import { Effect, Stream } from "effect"

export interface Recovery {
  readonly highWater: ReadonlyMap<SessionID, number>
  // A killed process can leave a half-written last line. Recovery keeps
  // every whole record before it and reports that it found one.
  readonly tornTrailingLine: boolean
}

export const recover = (source: string): Recovery => {
  const highWater = new Map<SessionID, number>()
  const lines = source.split("\n")
  const last = lines.length - 1
  let torn = false

  for (const [index, line] of lines.entries()) {
    if (line === "") continue
    try {
      const event = decodeLine(line)
      const seen = highWater.get(event.session) ?? 0
      if (event.seq > seen) highWater.set(event.session, event.seq)
    } catch {
      // Anything unreadable before the end means real corruption, not a
      // torn tail, so recovery stops rather than skipping records.
      torn = index === last
      break
    }
  }
  return { highWater, tornTrailingLine: torn }
}

export const readTrace = (path: string): string => {
  try {
    return readFileSync(path, "utf8")
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return ""
    throw cause
  }
}

export interface JsonlSink extends TraceSink {
  readonly path: string
  readonly recovery: Recovery
}

interface JsonlStore extends TraceStore {
  readonly recovery: Recovery
}

const makeJsonlStore = (path: string): JsonlStore => {
  mkdirSync(dirname(path), { recursive: true })
  const recovery = recover(readTrace(path))
  const handle = openSync(path, "a")

  // A torn tail stops the walk rather than skipping past it, so a reader
  // sees every whole record before the break and nothing after.
  const walk = (visit: (event: Event) => void): void => {
    for (const line of readTrace(path).split("\n")) {
      if (line === "") continue
      try {
        visit(decodeLine(line))
      } catch {
        break
      }
    }
  }

  return {
    recovery,
    highWater: Effect.succeed(recovery.highWater),

    write: (group) =>
      Effect.sync(() => {
        writeSync(handle, group.map(encodeLine).join("\n") + "\n")
        fsyncSync(handle)
      }),

    replay: (session) =>
      Stream.suspend(() => {
        const found: Event[] = []
        walk((event) => {
          if (event.session === session) found.push(event)
        })
        return Stream.fromIterable(found)
      }),

    sessions: Effect.sync(() => {
      const found = new Set<SessionID>()
      walk((event) => void found.add(event.session))
      return [...found]
    }),

    close: Effect.sync(() => closeSync(handle)),
  }
}

export const makeJsonlSink = (path: string): Effect.Effect<JsonlSink> =>
  Effect.gen(function* () {
    const store = makeJsonlStore(path)
    return { ...(yield* sequenced(store)), path, recovery: store.recovery }
  })
