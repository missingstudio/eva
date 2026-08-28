import { tmpdir } from "node:os"
import { join } from "node:path"
import { apiWire } from "@missingstudio/eva-api"
import { httpTransport } from "@missingstudio/eva-api/client"
import {
  droppableTransport,
  makeClient,
  memorySessionAPI,
  type Call,
  type Client,
  type ClientState,
  type Method,
  type Transport,
} from "@missingstudio/eva-client-runtime"
import type { SessionAPI } from "@missingstudio/eva-core"
import type { Cursor, Payload, SessionID } from "@missingstudio/eva-schema"
import { serveWeb } from "@missingstudio/eva-web"
import { follow, type Reading } from "@missingstudio/eva-web-app"
import { Effect, Exit, Fiber, Scope, Stream, SubscriptionRef } from "effect"
import { describe, expect, it } from "vitest"

/**
 * The page, over the wire, over a pipe that can be taken away. This is W1's
 * exit test where it can be run: the page's own protocol against the server a
 * person's Eva really serves, with the record moving while the page is not
 * listening.
 *
 * `droppableTransport` ships in `client-runtime` rather than in a test file
 * because W0's exit test runs on it and because the second filler would want
 * it again. This is the second filler, and this is where it wants it.
 *
 * What is not here: a Session started by another process. `packages/core`'s
 * sink keeps its followers in memory, so an open watch never sees a commit
 * another `eva` wrote — `attach` and cursor replay cross processes and the
 * live tail does not. Every clause here is one process, which is what the
 * page's own criteria ask for.
 */

const word = (text: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text },
})

/**
 * The first moment a condition holds. A bounded poll rather than a fixed
 * pause, because a fixed pause misses on a loaded host — and a socket is not a
 * function call, so most of what is waited for here is a far side catching up.
 */
const until = Effect.fn("test.until")(function* (what: string, holds: () => boolean) {
  for (let turn = 0; turn < 1000 && !holds(); turn += 1) yield* Effect.sleep("2 millis")
  expect([what, holds()]).toEqual([what, true])
})

// How long a call that could not reach the far side waits before it asks
// again. Shorter than the transport's own, so a suite reaches the answer
// rather than the default.
const GAP = 50

/**
 * The wire, served where a person's Eva serves it: behind `eva.web`'s own
 * server, on one port, from the handler the composition root hands over. A
 * page that only ever converged against a socket a suite opened would prove
 * the protocol and not the thing that is shipped.
 *
 * The Scope is held here rather than left to the clause's own, because one
 * clause has to take the server away and put another back on the same port —
 * which is what a person does with Ctrl-C and `eva serve --web` again.
 */
const served = Effect.fn("test.served")(function* (api: SessionAPI, port = 0) {
  const held = yield* Scope.make()

  // The address is read back out of what the surface printed, because a
  // `Frontend` carries none. Nothing here reads the page, so the root names a
  // tree no build ever filled.
  const said: string[] = []
  yield* Effect.provideService(
    serveWeb({
      root: join(tmpdir(), "eva-conformance-no-page"),
      bind: { host: "127.0.0.1", port },
      posture: "local",
      api: apiWire(api),
      write: (text) => void said.push(text),
    }),
    Scope.Scope,
    held,
  )

  const origin = said.join("").split(" ")[0] ?? ""
  return { origin, port: Number(new URL(origin).port), stop: Scope.close(held, Exit.void) }
})

/** One in-memory Session, served, with the wire in front of it. */
const wired = Effect.fn("test.wired")(function* () {
  const memory = yield* memorySessionAPI(() => Effect.void)
  const server = yield* served(memory.api)
  return { memory, server, wire: yield* httpTransport({ origin: server.origin, gap: GAP }) }
})

/**
 * The page's own Client, over a pipe a suite can take away. `droppableTransport`
 * ships in `client-runtime` rather than in a test file because W0's exit test
 * runs on it and because the second filler would want it again. This is the
 * second filler, and this is where it wants it.
 */
const droppable = Effect.fn("test.droppable")(function* (wire: Transport) {
  const transport = yield* droppableTransport(wire.api)
  return { transport, client: yield* makeClient(transport) }
})

/**
 * One Session, followed as the page follows it, with what the page held at
 * each step. `follow` is imported rather than restated: a copy of it here
 * would keep passing after the page moved. The protocol under it is
 * `Client.follow`, so what this suite proves about converging is proved about
 * the runtime and not about one surface.
 */
const opened = Effect.fn("test.opened")(function* (one: Client, session: SessionID) {
  const held: Reading[] = []
  let now: Reading = { folded: { kind: "folding" }, said: "", running: false }
  const following = yield* Effect.forkChild(
    follow(one, session, (next) => {
      now = next(now)
      held.push(now)
    }),
  )
  return { held, at: () => now, stop: Fiber.interrupt(following) }
})

/**
 * How many times the page folded. Every fold is a new object and the tail
 * entries between two folds share the one before them, so this counts
 * repaints — which is what a drop and a refusal each cost.
 */
const folds = (held: readonly Reading[]): number => new Set(held.map((one) => one.folded)).size

