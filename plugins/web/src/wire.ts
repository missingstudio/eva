import { frameOut } from "@missingstudio/eva-client-runtime"
import type { FrontendRequest } from "@missingstudio/eva-sdk"

/**
 * The ask channel's wire: the path, and the two halves of its one frame.
 *
 * It is here rather than beside the server because both halves read it — the
 * surface writes the frames and the page reads them — and two spellings of one
 * frame would be two shapes to keep in step. `plugins/api`'s `wire.ts` is the
 * same split for the same reason, and the framing under both is the client
 * runtime's: one module says what a frame is, and each wire says only what its
 * frames carry.
 *
 * What travels is `FrontendRequest`, whole. It is the shape `Frontend.ask`
 * takes, so a question crosses this wire unchanged and a door at the far end
 * asks its person with the kind the gate asked it with — a wire that dropped
 * the kind made every relayed question a permission request, whatever it was.
 *
 * Nothing here touches a socket or a `node:` API, so the page's half of this
 * channel carries no server into a browser bundle.
 */

// Where the page reads the questions that stand. Outside `/api`, which the
// wire claims whole and answers every unknown path under with a refusal.
export const ASKING_PATH = "/asking"

export { EVENT_STREAM } from "@missingstudio/eva-client-runtime"

/**
 * Every question that stands, as one frame. The whole set and not the change
 * to it, so a page holds no bookkeeping: a question withdrawn — answered at
 * the other door, or the Run stopped — is a set with one fewer in it, and a
 * page that joined late reads the same frame as one that was there.
 */
export const askFrame = (asking: readonly FrontendRequest[]): string =>
  frameOut({ data: JSON.stringify({ asking }) })

const requestIn = (value: unknown): FrontendRequest | undefined => {
  if (typeof value !== "object" || value === null) return undefined
  const { kind, id, question } = value as Record<string, unknown>
  if (typeof id !== "string" || typeof question !== "string") return undefined
  return kind === "permission" || kind === "question" ? { kind, id, question } : undefined
}

/**
 * The questions a frame's data carries, or nothing when it carries no set this
 * side can read. A frame that cannot be read is not an empty set: a reader
 * looking at a question would otherwise watch it vanish because a byte was
 * wrong, so the caller keeps what it had.
 */
export const askingIn = (text: string): readonly FrontendRequest[] | undefined => {
  let read: unknown
  try {
    read = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof read !== "object" || read === null) return undefined
  const asking = (read as Record<string, unknown>)["asking"]
  if (!Array.isArray(asking)) return undefined

  const out: FrontendRequest[] = []
  for (const one of asking as readonly unknown[]) {
    const request = requestIn(one)
    if (request === undefined) return undefined
    out.push(request)
  }
  return out
}
