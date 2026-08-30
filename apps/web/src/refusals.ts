import { Effect, Stream, SubscriptionRef } from "effect"
import { refusals } from "./eva.js"
import { told, useHeld } from "./held.js"

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
 * The refusal the page holds, and the channel it arrives on.
 *
 * One page, one answer: the composer draws it where a person is typing and
 * the index draws it where a person pressed, and a refusal cleared in one
 * that stood in the other would be two answers to what the far side last
 * said. When the channel opens, and that it never closes, are `told`'s.
 */
const held = told<string | undefined>(undefined, (tell) => {
  void refusals().then((channel) =>
    Effect.runFork(
      Stream.runForEach(SubscriptionRef.changes(channel), (one) =>
        Effect.sync(() => {
          if (one !== undefined) tell(one.said)
        }),
      ),
    ),
  )
})

export const useRefusal = (): Refused => {
  const shown = useHeld(held)

  return { ...(shown === undefined ? {} : { said: shown }), clear: () => held.tell(undefined) }
}
