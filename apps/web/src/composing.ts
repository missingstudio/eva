import {
  idle,
  stepped,
  type LoopAction,
  type LoopState,
  type LoopStep,
} from "@missingstudio/eva-client-runtime"
import { optionFor } from "@missingstudio/eva-core"
import type { SessionID } from "@missingstudio/eva-schema"
import type { Asking } from "@missingstudio/eva-session-view"
import { Effect } from "effect"
import { useRef, useState } from "react"
import type { Composing } from "./composer.js"
import { client } from "./eva.js"
import { sessionHref } from "./paths.js"

/**
 * How the page says something to Eva, and the rules it says it by.
 *
 * The rules are not this page's. `client-runtime` holds the composer fold the
 * terminal steps — which line answers a question, which one waits behind a
 * Run, what a cancel drops — so a line typed at either door means the same
 * thing for one reason and not for two. What is here is the doing: the calls
 * the fold's actions turn into, all of them through the one Client.
 */

/**
 * A Prompt, and the Run it opened. `submit` answers when that Run has closed
 * — the contract every filler of the Session API keeps — so it is also what
 * says the queue may move, and the page needs no fiber of its own to hear it.
 */
const prompted = (session: SessionID, line: string): Promise<void> =>
  client().then((one) => Effect.runPromise(one.api.submit(session, { kind: "prompt", text: line })))

const stopped = (session: SessionID): void =>
  void client().then((one) => Effect.runPromise(one.api.cancel(session, "user")))

/**
 * The line, as an answer to the question that stands. The four options are
 * words a person can type, so the line is read for one first and a line that
 * names none goes as the text it is — which is how the terminal reads a line
 * typed at a standing question, and the gate reads both back the same way.
 */
const replied = (request: string, line: string): void => {
  const option = optionFor(line)
  void client().then((one) =>
    Effect.runPromise(
      one.api.answer(
        request,
        option === undefined
          ? { kind: "text", text: line }
          : { kind: "permission", optionId: option },
      ),
    ),
  )
}

/**
 * Where a Session this page opens goes. A browser holds no path, so what it
 * names is the place the process answering the call is in.
 */
const HERE = "."

/**
 * Open a Session, then go and read it. A plain load, because the rows on the
 * listing are plain anchors for the same reason: `eva.web` answers a path
 * with no extension with the page, so the route is resolved on the load.
 */
export const opening = (): void =>
  void client()
    .then((one) => Effect.runPromise(one.api.create(HERE)))
    .then((made) => {
      window.location.assign(sessionHref(made))
    })

/**
 * What the page can be asked to do. It is handed in rather than reached for,
 * so the loop is provable with no Client standing behind it.
 */
export interface Doing {
  // Open a Run on this line, under the number the fold gave it, and say when
  // that Run has closed.
  readonly open: (run: number, line: string) => void
  readonly cancel: () => void
  readonly answer: (line: string) => void
}

/**
 * What the page does with one action, and the step that doing it turned out
 * to mean. The fold answers with everything a terminal would do, so what this
 * page does with each action is the whole of what a page is able to do.
 */
const performed = (action: LoopAction, doing: Doing): LoopStep | undefined => {
  switch (action.kind) {
    case "answer":
      doing.answer(action.line)
      return undefined
    /**
     * A line this page dispatches always opens a Run. The terminal asks a
     * command registry of its own first; this page holds none — a `/` line is
     * Eva's to answer over the wire, and until it is, the line is a Prompt.
     */
    case "handle":
      return { kind: "handled", line: action.line, ran: false, moved: false }
    case "open":
      doing.open(action.run, action.line)
      return undefined
    /**
     * Eva is told the person stopped. The `interrupt` beside it is a fiber
     * the terminal holds and this page does not — the page submits and does
     * not run the Run — so telling Eva is the whole of what a stop is here.
     */
    case "cancelled":
      doing.cancel()
      return undefined
    /**
     * Nothing. `settle` reads how a fiber ended, `interrupt` stops one,
     * `refresh` follows a Session a command moved, `steer` is a gesture this
     * page does not make yet, and `stop` leaves a loop it does not run.
     */
    case "settle":
    case "interrupt":
    case "refresh":
    case "steer":
    case "stop":
      return undefined
  }
}

/**
 * One step, and every step that doing it turned out to mean. It is the
 * terminal's `walk` with a page behind it: the fold decides, the caller does
 * it, and what the doing found out is another step.
 */
export const walk = (state: LoopState, step: LoopStep, doing: Doing): LoopState => {
  let standing = state
  let next: LoopStep | undefined = step
  while (next !== undefined) {
    const answered = stepped(standing, next)
    standing = answered.state
    next = undefined
    for (const action of answered.actions) next = performed(action, doing) ?? next
  }
  return standing
}

/**
 * The composer's half of one Session: what waits, what is open, and the two
 * gestures. The loop is held in a ref because it is what the page is doing
 * and not what it is drawing; what is drawn is the state each walk left.
 */
export const useComposer = (session: SessionID, asking: readonly Asking[] = []): Composing => {
  const held = useRef<LoopState>(idle)
  const [shown, setShown] = useState<LoopState>(idle)

  // The question a typed line answers is the first one standing, which is the
  // one the terminal answers too.
  const standing = asking[0]?.request

  const drive = (step: LoopStep): void => {
    held.current = walk(held.current, step, {
      open: (run, line) =>
        void prompted(session, line).finally(() => drive({ kind: "settled", run })),
      cancel: () => stopped(session),
      answer: (line) => {
        if (standing !== undefined) replied(standing, line)
      },
    })
    setShown(held.current)
  }

  return {
    pending: shown.pending,
    open: shown.open !== undefined,
    send: (line) => drive({ kind: "line", line, asking: standing !== undefined }),
    stop: () => drive({ kind: "cancel" }),
  }
}
