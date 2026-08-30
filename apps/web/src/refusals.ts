import { Effect, Stream, SubscriptionRef } from "effect"
import { useEffect, useState } from "react"
import { refusals } from "./eva.js"

/**
 * What the far side refused, and what the page does with a write it did not
 * wait for.
 *
 * A refused write is the one failure this page must never lose. A drop is a
 * gap the runtime closes by asking again, and nothing on the page has to act
 * on it; a refusal is a decision that will not change however often it is
 * asked, so a page that swallowed one would go on showing a write nobody
 * made.
 */

/**
 * A write, sent. Nothing here waits for the answer — a Prompt answers when
 * its Run has closed, and a model is set for the next Run rather than for
 * this moment — so what is caught is the rejection and never the news.
 *
 * The news is already out: the wire says what it refused on the channel
 * below, before the call it refused rejects. What is left is a rejection
 * nobody is waiting on, and a page that let it stand would report a refusal
 * as a fault in a console instead of a sentence where a person is looking.
 */
export const sent = (writing: Promise<unknown>): void => void writing.catch(() => undefined)

/**
 * The last thing the far side refused, and how to be done with it.
 *
 * `said` is the refusal in the far side's own words. Nothing until one has
 * been refused, because a page with nothing to report reports nothing.
 */
export interface Refused {
  readonly said?: string
  readonly clear: () => void
}

/**
 * The refusal the page holds, and everything drawing it.
 *
 * One page, one answer: the composer draws it where a person is typing and
 * the index draws it where a person pressed, and a refusal cleared in one
 * that stood in the other would be two answers to what the far side last
 * said. So it is held here, the way the listing is, and every reader hears
 * the same change.
 */
let held: string | undefined
const readers = new Set<(said: string | undefined) => void>()

const tell = (now: string | undefined): void => {
  held = now
  for (const wake of readers) wake(now)
}

/**
 * The channel, read for as long as the page is open. It is opened by the
 * first reader and never closed: the pipe behind it is the page's one pipe,
 * and a refusal that arrived while nothing was drawing it is still the last
 * thing the far side said.
 */
let watching = false

const watch = (): void => {
  if (watching) return
  watching = true
  void refusals().then((channel) =>
    Effect.runFork(
      Stream.runForEach(SubscriptionRef.changes(channel), (one) =>
        Effect.sync(() => {
          if (one !== undefined) tell(one.said)
        }),
      ),
    ),
  )
}

export const useRefusal = (): Refused => {
  const [shown, setShown] = useState(held)

  useEffect(() => {
    watch()
    readers.add(setShown)
    // What was refused before this component was drawn is still what was
    // refused, so a reader that arrives late reads it rather than nothing.
    setShown(held)
    return () => void readers.delete(setShown)
  }, [])

  return { ...(shown === undefined ? {} : { said: shown }), clear: () => tell(undefined) }
}
