import {
  localTransport,
  makeClient,
  memorySessionAPI,
  type MemorySession,
} from "@missingstudio/eva-client-runtime"
import type { SessionAPI } from "@missingstudio/eva-core"
import type { Cursor, Payload, SessionID } from "@missingstudio/eva-schema"
import { Effect, Fiber, Stream } from "effect"
import { describe, expect, it } from "vitest"
import type { Reading } from "./session.js"
import { follow, tailOf } from "./transcript.js"

const word = (text: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text },
})

const CLOSE: Payload = { kind: "finished", claim: { result: "done", summary: "ok" } }

/**
 * One Session, followed, with what the page held at each step. The Client is
 * the local filler here: what is under test is the page's own protocol, and
 * the wire is proved where the wire is.
 */
const followed = (
  says: (memory: MemorySession) => Effect.Effect<void>,
  until: (was: Reading) => boolean,
) =>
  Effect.gen(function* () {
    const memory = yield* memorySessionAPI(() => Effect.void)
    const client = yield* makeClient(yield* localTransport(memory.api))

    const held: Reading[] = []
    let reading: Reading = { folded: { kind: "folding" }, said: "", running: false }
    const following = yield* Effect.forkChild(
      follow(client, memory.session, (next) => {
        reading = next(reading)
        held.push(reading)
      }),
    )

    // Said after the fold has been taken, so what is under test is the tail
    // and not what `attach` had already folded.
    while (held.length === 0) yield* Effect.sleep(1)
    yield* says(memory)
    while (!held.some(until)) yield* Effect.sleep(1)
    yield* Fiber.interrupt(following)
    return held
  })

/**
 * The filler's own API, with everything a watch hands back kept. What a reload
 * costs is a count of payloads, and a count is the one thing looking at the
 * screen and finding it right cannot give.
 *
 * Cast because the two forms differ in their error channel and the
 * implementation is one function, as it is where the API is built.
 */
const counting = (memory: MemorySession, heard: Payload[]): SessionAPI => ({
  ...memory.api,
  watch: ((session: SessionID, from?: Cursor) =>
    Stream.tap(
      from === undefined ? memory.api.watch(session) : memory.api.watch(session, from),
      (payload) => Effect.sync(() => void heard.push(payload)),
    )) as SessionAPI["watch"],
})

const wordsIn = (reading: Reading): string =>
  reading.folded.kind === "folded"
    ? reading.folded.turns
        .flatMap((turn) => turn.blocks)
        .map((block) => (block.kind === "words" ? block.text : ""))
        .join("")
    : ""

describe("what the tail carries", () => {
  it("grows by append, in the words the Run said", () => {
    expect(tailOf(tailOf("", word("half a ")), word("word"))).toBe("half a word")
  })

  /**
   * And it carries nothing else. What is not text is not lost: it is in the
   * record already, and the fold that replaces this tail holds it as a Block.
   */
  it("says nothing of a payload it has no words for", () => {
    expect(tailOf("held", { kind: "edit", path: "one.ts", hunks: 1 })).toBe("held")
  })
})

describe("following one Session", () => {
  /**
   * The fold first, then the tail behind it. That is the whole of a
   * progressive read on this page: a long Session is not waited on, and what
   * an open Run says arrives after what is already the record.
   */
  it("folds the record, then grows a tail from the watch behind it", async () => {
    const held = await Effect.runPromise(
      Effect.scoped(
        followed(
          (memory) =>
            Effect.flatMap(memory.say({ kind: "started", intent: "ask" }), () =>
              memory.say(word("a part")),
            ),
          (was) => was.said === "a part",
        ),
      ),
    )

    expect(held[0]?.folded.kind).toBe("folded")
    expect(held[0]?.said).toBe("")
    expect(held.at(-1)?.said).toBe("a part")
  })

  /**
   * And the fold replaces it when the Run closes. The words were the stream's
   * while the Run was open and they are the record's after it, so a reader
   * sees them once — in the tail, and then as a Turn.
   */
  it("replaces the tail with the fold when the Run closes", async () => {
    const held = await Effect.runPromise(
      Effect.scoped(
        followed(
          (memory) =>
            Effect.gen(function* () {
              yield* memory.say({ kind: "started", intent: "ask" })
              yield* memory.say(word("an answer"))
              yield* memory.say(CLOSE)
            }),
          (was) => wordsIn(was).includes("an answer"),
        ),
      ),
    )

    // The tail had the words while the Run was open.
    expect(held.some((one) => one.said === "an answer")).toBe(true)
    // And the fold that arrived after the close has them, with an empty tail.
    const after = held.at(-1)
    expect(after?.said).toBe("")
    expect(wordsIn(after ?? { folded: { kind: "folding" }, said: "", running: false })).toContain(
      "an answer",
    )
  })

  /**
   * Nothing between the two calls is missed and nothing folded arrives twice.
   * The payload said here commits after the fold has read the record and
   * before the watch it opens has subscribed, which is the one gap a Cursor
   * exists to close.
   */
  it("misses nothing said between the fold and the watch behind it", async () => {
    const found = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const memory = yield* memorySessionAPI(() => Effect.void)
          const client = yield* makeClient(yield* localTransport(memory.api))
          yield* memory.say({ kind: "started", intent: "folded already" })

          const held: Reading[] = []
          let reading: Reading = { folded: { kind: "folding" }, said: "", running: false }
          const following = yield* Effect.forkChild(
            follow(client, memory.session, (next) => {
              reading = next(reading)
              held.push(reading)
            }),
          )

          // The fold has been taken; the watch behind it has not subscribed.
          while (held.length === 0) yield* Effect.sleep(1)
          yield* memory.say(word("between"))
          yield* memory.say(word(" and after"))

          while (reading.said !== "between and after") yield* Effect.sleep(1)
          yield* Fiber.interrupt(following)
          return { held, folded: wordsIn(held[0] ?? reading) }
        }),
      ),
    )

    // Said once, in the order it was said, and no part of it twice.
    expect(found.held.at(-1)?.said).toBe("between and after")
    // What the fold already returned never reached the tail.
    expect(found.folded).toBe("folded already")
  })
})

