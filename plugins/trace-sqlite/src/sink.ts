import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"
import {
  columnsOf,
  eventOf,
  headerOfRow,
  headOf,
  headOfEvents,
  headRowOf,
  PartialRecommit,
  sessionsOf,
  sinkOf,
  stampGroup,
  EVENT_COLUMNS,
  HEAD_COLUMNS,
  type EventRow,
  type Head,
  type HeadRow,
  type TraceSink,
  type TraceStore,
} from "@missingstudio/eva-core"
import { readTraceFile } from "@missingstudio/eva-core/archive"
import { HEADER_RULE, sessionID, type Event, type SessionID } from "@missingstudio/eva-schema"
import { Effect, Stream } from "effect"

/**
 * The event table is opencode's `event`/`event_sequence` pair under Eva's
 * own names, and the columns are the shared row shape the Postgres store
 * also keeps. What is decided here and nowhere else is the primitive that
 * keeps a second writer out of the allocation: `BEGIN IMMEDIATE`, which is
 * what one machine's file has instead of a row lock.
 */
const TABLES = `
CREATE TABLE IF NOT EXISTS event (${EVENT_COLUMNS}
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS session_head (${HEAD_COLUMNS}
);
`

export interface SqliteSinkOptions {
  /**
   * The WAL commit durability. `normal` survives a killed process and is
   * the default; `full` also survives the OS going down mid-commit, at a
   * few hundred microseconds a group.
   */
  readonly synchronous?: "normal" | "full"
  /**
   * A one-file JSONL trace to load when the store holds nothing — the
   * migration for a `trace.jsonl` written before this sink existed. Every
   * record keeps its trace position. A missing file imports nothing.
   */
  readonly importFrom?: string
}

export interface SqliteSink extends TraceSink {
  readonly path: string
  // How many records `importFrom` contributed at this open. Zero after the
  // first open, because an occupied store never imports.
  readonly imported: number
  // How many Sessions had a Header folded again at this open, because the
  // row was written under an older `headerStep` rule.
  readonly rebuilt: number
}

