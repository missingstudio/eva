import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { TraceSink } from "@missingstudio/eva-core"
import {
  eventID,
  runID,
  sessionID,
  type Event,
  type Payload,
  type SessionID,
} from "@missingstudio/eva-schema"
import { makeSessionStore } from "@missingstudio/eva-session-jsonl"
import { makeJsonlSink } from "@missingstudio/eva-trace-jsonl"
import { makeMemorySink } from "@missingstudio/eva-trace-memory"
import { makePostgresSink } from "@missingstudio/eva-trace-postgres"
import { makeSqliteSink } from "@missingstudio/eva-trace-sqlite"
import { Effect } from "effect"
import postgres from "postgres"
import { afterAll, describe, expect, it } from "vitest"

const scratch = () => mkdtempSync(join(tmpdir(), "eva-list-"))

/**
 * `SessionStore.list` states one order — most recently updated first, id as
 * the tiebreak — and every store owes it, whatever it reads to answer: the
 * memory sink is folded whole, the JSONL sink answers from first lines and
 * `mtime`, and the row stores from their head table. Several reads, one
 * order; a page and a terminal drawing different listings over one Trace is
 * the roadmap's failure mode 2.
 *
 * The order is the listing's own, not the sink's — `TraceSink.headers`
 * promises no order at all, so what this suite proves is that the promise
 * is kept in the one place it is made.
 */
const postgresURL = process.env["EVA_TEST_POSTGRES_URL"]
const schemas: string[] = []

const freshSchema = (): string => {
  const name = `eva_lo_${schemas.length}_${Math.random().toString(36).slice(2, 8)}`
  schemas.push(name)
  return name
}

afterAll(async () => {
  if (postgresURL === undefined || schemas.length === 0) return
  const sql = postgres(postgresURL, { max: 1, onnotice: () => {} })
  for (const name of schemas) await sql.unsafe(`DROP SCHEMA IF EXISTS ${name} CASCADE`)
  await sql.end({ timeout: 5 })
})

type Row = readonly [string, () => Effect.Effect<TraceSink>]

const sinks: readonly Row[] = [
  ["eva.trace.memory, folded", () => makeMemorySink()],
  ["eva.trace.jsonl, first line and mtime", () => makeJsonlSink(scratch())],
  ["eva.trace.sqlite, head table", () => makeSqliteSink(join(scratch(), "trace.sqlite"))],
  ...(postgresURL === undefined
    ? []
    : [
        [
          "eva.trace.postgres, head table",
          () => makePostgresSink(postgresURL, { schema: freshSchema(), pool: 2 }),
        ] satisfies Row,
      ]),
]

const OLDER = sessionID("sess_lo_older")
const NEWER = sessionID("sess_lo_newer")

let counter = 0
const event = (session: SessionID, payload: Payload, wall: string): Event => ({
  id: eventID(`evt_lo_${(counter += 1)}`),
  seq: 0,
  at: { wall },
  run: runID("run_lo"),
  session,
  parent: null,
  payload,
})

const started = (intent: string): Payload => ({ kind: "started", intent })

const text: Payload = {
  kind: "text",
  block: 0,
  content: { type: "text", text: "still going" },
}

// The JSONL listing reads `mtime`, so the commits need real time between
// them, not only later wall stamps.
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

describe.each(sinks)("the list order over %s", (_name, make) => {
  it("puts the most recently updated Session first, titled", async () => {
    const sink = await Effect.runPromise(make())
    const store = await Effect.runPromise(makeSessionStore({ sink: Effect.succeed(sink) }))

    await Effect.runPromise(
      sink.append([event(OLDER, started("the first ask"), "2026-08-15T09:00:01.000Z")]),
    )
    await settle()
    await Effect.runPromise(
      sink.append([event(NEWER, started("the second ask"), "2026-08-15T09:00:02.000Z")]),
    )
    await settle()
    // The older Session moves again, so it comes back first.
    await Effect.runPromise(sink.append([event(OLDER, text, "2026-08-15T09:00:03.000Z")]))

    const listed = await Effect.runPromise(store.list)
    await Effect.runPromise(sink.close)

    expect(listed.map((one) => [one.id, one.title])).toEqual([
      [OLDER, "the first ask"],
      [NEWER, "the second ask"],
    ])
  })

  it("sorts a Session opened but never committed last", async () => {
    const sink = await Effect.runPromise(make())
    const store = await Effect.runPromise(makeSessionStore({ sink: Effect.succeed(sink) }))

    const bare = await Effect.runPromise(store.create)
    await Effect.runPromise(
      sink.append([event(OLDER, started("committed"), "2026-08-15T09:00:01.000Z")]),
    )

    const listed = await Effect.runPromise(store.list)
    await Effect.runPromise(sink.close)

    expect(listed.map((one) => one.id)).toEqual([OLDER, bare.id])
    expect(listed[1]?.updatedAt).toBeUndefined()
  })
})
