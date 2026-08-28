import type { SessionHeader } from "@missingstudio/eva-core"
import type { SessionID } from "@missingstudio/eva-schema"
import { Effect } from "effect"
import { useEffect, useState } from "react"
import { client } from "./eva.js"
import { sessionHref } from "./paths.js"

/**
 * What the page has: the Sessions Eva holds, or not yet. There is no third
 * state, because a call made while the pipe is down is slower and never
 * differently typed — a listing that has not arrived has not arrived yet.
 */
export type Listing =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly sessions: readonly SessionHeader[] }

/**
 * The listing, read once for however many readers ask at once.
 *
 * The rail and the Session both want it and both mount in the same tick, so
 * without this the page asks Eva what it holds twice and holds two answers to
 * one question. Only the call in flight is shared, never the answer: a reader
 * that asks after one has settled reads again, which is what a page that has
 * just opened another Session wants.
 */
let asking: Promise<readonly SessionHeader[]> | undefined

const listed = (): Promise<readonly SessionHeader[]> => {
  const asked = (asking ??= client()
    .then((one) => Effect.runPromise(one.api.list))
    .finally(() => {
      if (asking === asked) asking = undefined
    }))
  return asked
}

/**
 * Everything on the page drawing the listing right now.
 *
 * A write that changed what Eva holds has to reach all of them: the rail and
 * the Session's own Header are two views of one listing, and one that heard
 * the change while the other did not is two answers to what Eva holds. The
 * rail never unmounts — that is the point of the frame — so nothing else
 * would tell it.
 */
const readers = new Set<() => void>()

// Reads the listing again, for every reader at once. The held call is let go
// of first, so what they share is the new answer and not the old one.
const reread = (): void => {
  asking = undefined
  for (const wake of readers) wake()
}

export const useSessions = (): Listing => {
  const [listing, setListing] = useState<Listing>({ kind: "reading" })

  useEffect(() => {
    // The call outlives a page that navigated away from it, so the answer is
    // dropped rather than written into a component nobody is drawing.
    let drawing = true
    const read = (): void => {
      void listed().then((sessions) => {
        if (drawing) setListing({ kind: "read", sessions })
      })
    }
    readers.add(read)
    read()
    return () => {
      drawing = false
      readers.delete(read)
    }
  }, [])

  return listing
}

/**
 * Open a Session, then go and read it. A plain load, because the rows on the
 * listing are plain anchors for the same reason: `eva.web` answers a path
 * with no extension with the page, so the route is resolved on the load.
 *
 * The call names no directory. A browser holds no honest path, so the
 * Session opens where the process answering the call is.
 */
export const opening = (): void =>
  void client()
    .then((one) => Effect.runPromise(one.api.create()))
    .then((made) => {
      window.location.assign(sessionHref(made))
    })

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
    .then(reread)
