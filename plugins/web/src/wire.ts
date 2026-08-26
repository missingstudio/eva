/**
 * The ask channel's wire: the path, the frame, and the two readers of it.
 *
 * It is here rather than beside the server because both halves read it — the
 * surface writes the frames and the page reads them — and two spellings of one
 * frame would be two shapes to keep in step. `plugins/api`'s `wire.ts` is the
 * same split for the same reason.
 *
 * Nothing here touches a socket or a `node:` API, so the page's half of this
 * channel carries no server into a browser bundle.
 */

// Where the page reads the questions that stand. Outside `/api`, which the
// wire claims whole and answers every unknown path under with a refusal.
export const ASKING_PATH = "/asking"

export const EVENT_STREAM = "text/event-stream"

/**
 * One question that stands: the id an answer names, and what was asked. It is
 * a permission request without its kind — the same two fields `FrontendRequest`
 * carries, and no option list, because the four options are a constant every
 * surface already holds.
 */
export interface AskedQuestion {
  readonly id: string
  readonly question: string
}

/**
 * Every question that stands, as one frame. The whole set and not the change
 * to it, so a page holds no bookkeeping: a question withdrawn — answered at
 * the other door, or the Run stopped — is a set with one fewer in it, and a
 * page that joined late reads the same frame as one that was there.
 */
export const askFrame = (asking: readonly AskedQuestion[]): string =>
  `data: ${JSON.stringify({ asking })}\n\n`

/**
 * The questions a frame's data carries, or nothing when it carries no set this
 * side can read. A frame that cannot be read is not an empty set: a reader
 * looking at a question would otherwise watch it vanish because a byte was
 * wrong, so the caller keeps what it had.
 */
export const askingIn = (text: string): readonly AskedQuestion[] | undefined => {
  let read: unknown
  try {
    read = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof read !== "object" || read === null) return undefined
  const asking = (read as Record<string, unknown>)["asking"]
  if (!Array.isArray(asking)) return undefined

  const out: AskedQuestion[] = []
  for (const one of asking as readonly unknown[]) {
    if (typeof one !== "object" || one === null) return undefined
    const { id, question } = one as Record<string, unknown>
    if (typeof id !== "string" || typeof question !== "string") return undefined
    out.push({ id, question })
  }
  return out
}