const wordsIn = (reading: Reading | undefined): string =>
  reading?.folded.kind === "folded"
    ? reading.folded.turns
        .flatMap((turn) => turn.blocks)
        .map((block) => (block.kind === "words" ? block.text : ""))
        .join("")
    : ""

// One value per change. A ref set to what it already holds says nothing new,
// so a repeat is not a step of the walk.
const steps = (walked: readonly ClientState[]): readonly ClientState[] =>
  walked.filter((one, at) => one !== walked[at - 1])

// Which position each watch resumed from, in the order the watches were asked
// for. A fold ends at a Cursor and the watch behind it starts there.
const resumed = (calls: readonly Call[]): readonly (number | undefined)[] =>
  calls
    .filter((one) => one.method === "watch")
    .map((one) => (one.args[1] as Cursor | undefined)?.seq)

const counted = (calls: readonly Call[], method: Method): number =>
  calls.filter((one) => one.method === method).length

describe("the page, over the wire", () => {
  /**
   * The drop, mid-Run. What commits while the pipe is down reaches the page
   * only through the fold that follows the restore, and it reaches it once:
   * the fold ends at a position and the watch behind it resumes from there.
   */
  it("converges from the Cursor it holds when the pipe drops mid-Run", async () => {
    const found = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { memory, wire } = yield* wired()
          const { transport, client } = yield* droppable(wire)

          const walked: ClientState[] = []
          const walking = yield* Effect.forkChild(
            Stream.runForEach(SubscriptionRef.changes(client.state), (one) =>
              Effect.sync(() => void walked.push(one)),
            ),
          )

          yield* memory.say({ kind: "started", intent: "ask" })
          const page = yield* opened(client, memory.session)
          yield* until("the committed fold", () => folds(page.held) === 1)
          yield* until("a live watch", () => memory.open() > 0)

          yield* memory.say(word("par"))
          yield* until("the live word", () => page.at().said === "par")

          /**
           * The pipe goes while the Run is open, and the record moves without
           * it. The far side is waited on: a payload said while it still holds
           * the subscription is one the page would hear live, and then this
           * would be proving nothing.
           */
          yield* transport.drop
          yield* until(
            "a page that says the pipe is down",
            () => SubscriptionRef.getUnsafe(client.state) === "disconnected",
          )
          yield* until("the far side let the watch go", () => memory.open() === 0)
          yield* memory.say(word("tial"))

          yield* transport.restore
          yield* until("one repaint", () => folds(page.held) === 2)
          yield* until(
            "a page that says the pipe is back",
            () => SubscriptionRef.getUnsafe(client.state) === "ready",
          )
          yield* until("a live watch again", () => memory.open() > 0)

          /**
           * What the resumed watch replayed, read once it is subscribed and
           * before anything else is said. A page that had resumed from the
           * position its first fold ended at would have both words here.
           */
          const replayed = page.at().said
          yield* memory.say(word(" and on"))
          yield* until("the word after the restore", () => page.at().said === " and on")

          yield* page.stop
          yield* Fiber.interrupt(walking)
          return {
            words: wordsIn(page.held.at(-1)),
            replayed,
            said: page.at().said,
            folded: folds(page.held),
            attached: counted(memory.calls, "attach"),
            resumed: resumed(memory.calls),
            walked,
          }
        }),
      ),
    )

    // The intent the Run opened with, then both words: one heard live, and one
    // that only the fold after the restore could carry. No gap.
    expect(found.words).toBe("askpartial")
    // And no duplicate: the watch behind the fold replayed nothing the fold
    // already held, and then went on with the record as it grew.
    expect(found.replayed).toBe("")
    expect(found.said).toBe(" and on")
    // One drop, one repaint. A restored pipe costs a fold and nothing more.
    expect(found.folded).toBe(2)
    expect(found.attached).toBe(2)
    /**
     * Each watch named the position its own fold ended at, and the second is
     * past the first. That is the convergence: the page asked for what it had
     * not seen, and for nothing it had.
     */
    expect(found.resumed).toEqual([1, 3])
    /**
     * What a reader was told, in order. A page frozen on a dead pipe reads as
     * a Session that stopped, so the page says which of the two it is — and it
     * says the catching up too, because the refold behind it is the Client's.
     */
    expect(steps(found.walked)).toEqual(["ready", "disconnected", "synchronizing", "ready"])
  })

  /**
   * The reload. A page that is killed mid-Run and opened again is two pages
   * and one record: the second folds what the first had and what was said
   * while nothing was watching, and then hears only what follows.
   *
   * A refresh costs a repaint and not a replay, and the honest way to say that
   * is to count what came back over the watch behind the second fold.
   */
  it("converges by Cursor when the page is killed mid-Run and opened again", async () => {
    const found = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { memory, wire } = yield* wired()
          const client = yield* makeClient(wire)
          yield* memory.say({ kind: "started", intent: "ask" })

          const before = yield* opened(client, memory.session)
          yield* until("the committed fold", () => folds(before.held) === 1)
          yield* until("a live watch", () => memory.open() > 0)
          yield* memory.say(word("par"))
          yield* until("the live word", () => before.at().said === "par")

          // The browser is killed. The far side is waited on, because a page
          // whose socket is still open is a page that has not gone.
          yield* before.stop
          yield* until("the far side let the watch go", () => memory.open() === 0)
          yield* memory.say(word("tial"))

          // And opened again. It carries nothing over: a reload starts from
          // the record, which is the only thing a fresh page has.
          const after = yield* opened(client, memory.session)
          yield* until("the fold the reload took", () => folds(after.held) === 1)
          yield* until("a live watch again", () => memory.open() > 0)

          const replayed = after.at().said
          yield* memory.say(word(" and on"))
          yield* until("the word after the reload", () => after.at().said === " and on")

          yield* after.stop
          return {
            first: wordsIn(before.held.at(-1)),
            words: wordsIn(after.held.at(-1)),
            replayed,
            said: after.at().said,
            resumed: resumed(memory.calls),
            attached: counted(memory.calls, "attach"),
          }
        }),
      ),
    )

    // The first page folded what was there when it opened, and heard the rest.
    expect(found.first).toBe("ask")
    // The second folded all of it, the word said while nothing was watching
    // included. No gap.
    expect(found.words).toBe("askpartial")
    /**
     * And its watch replayed none of it. Two folds, two positions, and the
     * second names where the first ended plus what commit while nobody was
     * reading — which is the whole of what a reload costs.
     */
    expect(found.replayed).toBe("")
    expect(found.said).toBe(" and on")
    expect(found.attached).toBe(2)
    expect(found.resumed).toEqual([1, 3])
  })

  /**
   * The refusal, over the wire. The head moved past the replay bound between
   * the fold and the watch that resumed from it, so the far side answers the
   * subscription with a status and no stream — and the page answers that with
   * a fresh fold rather than with a gap.
   *
   * `refuse(1)` is the filler's way of reaching the bound without writing a
   * thousand events.
   */
  it("answers a Cursor the far side refuses with a fresh fold", async () => {
    const found = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { memory, wire } = yield* wired()
          const client = yield* makeClient(wire)
          yield* memory.say({ kind: "started", intent: "ask" })
          memory.refuse(1)

          const page = yield* opened(client, memory.session)
          yield* until("the fold that answers the refusal", () => folds(page.held) === 2)

          // The watch behind the second fold followed the record, which is
          // what says the page is reading again and not merely repainted.
          yield* until("a live watch", () => memory.open() > 0)
          yield* memory.say(word(" and on"))
          yield* until("the live word", () => page.at().said === " and on")

          yield* page.stop
          return {
            words: wordsIn(page.held.at(-1)),
            said: page.at().said,
            attached: counted(memory.calls, "attach"),
            folded: folds(page.held),
          }
        }),
      ),
    )

    // One fold for the refused watch, and one that answers the refusal.
    expect(found.attached).toBe(2)
    expect(found.folded).toBe(2)
    // Nothing was lost to the refusal, and nothing of it reached the page.
    expect(found.words).toBe("ask")
    expect(found.said).toBe(" and on")
  })

  /**
   * The server itself, taken away and put back — which is what a person does
   * with Ctrl-C and `eva serve --web` again. The Client is over the wire alone
   * here, with nothing between it and the socket: what says the pipe is down is
   * the far side not answering, and what says it is back is a call that got an
   * answer.
   */
  it("says the pipe is down when the server goes, and back when it returns", async () => {
    const found = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { memory, server, wire } = yield* wired()
          const client = yield* makeClient(wire)

          const walked: ClientState[] = []
          const walking = yield* Effect.forkChild(
            Stream.runForEach(SubscriptionRef.changes(client.state), (one) =>
              Effect.sync(() => void walked.push(one)),
            ),
          )

          yield* memory.say({ kind: "started", intent: "ask" })
          const page = yield* opened(client, memory.session)
          yield* until("the committed fold", () => folds(page.held) === 1)
          yield* until("a live watch", () => memory.open() > 0)

          yield* server.stop
          yield* until(
            "a page that says the pipe is down",
            () => SubscriptionRef.getUnsafe(client.state) === "disconnected",
          )
          // The record moves while nothing is serving it.
          yield* memory.say(word("said to nobody"))

          // The same Session, served again on the same port. The page holds no
          // address, so what it asks for is unchanged.
          const again = yield* served(memory.api, server.port)
          yield* until(
            "a page that says the pipe is back",
            () => SubscriptionRef.getUnsafe(client.state) === "ready",
          )
          yield* until("the fold that followed the pipe coming back", () => folds(page.held) === 2)

          yield* page.stop
          yield* Fiber.interrupt(walking)
          yield* again.stop
          return { words: wordsIn(page.held.at(-1)), walked }
        }),
      ),
    )

    // The word said while nothing was serving is on the page, from the fold
    // that followed the pipe coming back.
    expect(found.words).toBe("asksaid to nobody")
    expect(steps(found.walked)).toEqual(["ready", "disconnected", "synchronizing", "ready"])
  })
})
