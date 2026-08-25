import type { Client } from "@missingstudio/eva-client-runtime"
import type { SessionID } from "@missingstudio/eva-schema"
import type { Claim } from "@missingstudio/eva-schema"
import { Effect } from "effect"
import { costLine } from "./cost-line.js"

export interface PrintResult {
  readonly claim: Claim
  readonly session: SessionID
  readonly costLine: string
}

export interface PrintOptions {
  // Continue an existing Session rather than opening a new one. The prior
  // Runs are folded back in as history, so the conversation carries.
  readonly session?: SessionID
  // The directory the new Session belongs to.
  readonly location?: string
  readonly write?: (text: string) => void
}

/**
 * One Run, printed, over the Session API like every other surface. It lives
 * beside the row that declares this surface rather than in the composition
 * root, because a surface's row and what that surface does are one thing —
 * and the next non-terminal surface should copy a plugin, not an app.
 *
 * It is not `SurfaceInfo.start`: that hands a surface a Client and nothing
 * else, and a print run is opened by a flag carrying a Prompt. Widening the
 * surface seam to carry an invocation is a change to a contract two surfaces
 * already keep, and a pipe is not reason enough.
 */
export const runPrint = Effect.fn("eva.print.run")(function* (
  client: Client,
  prompt: string,
  options: PrintOptions = {},
) {
  const write = options.write ?? ((text: string) => void process.stdout.write(text))
  const session = options.session ?? (yield* client.api.create(options.location ?? process.cwd()))

  // The runtime owns the Run, the cancel on interrupt included. The stream is
  // only what the reader sees as it is said; what the Run answered and what
  // it spent are both read off what the runtime gives back.
  const { transcript, answer } = yield* client.run(
    session,
    { kind: "prompt", text: prompt },
    (one) => {
      // A pipe's connection is the process, and the local filler it runs on
      // never drops, so nothing here is ever refolded. The union is total, so
      // the compiler says when that stops being true.
      if (one.kind !== "payload") return
      const { payload } = one
      if (payload.kind === "text" && payload.content.type === "text") {
        write(payload.content.text)
      }
    },
  )

  const claim: Claim = answer.claim ?? {
    result: "failed",
    summary: "the Run closed without a claim",
  }
  return { claim, session, costLine: costLine(transcript.cost()) } satisfies PrintResult
})
