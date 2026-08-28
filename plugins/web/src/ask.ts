import type { IncomingMessage, ServerResponse } from "node:http"
import type { Frontend, FrontendRequest } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { askFrame, ASKING_PATH, EVENT_STREAM } from "./wire.js"

/**
 * How Eva asks the person at the page, and how it knows there is one.
 *
 * The page reads the questions that stand from a stream of their own, on the
 * port that served it. It is not a Session API method: a question nobody has
 * answered has no position on the Trace — nothing about it is recorded, because
 * an answered request is the Disposition of the call it gated — and a surface
 * owns how it reaches its own person. The answer goes back the other way,
 * through `SessionAPI.answer`, which every surface writes through.
 *
 * The stream is also the presence signal, and that is what makes an
 * `interactive: true` row honest. A page that is open holds this stream, so a
 * question is offered only when somebody can read it; with no page open, and
 * again the moment the last page goes, the ask is cancelled rather than left
 * waiting. A surface that says it takes input and then holds a Run forever is
 * worse than one that declines.
 */

const STREAM = {
  "content-type": `${EVENT_STREAM}; charset=utf-8`,
  "cache-control": "no-store",
  connection: "keep-alive",
}

// The request path, with the query off it. A reader may name the stream with
// a cache-buster on it and still be reading the stream.
const pathOf = (url: string): string | undefined => {
  try {
    return new URL(url, "http://eva.invalid").pathname
  } catch {
    return undefined
  }
}

export interface AskChannel {
  // Offers the request to this channel, and says whether it took it. The
  // shape `Answering` has, for the reason it has it.
  readonly takes: (request: IncomingMessage, response: ServerResponse) => boolean
  readonly ask: Frontend["ask"]
}

// An ask nobody can hear. It is the whole of what a surface that bound no
// port answers, because there is no page behind one.
export const NOBODY: Frontend["ask"] = () => Effect.succeed({ kind: "cancelled" })

export const askChannel = (): AskChannel => {
  const readers = new Set<ServerResponse>()
  // The questions that stand, whole, so a page that opens second reads them
  // too — and reads each with the kind the gate asked it with.
  const standing = new Map<string, FrontendRequest>()
  // What to say when the last reader goes: every ask that is still waiting.
  const waiting = new Set<() => void>()

  const stated = (): readonly FrontendRequest[] => [...standing.values()]

  const broadcast = () => {
    const frame = askFrame(stated())
    for (const reader of readers) reader.write(frame)
  }

  const takes = (request: IncomingMessage, response: ServerResponse): boolean => {
    if (pathOf(request.url ?? "/") !== ASKING_PATH) return false

    response.writeHead(200, STREAM)
    readers.add(response)
    response.write(askFrame(stated()))

    response.on("close", () => {
      readers.delete(response)
      if (readers.size > 0) return
      // Taken before they are called, so one reader going answers each
      // waiting ask exactly once.
      const said = [...waiting]
      waiting.clear()
      for (const say of said) say()
    })
    return true
  }

  const ask: Frontend["ask"] = (request) =>
    Effect.suspend(() => {
      if (readers.size === 0) return Effect.succeed({ kind: "cancelled" as const })

      let said: (() => void) | undefined
      const held = Effect.callback<{ readonly kind: "cancelled" }>((resume) => {
        standing.set(request.id, request)
        broadcast()
        said = () => resume(Effect.succeed({ kind: "cancelled" as const }))
        waiting.add(said)
      })

      /**
       * The answer arrives the other way — over the socket, into
       * `SessionAPI.answer` — and the gate races the two doors, so the door
       * that loses is interrupted. This is that door: it clears the question
       * it opened however it ends, and the page hears the smaller set.
       */
      return Effect.ensuring(
        held,
        Effect.sync(() => {
          standing.delete(request.id)
          if (said !== undefined) waiting.delete(said)
          broadcast()
        }),
      )
    })

  return { takes, ask }
}
