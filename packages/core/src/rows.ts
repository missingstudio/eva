import {
  decode,
  encode,
  headerFold,
  headerStep,
  HEADER_RULE,
  sessionID,
  type Event,
  type Header,
  type SessionID,
} from "@missingstudio/eva-schema"
import { Data } from "effect"
import type { SessionHeader } from "./transcript.js"

/**
 * What a row-shaped Trace store holds, and the rules it holds it under.
 * Two stores keep this — SQLite on one machine's file, Postgres on a server
 * — and they differ in one thing only: the primitive that keeps a second
 * writer out of the allocation. Everything else lives here, because the
 * pair once carried it twice and a row is meant to mean the same thing in
 * either: a Trace moves between them unchanged.
 */

// The event table's columns, one per envelope field with the payload as
// JSON. `PRIMARY KEY (session, seq)` makes a duplicate trace position
// impossible rather than unlikely, and `id UNIQUE` names a re-commit.
export const EVENT_COLUMNS = `
  session TEXT NOT NULL,
  seq     INTEGER NOT NULL,
  id      TEXT NOT NULL UNIQUE,
  at      TEXT NOT NULL,
  run     TEXT NOT NULL,
  parent  TEXT,
  kind    TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (session, seq)`

/**
 * The high water made durable, with the Header beside it so a listing is
 * one row per Session and never a replay. `rule` is the `headerStep` rule
 * the Header was folded under, so a cache written by an older Eva is found
 * rather than served stale.
 */
export const HEAD_COLUMNS = `
  session    TEXT PRIMARY KEY,
  seq        INTEGER NOT NULL,
  title      TEXT,
  updated_at TEXT NOT NULL,
  retired    INTEGER NOT NULL,
  rule       INTEGER NOT NULL`

export interface EventRow {
  session: string
  seq: number
  id: string
  at: string
  run: string
  parent: string | null
  kind: string
  version: number
  payload: string
}

export interface HeadRow {
  session: string
  seq: number
  title: string | null
  updated_at: string
  // Whether a person has put the Session away, as the two stores hold a
  // boolean: 0 or 1. Zero reads back as absent, because a Session that is
  // not retired says nothing about it.
  retired: number
  rule: number
}

// Where one Session's Trace got to, and what it says about itself there.
export interface Head {
  readonly seq: number
  readonly header: Header
}

const EMPTY_HEAD: Head = { seq: 0, header: {} }

// A stored record read back through the codec, so a row and a JSONL line
// decode under the same rules and the same version gate.
export const eventOf = (row: EventRow): Event =>
  decode({
    id: row.id,
    seq: row.seq,
    at: { wall: row.at },
    version: row.version,
    kind: row.kind,
    run: row.run,
    session: row.session,
    parent: row.parent,
    payload: JSON.parse(row.payload) as unknown,
  })

// The envelope columns, from the codec's own encoding, so a row in either
// store and a JSONL line hold the same bytes per field.
export const columnsOf = (event: Event): EventRow => {
  const wire = encode(event) as { kind: string; version: number; payload: unknown }
  return {
    session: event.session,
    seq: event.seq,
    id: event.id,
    at: event.at.wall,
    run: event.run,
    parent: event.parent,
    kind: wire.kind,
    version: wire.version,
    payload: JSON.stringify(wire.payload),
  }
}

/**
 * The Header a head row carries. An empty `updated_at` is the placeholder a
 * fresh row holds before its first event lands, and it reads back as absent
 * — one function for both stores, so neither can keep a state the other
 * cannot write.
 *
 * Private: a store reaches it through `headOf` or `headerOfRow`, and the
 * name is the api plugin's for a different thing.
 */
const headerIn = (row: HeadRow): Header => ({
  ...(row.title === null ? {} : { title: row.title }),
  ...(row.retired === 0 ? {} : { retired: true }),
  ...(row.updated_at === "" ? {} : { updatedAt: row.updated_at }),
})

export const headOf = (row: HeadRow | undefined): Head =>
  row === undefined ? EMPTY_HEAD : { seq: row.seq, header: headerIn(row) }

// What a head row holds for one Head, in the column order above. The rule
// is stamped here, so nothing writes a Header without saying which fold
// produced it.
export const headRowOf = (session: SessionID, head: Head): HeadRow => ({
  session,
  seq: head.seq,
  title: head.header.title ?? null,
  updated_at: head.header.updatedAt ?? "",
  retired: head.header.retired === true ? 1 : 0,
  rule: HEADER_RULE,
})

export const headerOfRow = (row: HeadRow): SessionHeader => ({
  id: sessionID(row.session),
  ...headerIn(row),
})

// Every Session the group touches, once, in first-seen order.
export const sessionsOf = (group: readonly Event[]): readonly SessionID[] => [
  ...new Set(group.map((event) => event.session)),
]

/**
 * The allocation itself, as arithmetic over the heads a caller already read:
 * each event is numbered one past its Session's high water, and the Header
 * moves by the same `headerStep` the fold uses. It touches no database, so
 * both stores allocate identically and the transaction around it is the
 * only thing they decide for themselves.
 */
export const stampGroup = (
  group: readonly Event[],
  heads: ReadonlyMap<SessionID, Head>,
): { readonly stamped: readonly Event[]; readonly moved: ReadonlyMap<SessionID, Head> } => {
  const moved = new Map<SessionID, Head>()
  const stamped: Event[] = []
  for (const event of group) {
    const head = moved.get(event.session) ?? heads.get(event.session) ?? EMPTY_HEAD
    const one: Event = { ...event, seq: head.seq + 1 }
    moved.set(event.session, { seq: one.seq, header: headerStep(head.header, one) })
    stamped.push(one)
  }
  return { stamped, moved }
}

// One Session's events folded back into a Head, for the rebuild a stale
// rule asks for and for the import of a Trace that already has positions.
export const headOfEvents = (events: readonly Event[]): Head => ({
  seq: events.reduce((high, event) => (event.seq > high ? event.seq : high), 0),
  header: headerFold(events),
})

/**
 * A group whose records are all stored already is a re-commit: the store
 * answers with the positions they were given rather than taking new ones,
 * so a caller that never learned a commit landed gets the outcome.
 *
 * A group where only some ids are stored is a different thing. Nothing
 * committed it whole, so nothing can say what its positions were, and the
 * store refuses rather than inventing them. That is this error.
 */
export class PartialRecommit extends Data.TaggedError("PartialRecommit")<{
  // The group's event ids, in order, and how many were already stored.
  readonly ids: readonly string[]
  readonly stored: number
}> {}
