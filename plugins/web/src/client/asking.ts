import { framesIn } from "@missingstudio/eva-client-runtime"
import type { FrontendRequest } from "@missingstudio/eva-sdk"
import { askingIn, ASKING_PATH, EVENT_STREAM } from "../wire.js"

/**
 * The page's half of the ask channel. It lives with the surface that serves
 * the page, exactly as `plugins/api`'s client half lives with the wire it
 * reads — so a page holds no wire of its own and knows no address.
 *
 * The origin is nothing by default, which is the origin the page was served
 * by: `eva.web` serves the page and answers this stream on the one port.
 */

// How long a reader that lost the stream waits before opening it again, in
// milliseconds. A question that arrived while the pipe was down is on the
// first frame of the new stream, because a frame carries the whole set.
export const REOPEN_GAP = 500

export interface AskingOptions {
  readonly origin?: string
  readonly gap?: number
  // What makes the request. The global, unless a caller hands over its own —
  // which is how a suite drives this without a socket.
  readonly request?: typeof globalThis.fetch
}

/**
 * Reads the questions that stand, for as long as the returned stop is not
 * called. `each` is called with the whole set every time it changes, so a
 * caller keeps no bookkeeping and a set it cannot read leaves the last one
 * standing.
 *
 * It is a plain function and not an Effect: the caller is a drawing, and a
 * drawing that had to run a fiber to read one field would be a page holding a
 * runtime of its own.
 */
export const watchAsking = (
  each: (asking: readonly FrontendRequest[]) => void,
  options: AskingOptions = {},
): (() => void) => {
  const origin = options.origin ?? ""
  const gap = options.gap ?? REOPEN_GAP
  const request = options.request ?? fetch
  const stopping = new AbortController()

  const read = async (): Promise<void> => {
    const response = await request(`${origin}${ASKING_PATH}`, {
      signal: stopping.signal,
      headers: { accept: EVENT_STREAM },
    })
    const body = response.body
    if (body === null) return

    // The framing is the client runtime's: a frame split across two reads is
    // still one frame, and the remainder rule that says so lives there once.
    const reader = body.pipeThrough(new TextDecoderStream()).getReader()
    let held = ""
    for (;;) {
      const { done, value } = await reader.read()
      if (done === true) return
      const found = framesIn(held + value)
      held = found.rest
      for (const frame of found.frames) {
        const asking = askingIn(frame.data)
        if (asking !== undefined) each(asking)
      }
    }
  }

  // The stream ending is not the end of the questions: it is a pipe that
  // went, and the next one carries whatever stands by then.
  const open = async (): Promise<void> => {
    while (!stopping.signal.aborted) {
      try {
        await read()
      } catch {
        // The pipe went, or the stop aborted it. Either way the loop decides.
      }
      if (stopping.signal.aborted) return
      await new Promise((wake) => setTimeout(wake, gap))
    }
  }

  void open()
  return () => stopping.abort()
}
