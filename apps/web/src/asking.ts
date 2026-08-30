import { watchAsking } from "@missingstudio/eva-api/client"
import type { FrontendRequest } from "@missingstudio/eva-sdk"
import type { Asking } from "@missingstudio/eva-session-view"
import { Effect } from "effect"
import { useEffect, useState } from "react"
import { client } from "./eva.js"
import { sent } from "./refusals.js"

/**
 * The permission requests that stand, and how the page answers one.
 *
 * This is the one thing the page reads that is not the record, and it cannot
 * come from the record: nobody has answered the question yet, so nothing about
 * it is recorded — a request that has been answered is the Disposition of the
 * call it gated. So the questions that stand are streamed on the port that
 * served the page, and the page reads that stream through `eva.api`'s client
 * half, exactly as it reads the rest of the wire. No address and no socket is
 * named here.
 *
 * The answer goes back through the Client, because an answer is a Session API
 * call and every one of those goes through `client-runtime`.
 */

// The Block shape, from the request that travelled whole. A Block says
// `request` where the contract says `id`, because that is what it is the id
// of — the one translation on this channel, and it is the drawing's. The kind
// travels with it, because it is what a line typed in answer is read by.
const asked = (one: FrontendRequest): Asking => ({
  kind: one.kind,
  request: one.id,
  question: one.question,
})

// The questions that stand, for as long as the page is drawn.
export const useAsking = (): readonly Asking[] => {
  const [asking, setAsking] = useState<readonly Asking[]>([])

  useEffect(() => watchAsking((standing) => setAsking(standing.map(asked))), [])

  return asking
}

/**
 * How the page answers one request. The id is the tool call's, which the
 * `tool_call` record named before anybody was asked, and the option is one of
 * `PERMISSION_OPTIONS` — so the gate reads the answer with no table between
 * the two.
 *
 * Nothing is waited on here. The gate races the two doors and the first answer
 * wins; a second one is refused as already answered, and the record is where
 * the outcome is — and a refusal of this write is said on the page, because
 * `sent` is what a write that nobody waits for goes through.
 */
export const answer = (request: string, optionId: string): void =>
  sent(
    client().then((one) =>
      Effect.runPromise(one.api.answer(request, { kind: "permission", optionId })),
    ),
  )
