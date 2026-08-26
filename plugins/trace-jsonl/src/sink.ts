import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  writeSync,
} from "node:fs"
import { join } from "node:path"
import {
  headOfEvents,
  sinkOf,
  traceEvents,
  traceText,
  SUFFIX,
  type SessionHeader,
  type StampedStore,
  type TraceSink,
} from "@missingstudio/eva-core"
import {
  decodeLine,
  encodeLine,
  headerStep,
  sessionID,
  type Event,
  type SessionID,
} from "@missingstudio/eva-schema"
import { Effect, Stream } from "effect"

export interface JsonlSinkOptions {
  // Whether `append` fsyncs each session file it wrote before returning.
  readonly fsync?: boolean
}

export interface JsonlSink extends TraceSink {
  readonly dir: string
}

export const fileOf = (dir: string, session: SessionID): string => join(dir, `${session}${SUFFIX}`)

// The first whole line of a file, without reading the rest of it. A line
// past this window is not a line this store wrote.
const WINDOW = 65536

const firstLine = (path: string): string | undefined => {
  const handle = openSync(path, "r")
  try {
    const buffer = Buffer.alloc(WINDOW)
    const read = readSync(handle, buffer, 0, buffer.length, 0)
    const text = buffer.toString("utf8", 0, read)
    const end = text.indexOf("\n")
    if (end !== -1) return text.slice(0, end)
    return text === "" ? undefined : text
  } finally {
    closeSync(handle)
  }
}

const makeJsonlStore = (dir: string, fsync: boolean): StampedStore => {
  mkdirSync(dir, { recursive: true })

  // One append handle per session, opened on first write and kept: a Run
  // commits into few sessions, and reopening per group costs a syscall.
  const handles = new Map<SessionID, number>()
  const handleOf = (session: SessionID): number => {
    const held = handles.get(session)
    if (held !== undefined) return held
    const opened = openSync(fileOf(dir, session), "a")
    handles.set(session, opened)
    return opened
  }

  const list = (): readonly SessionID[] =>
    readdirSync(dir)
      .filter((name) => name.endsWith(SUFFIX))
      .map((name) => sessionID(name.slice(0, -SUFFIX.length)))

  // Every whole record one session's file holds. A killed process leaves a
  // half-written last line, and the read keeps everything before it. The
  // filename says whose file it is, and a record filed under another
  // Session is not read back as this one's.
  const eventsAt = (session: SessionID): readonly Event[] =>
    traceEvents(traceText(fileOf(dir, session))).filter((event) => event.session === session)

  /**
   * The listing shortcut the file posture accepts: the title is the first
   * line's — the intent a Session opened on — and `updatedAt` is the file's
   * `mtime`, which is the last append. An `info` that renames a Session
   * late is missed, and `mtime` does not survive a copy; the README says
   * both, and the fold path stays right where this is only fast.
   */
  const headerAt = (session: SessionID): SessionHeader | undefined => {
    const path = fileOf(dir, session)
    try {
      const updatedAt = new Date(statSync(path).mtimeMs).toISOString()
      const line = firstLine(path)
      let title: string | undefined
      if (line !== undefined) {
        try {
          title = headerStep({}, decodeLine(line)).title
        } catch {
          title = undefined
        }
      }
      return { id: session, updatedAt, ...(title === undefined ? {} : { title }) }
    } catch {
      // Deleting a Session is `unlink`, and a list may race one.
      return undefined
    }
  }

  return {
    // Asked per session on first touch, so opening the sink reads nothing:
    // one session's high water is one file's read, not the directory's.
    highWater: (session) => Effect.sync(() => headOfEvents(eventsAt(session)).seq),

    write: (group) =>
      Effect.sync(() => {
        const lines = new Map<SessionID, string[]>()
        for (const event of group) {
          const held = lines.get(event.session)
          if (held === undefined) lines.set(event.session, [encodeLine(event)])
          else held.push(encodeLine(event))
        }
        for (const [session, written] of lines) {
          const handle = handleOf(session)
          writeSync(handle, written.join("\n") + "\n")
          if (fsync) fsyncSync(handle)
        }
      }),

    replay: (session) => Stream.suspend(() => Stream.fromIterable(eventsAt(session))),

    sessions: Effect.sync(list),

    headers: Effect.sync(() =>
      list().flatMap((session) => {
        const header = headerAt(session)
        return header === undefined ? [] : [header]
      }),
    ),

    close: Effect.sync(() => {
      for (const handle of handles.values()) closeSync(handle)
      handles.clear()
    }),
  }
}

export const makeJsonlSink = (
  dir: string,
  options: JsonlSinkOptions = {},
): Effect.Effect<JsonlSink> =>
  Effect.gen(function* () {
    const store = makeJsonlStore(dir, options.fsync ?? true)
    return { ...(yield* sinkOf(store)), dir }
  })
