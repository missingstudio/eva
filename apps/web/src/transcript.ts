import type { Client } from "@missingstudio/eva-client-runtime"
import type { ResumeTooFarBehind, SessionHeader } from "@missingstudio/eva-core"
import type { Payload, SessionID } from "@missingstudio/eva-schema"
import { blocksOf } from "@missingstudio/eva-session-view"
import { Effect, Fiber, Stream } from "effect"
import { useEffect, useState } from "react"
import { client } from "./eva.js"
import type { Folded, Reading } from "./session.js"
import { useSessions } from "./sessions.js"

/**
 * One Session's Header, out of the listing it came from. The Session API has
 * no method that answers one Header, and the listing is a fold of Headers —
 * so this is where the page gets a title, and it is a separate read from the
 * record: the Header arrives first and the page draws it first.
 */
export const useHeader = (session: SessionID): SessionHeader | undefined => {
  const listing = useSessions()
  return listing.kind === "read" ? listing.sessions.find((one) => one.id === session) : undefined
}

/**
 * What the open Run has streamed so far, in the words it said. The tail is
 * not the fold: it grows by append while a Run is open and the fold takes its
 * place when the Run closes, so what is not text here is not lost — it
 * arrives as a Block moments later, from the record.
 */
export const tailOf = (said: string, payload: Payload): string =>
  payload.kind === "text" && payload.content.type === "text" ? said + payload.content.text : said

/**
 * Attach, then watch from the fold's own position.
 *
 * Those two calls are the whole of a progressive read: the record as it
 * stands, and then what commits after it, exactly once. Nothing that commits
 * between them is missed, because the position the watch resumes from is the
 * one the fold ended at — and nothing already folded arrives twice, for the
 * same reason.
 *
 * A Run that closes is folded again, and the fold replaces the tail. That is
 * the only reason this loops. A watch that ends any other way ends the follow:
 * converging after a drop and after a reload is 007's, and so is answering a
 * refusal — which this can only meet by having been overtaken between a fold
 * and the watch that resumed from it.
 */
export const follow = (
  one: Client,
  session: SessionID,
  each: (reading: (was: Reading) => Reading) => void,
): Effect.Effect<void, ResumeTooFarBehind> =>
  Effect.gen(function* () {
    const record = yield* Effect.scoped(one.api.attach(session))
    const folded: Folded = {
      kind: "folded",
      at: record.at,
      turns: blocksOf(record),
      cost: record.cost(),
    }
    // The fold replaces the tail, so the tail goes with it.
    each(() => ({ folded, said: "" }))

    let closed = false
    yield* Stream.runForEach(
      Stream.takeUntil(one.api.watch(session, record.at), (payload) => payload.kind === "finished"),
      (payload) =>
        Effect.sync(() => {
          if (payload.kind === "finished") closed = true
          each((was) => ({ ...was, said: tailOf(was.said, payload) }))
        }),
    )

    if (closed) return yield* Effect.suspend(() => follow(one, session, each))
  })

/**
 * One Session, read and then followed. What the page holds is the committed
 * fold and the tail of the Run that is open, which is what `Frame` holds for
 * the terminal: two sources, never confused, and the fold is the one that
 * decides what a Run did.
 *
 * The cost is the Transcript's own fold and nothing here prices anything.
 */
export const useTranscript = (session: SessionID): Reading => {
  const [reading, setReading] = useState<Reading>({ folded: { kind: "folding" }, said: "" })

  useEffect(() => {
    // The follow outlives a page that navigated away from it, so it is
    // interrupted rather than left reading into a component nobody is drawing.
    let drawing = true
    let stop: (() => void) | undefined

    void client().then((one) => {
      if (!drawing) return
      /**
       * A refused Cursor ends the follow and leaves the fold on the screen.
       * Answering one by folding fresh is 007's, and a page that showed a
       * stack trace instead would be reporting the seam's own contract as a
       * fault.
       */
      const following = Effect.runFork(
        Effect.catchTag(follow(one, session, setReading), "ResumeTooFarBehind", () => Effect.void),
      )
      stop = () => void Effect.runFork(Fiber.interrupt(following))
    })

    return () => {
      drawing = false
      stop?.()
    }
  }, [session])

  return reading
}