export const makeSqliteSink = (
  path: string,
  options: SqliteSinkOptions = {},
): Effect.Effect<SqliteSink> =>
  Effect.gen(function* () {
    mkdirSync(dirname(path), { recursive: true })
    const db = new DatabaseSync(path)
    db.exec("PRAGMA journal_mode = WAL")
    db.exec(`PRAGMA synchronous = ${options.synchronous === "full" ? "FULL" : "NORMAL"}`)
    db.exec("PRAGMA busy_timeout = 5000")
    db.exec(TABLES)

    // A head table written before the Header carried its rule gets the
    // column at nothing, so every row it holds reads as stale and is folded
    // again below. The migration and the staleness rebuild are one path.
    const held = db.prepare("PRAGMA table_info(session_head)").all() as unknown as {
      name: string
    }[]
    if (!held.some((column) => column.name === "rule")) {
      db.exec("ALTER TABLE session_head ADD COLUMN rule INTEGER NOT NULL DEFAULT 0")
    }
    // A head table written before the Header carried retirement gets the
    // column at nothing, which is what every row there means: no Session was
    // put away under a rule that could not say it.
    if (!held.some((column) => column.name === "retired")) {
      db.exec("ALTER TABLE session_head ADD COLUMN retired INTEGER NOT NULL DEFAULT 0")
    }

    // `DO NOTHING` on the id alone: a record already stored is a re-commit
    // and says so by changing nothing, while a taken trace position is a
    // second writer and still raises — which is the guard that makes the
    // allocation safe rather than merely lucky.
    const insertEvent = db.prepare(
      `INSERT INTO event (session, seq, id, at, run, parent, kind, version, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
    )
    const readHead = db.prepare("SELECT * FROM session_head WHERE session = ?")
    const upsertHead = db.prepare(
      `INSERT INTO session_head (session, seq, title, updated_at, retired, rule)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (session) DO UPDATE SET
         seq = excluded.seq, title = excluded.title,
         updated_at = excluded.updated_at, retired = excluded.retired,
         rule = excluded.rule`,
    )
    const readEvents = db.prepare("SELECT * FROM event WHERE session = ? ORDER BY seq")
    const readSessions = db.prepare("SELECT session FROM session_head")
    const readHeaders = db.prepare("SELECT * FROM session_head")
    const readByID = db.prepare("SELECT * FROM event WHERE id = ?")
    const readStale = db.prepare("SELECT session FROM session_head WHERE rule <> ?")
    const counted = db.prepare("SELECT count(*) AS held FROM session_head")

    const headAt = (session: SessionID): Head =>
      headOf(readHead.get(session) as HeadRow | undefined)

    const eventsAt = (session: SessionID): readonly Event[] =>
      (readEvents.all(session) as unknown as EventRow[]).map(eventOf)

    const writeHead = (session: SessionID, head: Head): void => {
      const row = headRowOf(session, head)
      upsertHead.run(row.session, row.seq, row.title, row.updated_at, row.retired, row.rule)
    }

    // Returns false when the id was already stored, so the caller can tell
    // a re-commit from a group that landed.
    const insert = (event: Event): boolean => {
      const row = columnsOf(event)
      const done = insertEvent.run(
        row.session,
        row.seq,
        row.id,
        row.at,
        row.run,
        row.parent,
        row.kind,
        row.version,
        row.payload,
      )
      return done.changes > 0
    }

    const storedGroup = (group: readonly Event[]): readonly Event[] =>
      group.map((event) => eventOf(readByID.get(event.id) as unknown as EventRow))

    /**
     * The whole allocation, inside one transaction: read each session's
     * head, number one past it, insert, and move the head — so a second
     * process on the same file cannot claim a taken position, and a group
     * either lands whole or not at all.
     *
     * A group whose records are all stored already is a re-commit, and it
     * answers with the positions they were given rather than taking new
     * ones.
     */
    const append = (group: readonly Event[]): readonly Event[] => {
      db.exec("BEGIN IMMEDIATE")
      try {
        const heads = new Map(sessionsOf(group).map((session) => [session, headAt(session)]))
        const { stamped, moved } = stampGroup(group, heads)
        const fresh = stamped.filter(insert)
        if (fresh.length === 0) {
          db.exec("ROLLBACK")
          return storedGroup(group)
        }
        // Thrown rather than rolled back here: the catch below owns the
        // rollback, and rolling back twice would raise over this error and
        // hide it.
        if (fresh.length !== stamped.length) {
          throw new PartialRecommit({
            ids: stamped.map((one) => one.id),
            stored: stamped.length - fresh.length,
          })
        }
        for (const [session, head] of moved) writeHead(session, head)
        db.exec("COMMIT")
        return stamped
      } catch (cause) {
        db.exec("ROLLBACK")
        throw cause
      }
    }

    /**
     * An older one-file trace, loaded whole with every trace position kept.
     * The walk stops at the first unreadable line and keeps every whole
     * record before it, which is the JSONL recovery rule.
     */
    const importLegacy = (from: string): number => {
      if ((counted.get() as { held: number }).held > 0) return 0
      const events = readTraceFile(from)
      if (events.length === 0) return 0

      db.exec("BEGIN IMMEDIATE")
      try {
        for (const event of events) insert(event)
        for (const session of sessionsOf(events)) {
          writeHead(session, headOfEvents(events.filter((event) => event.session === session)))
        }
        db.exec("COMMIT")
        return events.length
      } catch (cause) {
        db.exec("ROLLBACK")
        throw cause
      }
    }

    /**
     * A Header cached under an older `headerStep` rule is folded again from
     * the events it summarizes. The Trace is the source, so a rule that
     * moved costs one replay per Session and never a wrong listing.
     */
    const rebuildStale = (): number => {
      const stale = (readStale.all(HEADER_RULE) as unknown as { session: string }[]).map((row) =>
        sessionID(row.session),
      )
      if (stale.length === 0) return 0
      db.exec("BEGIN IMMEDIATE")
      try {
        for (const session of stale) writeHead(session, headOfEvents(eventsAt(session)))
        db.exec("COMMIT")
        return stale.length
      } catch (cause) {
        db.exec("ROLLBACK")
        throw cause
      }
    }

    const imported = options.importFrom === undefined ? 0 : importLegacy(options.importFrom)
    const rebuilt = rebuildStale()

    const store: TraceStore = {
      append: (group) => Effect.sync(() => append(group)),

      highWater: (session) => Effect.sync(() => headAt(session).seq),

      replay: (session) => Stream.suspend(() => Stream.fromIterable(eventsAt(session))),

      sessions: Effect.sync(() =>
        (readSessions.all() as unknown as { session: string }[]).map((row) =>
          sessionID(row.session),
        ),
      ),

      headers: Effect.sync(() => (readHeaders.all() as unknown as HeadRow[]).map(headerOfRow)),

      close: Effect.sync(() => db.close()),
    }

    return { ...(yield* sinkOf(store)), path, imported, rebuilt }
  })
