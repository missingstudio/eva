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
import { HEADER_RULE, sessionID, type Event, type SessionID } from "@missingstudio/eva-schema"
import { Effect, Stream } from "effect"
import postgres from "postgres"

export interface PostgresSinkOptions {
  // The schema every table lives under, so one database can hold one Eva
  // per schema. Letters, digits and underscores only.
  readonly schema?: string
  // How many connections the pool holds. Writes serialize per session on a
  // row lock either way; this bounds the concurrent reads.
  readonly pool?: number
}

export interface PostgresSink extends TraceSink {
  readonly url: string
  // How many Sessions had a Header folded again at this open, because the
  // row was written under an older `headerStep` rule.
  readonly rebuilt: number
}

// A schema name is the one identifier config supplies, so it is held to a
// shape that cannot carry SQL of its own.
const NAME = /^[a-z_][a-z0-9_]*$/

/**
 * The same store the SQLite sink keeps, on a server: the shared row shape,
 * the shared allocation arithmetic, and the head row beside the events.
 * What is decided here and nowhere else is the primitive that keeps a
 * second writer out of the allocation — a row lock, because Postgres is
 * many writers on many machines and SQLite is one machine's file.
 */
export const makePostgresSink = (
  url: string,
  options: PostgresSinkOptions = {},
): Effect.Effect<PostgresSink> =>
  Effect.gen(function* () {
    const schema = options.schema ?? "eva"
    if (!NAME.test(schema)) {
      return yield* Effect.die(new Error(`not a schema name: ${schema}`))
    }

    const sql = postgres(url, {
      max: options.pool ?? 4,
      onnotice: () => {},
      // Unqualified names resolve to Eva's schema, so every query below
      // reads as the SQLite store's does.
      connection: { search_path: schema },
    })

    // The names are validated above, so the one thing `unsafe` carries is
    // the schema config chose. The `rule` column is added where an older
    // head table lacks it, at nothing — so every row it holds reads as
    // stale and is folded again below.
    yield* Effect.promise(async () => {
      await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
      await sql.unsafe(`CREATE TABLE IF NOT EXISTS ${schema}.event (${EVENT_COLUMNS}
        )`)
      await sql.unsafe(`CREATE TABLE IF NOT EXISTS ${schema}.session_head (${HEAD_COLUMNS}
        )`)
      await sql.unsafe(
        `ALTER TABLE ${schema}.session_head
         ADD COLUMN IF NOT EXISTS rule INTEGER NOT NULL DEFAULT 0`,
      )
      // A head table written before the Header carried retirement gets the
      // column at nothing, which is what every row there means: no Session
      // was put away under a rule that could not say it.
      await sql.unsafe(
        `ALTER TABLE ${schema}.session_head
         ADD COLUMN IF NOT EXISTS retired INTEGER NOT NULL DEFAULT 0`,
      )
    })

    /**
     * The whole allocation, inside one transaction. The upsert on the head
     * row is an insert-or-lock: a fresh session gets a row at zero, a known
     * one comes back locked, and either way a second writer waits here
     * rather than claiming a taken position.
     *
     * A group whose records are all stored already is a re-commit, and it
     * answers with the positions they were given rather than taking new
     * ones. `DO NOTHING` on the id alone is what tells the two apart: a
     * taken trace position is a different conflict and still raises.
     */
    const append = (group: readonly Event[]): Promise<readonly Event[]> =>
      sql.begin(async (tx) => {
        const heads = new Map<SessionID, Head>()
        for (const session of sessionsOf(group)) {
          const [row] = await tx<HeadRow[]>`
            INSERT INTO session_head AS h (session, seq, title, updated_at, retired, rule)
            VALUES (${session}, 0, null, '', 0, ${HEADER_RULE})
            ON CONFLICT (session) DO UPDATE SET seq = h.seq
            RETURNING session, seq, title, updated_at, retired, rule`
          heads.set(session, headOf(row))
        }

        const { stamped, moved } = stampGroup(group, heads)
        const written = await tx`
          INSERT INTO event ${tx(stamped.map(columnsOf))}
          ON CONFLICT (id) DO NOTHING`
        const ids = stamped.map((one) => one.id)
        if (written.count === 0) {
          const rows = await tx<EventRow[]>`SELECT * FROM event WHERE id IN ${tx(ids)}`
          return rows.map(eventOf)
        }
        if (written.count !== stamped.length) {
          throw new PartialRecommit({ ids, stored: stamped.length - written.count })
        }
        for (const [session, head] of moved) {
          const row = headRowOf(session, head)
          await tx`
            UPDATE session_head
            SET seq = ${row.seq}, title = ${row.title},
                updated_at = ${row.updated_at}, retired = ${row.retired},
                rule = ${row.rule}
            WHERE session = ${session}`
        }
        return stamped
      }) as Promise<readonly Event[]>

    const eventsAt = (session: SessionID): Promise<readonly Event[]> =>
      sql<EventRow[]>`SELECT * FROM event WHERE session = ${session} ORDER BY seq`.then((rows) =>
        rows.map(eventOf),
      )

    /**
     * A Header cached under an older `headerStep` rule is folded again from
     * the events it summarizes. The Trace is the source, so a rule that
     * moved costs one replay per Session and never a wrong listing.
     */
    const rebuildStale = async (): Promise<number> => {
      const stale = await sql<{ session: string }[]>`
        SELECT session FROM session_head WHERE rule <> ${HEADER_RULE}`
      for (const { session } of stale) {
        const id = sessionID(session)
        const row = headRowOf(id, headOfEvents(await eventsAt(id)))
        await sql`
          UPDATE session_head
          SET seq = ${row.seq}, title = ${row.title},
              updated_at = ${row.updated_at}, retired = ${row.retired},
              rule = ${row.rule}
          WHERE session = ${id}`
      }
      return stale.length
    }

    const rebuilt = yield* Effect.promise(rebuildStale)

    const store: TraceStore = {
      append: (group) => Effect.promise(() => append(group)),

      highWater: (session) =>
        Effect.promise(async () => {
          const [row] = await sql<{ seq: number }[]>`
            SELECT seq FROM session_head WHERE session = ${session}`
          return row?.seq ?? 0
        }),

      replay: (session) =>
        Stream.unwrap(Effect.promise(() => eventsAt(session).then(Stream.fromIterable))),

      sessions: Effect.promise(async () => {
        const rows = await sql<{ session: string }[]>`SELECT session FROM session_head`
        return rows.map((row) => sessionID(row.session))
      }),

      headers: Effect.promise(async () => {
        const rows = await sql<HeadRow[]>`SELECT * FROM session_head`
        return rows.map(headerOfRow)
      }),

      close: Effect.promise(() => sql.end({ timeout: 5 })),
    }

    return { ...(yield* sinkOf(store)), url, rebuilt }
  })
