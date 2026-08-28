import type { SessionHeader } from "@missingstudio/eva-core"
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

export const useSessions = (): Listing => {
  const [listing, setListing] = useState<Listing>({ kind: "reading" })

  useEffect(() => {
    // The call outlives a page that navigated away from it, so the answer is
    // dropped rather than written into a component nobody is drawing.
    let drawing = true
    void client()
      .then((one) => Effect.runPromise(one.api.list))
      .then((sessions) => {
        if (drawing) setListing({ kind: "read", sessions })
      })
    return () => void (drawing = false)
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
