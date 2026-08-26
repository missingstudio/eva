import {
  eventID,
  runID,
  sessionID,
  type Event,
  type Payload,
  type SessionID,
} from "@missingstudio/eva-schema"
import { Effect, Stream } from "effect"
import { afterAll, describe, expect, it } from "vitest"
import postgres from "postgres"
import { makePostgresSink } from "./sink.js"

/**
 * These run against a real server, because a fake Postgres proves nothing
 * about the one thing this store owns — allocation under concurrent
 * writers. Point EVA_TEST_POSTGRES_URL at a disposable database to run
 * them; without one the suite skips and says nothing false.
 */
const url = process.env["EVA_TEST_POSTGRES_URL"]

// One schema per run, dropped at the end, so a shared database stays clean
// and two runs cannot see each other.
const schema = `eva_test_${Math.random().toString(36).slice(2, 10)}`

let counter = 0
const event = (session: SessionID, payload: Payload): Event => ({
  id: eventID(`evt_p${(counter += 1)}`),
  seq: 0,
  at: { wall: `2026-01-01T00:00:${String(counter % 60).padStart(2, "0")}.000Z` },
  run: runID("run_1"),
  session,
  parent: null,
  payload,
})

const started = (intent: string): Payload => ({ kind: "started", intent })
const info = (title: string): Payload => ({ kind: "info", title })

const open = () => Effect.runPromise(makePostgresSink(url ?? "", { schema, pool: 2 }))

describe.skipIf(url === undefined)("the postgres sink", () => {
  afterAll(async () => {
    if (url === undefined) return
    const sql = postgres(url, { max: 1, onnotice: () => {} })
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await sql.end({ timeout: 5 })
  })

  it("carries on numbering where an earlier connection stopped", async () => {
    const session = sessionID("sess_pg_resumed")
    const first = await open()
    await Effect.runPromise(first.append([event(session, started("one"))]))
    await Effect.runPromise(first.close)

    const second = await open()
    const next = await Effect.runPromise(second.append([event(session, started("two"))]))
    await Effect.runPromise(second.close)

    expect(next[0]?.seq).toBe(2)
  })

  // The allocation happens behind the head row's lock, so two sinks — two
  // processes on two machines — cannot claim one position.
  it("numbers safely under concurrent writers", async () => {
    const session = sessionID("sess_pg_shared")
    const one = await open()
    const two = await open()

    await Promise.all([
      Effect.runPromise(one.append([event(session, started("a"))])),
      Effect.runPromise(two.append([event(session, started("b"))])),
      Effect.runPromise(one.append([event(session, started("c"))])),
      Effect.runPromise(two.append([event(session, started("d"))])),
    ])

    const replayed = await Effect.runPromise(Stream.runCollect(one.replay(session)))
    await Effect.runPromise(one.close)
    await Effect.runPromise(two.close)

    expect([...replayed].map((row) => row.seq)).toEqual([1, 2, 3, 4])
  })

  it("replays only the session asked for, decoded through the codec", async () => {
    const wanted = sessionID("sess_pg_wanted")
    const sink = await open()
    await Effect.runPromise(sink.append([event(wanted, started("mine"))]))
    await Effect.runPromise(sink.append([event(sessionID("sess_pg_other"), started("theirs"))]))

    const replayed = await Effect.runPromise(Stream.runCollect(sink.replay(wanted)))
    await Effect.runPromise(sink.close)

    expect([...replayed].map((one) => [one.session, one.payload.kind])).toEqual([
      [wanted, "started"],
    ])
  })

  // The head row holds the Header the fold would give, so a rename
  // arriving at any position wins. The order is the listing's, and
  // conformance holds it over every sink.
  it("renames a session when a later info says so", async () => {
    const older = sessionID("sess_pg_h_older")
    const newer = sessionID("sess_pg_h_newer")
    const sink = await open()

    await Effect.runPromise(sink.append([event(older, started("the first ask"))]))
    await Effect.runPromise(sink.append([event(newer, started("the second ask"))]))
    await Effect.runPromise(sink.append([event(older, info("renamed late"))]))

    const headers = await Effect.runPromise(sink.headers)
    await Effect.runPromise(sink.close)

    const ours = headers
      .filter((one) => one.id === older || one.id === newer)
      .sort((a, b) => a.id.localeCompare(b.id))
    expect(ours.map((one) => [one.id, one.title])).toEqual([
      [newer, "the second ask"],
      [older, "renamed late"],
    ])
  })

  it("answers a re-committed group with the positions it already gave", async () => {
    const session = sessionID("sess_pg_again")
    const sink = await open()

    const group = [event(session, started("once")), event(session, started("twice"))]
    const first = await Effect.runPromise(sink.append(group))
    const again = await Effect.runPromise(sink.append(group))
    const next = await Effect.runPromise(sink.append([event(session, started("after"))]))
    await Effect.runPromise(sink.close)

    expect(first.map((one) => one.seq)).toEqual([1, 2])
    expect(again.map((one) => one.seq)).toEqual([1, 2])
    expect(next[0]?.seq).toBe(3)
  })
})
