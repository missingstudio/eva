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
 * Attach, then watch from the fold's own position. The watch resumes from the
 * position the fold ended at, so nothing between the two calls is missed and
 * nothing already folded arrives twice.
 *
 * A watch that ends is answered by folding again, however it ended: the Run
 * closed, the pipe went, or the Cursor was refused. A refusal is a fact about
 * one subscription and not an event in the Session, so a fresh fold answers it
 * and there is no gap.
 *
 * Nothing here waits for the pipe. A call made while the pipe is down is
 * slower and never differently typed, so `attach` is the wait.
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

    // A refused Cursor ends the watch. The fold below answers it.
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
 * Runs one read over the Client for as long as the component is drawn, and
 * gives back what stops it. A read outlives a page that navigated away, so it
 * is interrupted rather than left writing into a component nobody draws, and a
 * Client that settles after the page has gone is dropped.
 *
 * A plain function and not a hook, so each caller keeps its own `useEffect`
 * and its own dependencies.
 */
const whileDrawn = (over: (one: Client) => Effect.Effect<unknown>): (() => void) => {
  let drawing = true
  let stop: (() => void) | undefined

  void client().then((one) => {
    if (!drawing) return
    const running = Effect.runFork(over(one))
    stop = () => void Effect.runFork(Fiber.interrupt(running))
  })

  return () => {
    drawing = false
    stop?.()
  }
}

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

  // Nothing is caught here. A refused Cursor and a pipe that went are both
  // answered inside the follow, by folding fresh.
  useEffect(() => whileDrawn((one) => follow(one, session, setReading)), [session])

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

  useEffect(
    () =>
      whileDrawn((one) =>
        Stream.runForEach(SubscriptionRef.changes(one.state), (at) =>
          Effect.sync(() =>
            setPipe((was) => ({ at, dropped: was.dropped || at === "disconnected" })),
          ),
        ),
      ),
    [],
  )

  return pipe
}