/**
 * The head moved past the replay bound between the fold and the watch that
 * resumed from it. That is a fact about one subscription and not an event in
 * the Session, so the answer is a fresh fold: `refuse(1)` is the filler's way
 * of reaching it without writing a thousand events.
 */
describe("a Cursor the far side refuses", () => {
  it("is answered with a fresh fold, and the page shows no gap", async () => {
    const found = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const memory = yield* memorySessionAPI(() => Effect.void)
          const client = yield* makeClient(yield* localTransport(memory.api))
          yield* memory.say({ kind: "started", intent: "said before the refusal" })
          memory.refuse(1)

          const held: Reading[] = []
          let reading: Reading = { folded: { kind: "folding" }, said: "", running: false }
          const following = yield* Effect.forkChild(
            follow(client, memory.session, (next) => {
              reading = next(reading)
              held.push(reading)
            }),
          )

          // Two folds: the one the refused watch resumed from, and the one
          // that answers the refusal.
          while (held.length < 2) yield* Effect.sleep(1)
          // The watch behind the second fold followed the record, which is
          // what says the page is reading again rather than merely repainted.
          yield* memory.say(word("said after it"))
          while (reading.said !== "said after it") yield* Effect.sleep(1)
          yield* Fiber.interrupt(following)

          return { held, folded: memory.calls.filter((one) => one.method === "attach").length }
        }),
      ),
    )

    // One attach for the refused watch, and one that answers the refusal.
    expect(found.folded).toBe(2)
    // The words the first fold held are in the second, so the refusal cost a
    // repaint and left no gap.
    expect(wordsIn(found.held[1] ?? found.held[0]!)).toBe("said before the refusal")
    expect(found.held.at(-1)?.said).toBe("said after it")
  })
})

/**
 * A reload is a page that folds the record again, because that is what a page
 * with nothing on it can do. What it must not do is hear the record again: the
 * fold ends at a position and the watch resumes from it, so a refresh costs a
 * repaint and never a replay.
 *
 * The honest way to say that is to count what the watch handed back, rather
 * than to look at the screen and find it right.
 */
describe("a reload", () => {
  it("folds no payload it had already folded", async () => {
    const found = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const memory = yield* memorySessionAPI(() => Effect.void)
          const heard: Payload[] = []
          const client = yield* makeClient(yield* localTransport(counting(memory, heard)))
          yield* memory.say({ kind: "started", intent: "before" })

          // The first page: it folds what is there and hears what follows.
          const first: Reading[] = []
          let reading: Reading = { folded: { kind: "folding" }, said: "", running: false }
          const before = yield* Effect.forkChild(
            follow(client, memory.session, (next) => {
              reading = next(reading)
              first.push(reading)
            }),
          )
          while (first.length === 0) yield* Effect.sleep(1)
          yield* memory.say(word("while reading"))
          while (reading.said !== "while reading") yield* Effect.sleep(1)

          // The browser is killed, and the Session goes on without it.
          yield* Fiber.interrupt(before)
          yield* memory.say(word(" and while away"))

          // The page is opened again. Nothing of the first page is carried
          // over: a reload starts from the record, as a fresh page does.
          const replayed = heard.length
          const second: Reading[] = []
          let after: Reading = { folded: { kind: "folding" }, said: "", running: false }
          const again = yield* Effect.forkChild(
            follow(client, memory.session, (next) => {
              after = next(after)
              second.push(after)
            }),
          )
          while (second.length === 0) yield* Effect.sleep(1)
          // Long enough for a replay to have arrived if one were coming.
          for (let turn = 0; turn < 50; turn += 1) yield* Effect.sleep(1)
          yield* memory.say(word(" and after"))
          while (after.said !== " and after") yield* Effect.sleep(1)
          yield* Fiber.interrupt(again)

          return { first, second, replayed: heard.slice(replayed) }
        }),
      ),
    )

    // The reload's fold holds every word, including the one said while no
    // page was watching: it converged by Cursor with no gap.
    expect(wordsIn(found.second[0]!)).toBe("before" + "while reading" + " and while away")
    /**
     * And the watch behind that fold handed back one payload: the one said
     * after it. Nothing the fold already held was heard a second time, which
     * is the whole of what a Cursor is for.
     */
    expect(found.replayed).toEqual([word(" and after")])
    // Said on the tail once, and never twice.
    expect(found.second.at(-1)?.said).toBe(" and after")
  })
})
