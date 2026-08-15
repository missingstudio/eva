import type { EventID, RunID, SessionID, Timestamp } from "./id.js"
import type { Payload } from "./payload.js"

export const SCHEMA_VERSION = 1

/**
 * The envelope. `seq` is the trace position, and the sink assigns it at
 * commit. It is the only sequence: a resume reads a Cursor, which is a
 * trace position, so nothing needs a second one.
 *
 * A record in memory is always the current one —
 * the codec refuses anything else on the way in and stamps the
 * version on the way out — so the wire is the only place a version is a
 * fact, and the codec is the only module that reads one.
 */
export interface Event {
  readonly id: EventID
  readonly seq: number
  readonly at: Timestamp
  readonly run: RunID
  readonly session: SessionID
  readonly parent: EventID | null
  readonly payload: Payload
}

// Everything a fold groups by. The envelope must carry all of it.
export interface FoldKeys {
  readonly session: SessionID
  readonly run: RunID
  readonly parent: EventID | null
}

export const foldKeys = (event: Event): FoldKeys => ({
  session: event.session,
  run: event.run,
  parent: event.parent,
})

export const sameFoldKeys = (a: Event, b: Event): boolean =>
  a.session === b.session && a.run === b.run && a.parent === b.parent
