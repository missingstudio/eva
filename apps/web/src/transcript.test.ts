import {
  localTransport,
  makeClient,
  memorySessionAPI,
  type MemorySession,
} from "@missingstudio/eva-client-runtime"
import type { Payload } from "@missingstudio/eva-schema"
import { Effect, Fiber } from "effect"
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
    let reading: Reading = { folded: { kind: "folding" }, said: "" }
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
    expect(wordsIn(after ?? { folded: { kind: "folding" }, said: "" })).toContain("an answer")
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
          let reading: Reading = { folded: { kind: "folding" }, said: "" }
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
