import type { SessionHeader } from "@missingstudio/eva-core"
import type { SessionID } from "@missingstudio/eva-schema"
import { Effect } from "effect"
import { client } from "./eva.js"
import { asked, useHeld } from "./held.js"
import { sessionHref } from "./paths.js"
import { sent } from "./refusals.js"

/**
 * What the page has: the Sessions Eva holds, or not yet. Two states, because
 * a call made while the pipe is down is slower and never differently typed —
 * a listing that has not arrived has not arrived yet.
 *
 * Whether it is on its way or stranded is not on the listing at all: it is
 * the pipe's, the frame reads it once, and the rail draws no wait while the
 * pipe is down.
 */
export type Listing =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly sessions: readonly SessionHeader[] }

/**
 * The listing, held for the whole page.
 *
 * The rail and the Session both want it and both mount in the same tick, and
 * a write that changed what Eva holds has to reach both: two views of one
 * listing that heard different things are two answers to what Eva holds. One
 * call in flight, one answer, and a re-read that wakes every reader are all
 * `asked`'s, so this says only what the listing is.
 */
const listing = asked<Listing>({ kind: "reading" }, () =>
  client()
    .then((one) => Effect.runPromise(one.api.list))
    .then((sessions): Listing => ({ kind: "read", sessions })),
)

export const useSessions = (): Listing => useHeld(listing)

/**
 * Open a Session, then go and read it. A plain load, because the rows on the
 * listing are plain anchors for the same reason: `eva.web` answers a path
 * with no extension with the page, so the route is resolved on the load.
 *
 * The call names no directory. A browser holds no honest path, so the
 * Session opens where the process answering the call is.
 */
export const opening = (): void =>
  sent(
    client()
      .then((one) => Effect.runPromise(one.api.create()))
      .then((made) => {
        window.location.assign(sessionHref(made))
      }),
  )

/**
 * Put a Session away, and read the listing again once Eva has.
 *
 * The re-read is after the call and not beside it: a listing read while the
 * write was still going would draw the Session that is about to leave, and
 * the row would come back for as long as the page stayed open.
 *
 * The record is untouched — `retire` cuts nothing — so this hides a Session
 * and destroys none of it. What the page offers no way back from is the
 * hiding, which is what the dialog in front of this says.
 */
export const retiring = (session: SessionID): Promise<void> =>
  client()
    .then((one) => Effect.runPromise(one.api.retire(session)))
    .then(listing.again)
