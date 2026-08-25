import type { Client } from "@missingstudio/eva-client-runtime"
import type { SessionHeader } from "@missingstudio/eva-core"
import type { Payload, SessionID } from "@missingstudio/eva-schema"
import { blocksOf } from "@missingstudio/eva-session-view"
import { Effect, Fiber, Stream, SubscriptionRef } from "effect"
import { useEffect, useState } from "react"
import { client } from "./eva.js"
import type { Folded, Pipe, Reading } from "./session.js"
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
 * So a watch that ends is answered by folding again, whichever of the three
 * ways it ended: the Run closed and the record holds what the tail held; the
 * pipe went; or the Cursor was refused, because the head moved past the replay
 * bound between the fold and the watch that resumed from it. A refusal is a
 * fact about one subscription and not an event in the Session, so what answers
 * it is a fresh fold and never a gap.
 *
 * Nothing here waits for the pipe. `attach` is the wait: a call made while the
 * pipe is down is slower and never differently typed, which is the seam's own
 * rule — so this asks again and the ask is held until it can be answered. What
 * a surface reads about the pipe is the Client's `state`, and it reads it to
 * say so and acts on nothing else.
 */
export const follow = (
  one: Client,
  session: SessionID,
  each: (reading: (was: Reading) => Reading) => void,
): Effect.Effect<void> =>
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

    // A refused Cursor ends this watch and says nothing to the page. What
    // answers it is the fold below, as it answers every other ending.
    const watching = Stream.catchTag(
      one.api.watch(session, record.at),
      "ResumeTooFarBehind",
      () => Stream.empty,
    )

    yield* Stream.runForEach(
      Stream.takeUntil(watching, (payload) => payload.kind === "finished"),
      (payload) => Effect.sync(() => each((was) => ({ ...was, said: tailOf(was.said, payload) }))),
    )

    return yield* Effect.suspend(() => follow(one, session, each))
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
      // Nothing is caught here. A refused Cursor and a pipe that went are both
      // answered inside the follow, by folding fresh.
      const following = Effect.runFork(follow(one, session, setReading))
      stop = () => void Effect.runFork(Fiber.interrupt(following))
    })

    return () => {
      drawing = false
      stop?.()
    }
  }, [session])

  return reading
}

/**
 * Where the runtime is, read to be said. `client-runtime` maps the health of
 * the pipe onto the three values a surface acts on, and this page acts on the
 * one thing it can: it says so.
 *
 * Whether the pipe has ever gone is kept here rather than in the Client. "The
 * pipe is back" is a thing to say only to a reader who was told it had gone,
 * and that is a fact about this page and not about the runtime.
 */
export const usePipe = (): Pipe => {
  const [pipe, setPipe] = useState<Pipe>({ at: "ready", dropped: false })

  useEffect(() => {
    let drawing = true
    let stop: (() => void) | undefined

    void client().then((one) => {
      if (!drawing) return
      const watching = Effect.runFork(
        Stream.runForEach(SubscriptionRef.changes(one.state), (at) =>
          Effect.sync(() =>
            setPipe((was) => ({ at, dropped: was.dropped || at === "disconnected" })),
          ),
        ),
      )
      stop = () => void Effect.runFork(Fiber.interrupt(watching))
    })

    return () => {
      drawing = false
      stop?.()
    }
  }, [])

  return pipe
}
