import type { Client, RunSignal } from "@missingstudio/eva-client-runtime"
import type { SessionHeader } from "@missingstudio/eva-core"
import type { Payload, SessionID } from "@missingstudio/eva-schema"
import { blocksOf } from "@missingstudio/eva-session-view"
import { Effect, Fiber, Stream, SubscriptionRef } from "effect"
import { useEffect, useState } from "react"
import { client } from "./eva.js"
import type { Folded, Reading } from "./session.js"
import { useSessions } from "./sessions.js"
import type { Pipe } from "./shell.js"

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
 * What one Run signal changes about what the page holds. A fold replaces the
 * tail, so the tail goes with it; a payload of the live stream grows it.
 *
 * The protocol behind the signals is the Client's: attach, watch from the
 * fold's own position, and fold again however the watch ended — the Run
 * closed, the pipe went, or the Cursor was refused. This page held a second
 * spelling of that rule until `Client.follow` existed, and it read the
 * bracketing payloads for whether a Run is open until the follow said so
 * itself. What is here is the page's own: which Blocks it draws and what it
 * prices.
 */
const readingOf =
  (signal: RunSignal, running: boolean) =>
  (was: Reading): Reading => {
    if (signal.kind === "payload") {
      return { ...was, running, said: tailOf(was.said, signal.payload) }
    }
    const folded: Folded = {
      kind: "folded",
      at: signal.transcript.at,
      turns: blocksOf(signal.transcript),
      cost: signal.transcript.cost(),
    }
    return { ...was, folded, said: "", running }
  }

/**
 * One Session, followed through the Client. It is the page's whole reading
 * protocol: one call, and the signals it answers with.
 */
export const follow = (
  one: Client,
  session: SessionID,
  each: (reading: (was: Reading) => Reading) => void,
): Effect.Effect<void> => one.follow(session, (signal, running) => each(readingOf(signal, running)))

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
  const [reading, setReading] = useState<Reading>({
    folded: { kind: "folding" },
    said: "",
    running: false,
  })

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
 * The frame reads it, once, for both routes. Nothing about the pipe is
 * remembered here: what a surface says is what the runtime is saying now, and
 * a page that kept a memory of its own would say it after it stopped being
 * true.
 */
export const usePipe = (): Pipe => {
  const [pipe, setPipe] = useState<Pipe>({ at: "ready" })

  useEffect(
    () =>
      whileDrawn((one) =>
        Stream.runForEach(SubscriptionRef.changes(one.state), (at) =>
          Effect.sync(() => setPipe({ at })),
        ),
      ),
    [],
  )

  return pipe
}
