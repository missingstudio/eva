import type { SessionHeader } from "@missingstudio/eva-core"
import type { SessionID } from "@missingstudio/eva-schema"
import { blocksOf } from "@missingstudio/eva-session-view"
import { Effect } from "effect"
import { useEffect, useState } from "react"
import { client } from "./eva.js"
import type { Folded } from "./session.js"
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
 * The record, folded. `attach` hands back a Transcript and the Blocks come
 * out of `packages/session-view`, which is the one fold that decides what a
 * Run did — the terminal reads the same one, so the two screens cannot
 * disagree.
 *
 * The cost is the Transcript's own fold and nothing here prices anything.
 * The live tail is the next step, and it resumes from `at`.
 */
export const useTranscript = (session: SessionID): Folded => {
  const [folded, setFolded] = useState<Folded>({ kind: "folding" })

  useEffect(() => {
    // The call outlives a page that navigated away from it, so the answer is
    // dropped rather than written into a component nobody is drawing.
    let drawing = true
    void client()
      .then((one) => Effect.runPromise(Effect.scoped(one.api.attach(session))))
      .then((record) => {
        if (drawing) {
          setFolded({
            kind: "folded",
            at: record.at,
            turns: blocksOf(record),
            cost: record.cost(),
          })
        }
      })
    return () => void (drawing = false)
  }, [session])

  return folded
}
