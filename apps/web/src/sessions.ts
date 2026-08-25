import type { SessionHeader } from "@missingstudio/eva-core"
import { Effect } from "effect"
import { useEffect, useState } from "react"
import { client } from "./eva.js"

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
