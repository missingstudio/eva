import {
  stepped,
  type LoopAction,
  type LoopState,
  type LoopStep,
} from "@missingstudio/eva-client-runtime"
import { namesCommand } from "@missingstudio/eva-sdk"

/**
 * What composing a line means on this page: what the page can do with one,
 * what it is asked to do about one, and which of those a step turns out to
 * mean.
 *
 * The rules are not this page's. `client-runtime` holds the composer fold the
 * terminal steps — which line answers a question, which one waits behind a
 * Run, what a cancel drops — so a line typed at either door means the same
 * thing for one reason and not for two. Nothing here reaches Eva: the doing is
 * handed in, so every rule below is provable with no Client behind it.
 */

/**
 * What the page can do with a line, and what it is holding while it does. The
 * composer is handed this rather than reaching for the Client, so what it
 * offers is provable without a socket — and one drawn with nowhere to send a
 * line says so rather than looking live, which is the rule the permission
 * card already keeps.
 */
export interface Composing {
  // The lines typed while a Run was open, oldest first. They wait their turn
  // rather than racing it.
  readonly pending: readonly string[]
  // Whether a Run this page opened is still open.
  readonly open: boolean
  readonly send: (line: string) => void
  // The same line, meant as a steer: it rides the Run that is open rather
  // than waiting behind it.
  readonly steer: (line: string) => void
  readonly stop: () => void
  // What the last line that named a command wrote back. Nothing until one has.
  readonly wrote?: string
}

/**
 * What the page can be asked to do. It is handed in rather than reached for,
 * so the loop is provable with no Client standing behind it.
 */
export interface Doing {
  // Open a Run on this line, under the number the fold gave it, and say when
  // that Run has closed.
  readonly open: (run: number, line: string) => void
  // Steer the Run that is open with this line. It opens no Run, so it takes
  // no number and there is nothing to wait for.
  readonly steer: (line: string) => void
  readonly cancel: () => void
  readonly answer: (line: string) => void
  // Run this line where the Domains are, and say what it wrote.
  readonly run: (line: string) => void
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
     * A line that names a command is a command, at whichever door it was
     * typed. Whether it names one is decided here, because it is a fact of
     * the line and of nothing else — `namesCommand` is the rule `dispatch`
     * parses by, so this page and the attached terminal read one line one
     * way. A Prompt sent over to be told it is a Prompt would be one write to
     * learn the answer and a second to act on it.
     *
     * Nothing has moved yet: the answer crosses a wire, and the Session a
     * command opened is followed when it arrives.
     */
    case "handle":
      if (!namesCommand(action.line)) {
        return { kind: "handled", line: action.line, ran: false, moved: false }
      }
      doing.run(action.line)
      return { kind: "handled", line: action.line, ran: true, moved: false }
    case "open":
      doing.open(action.run, action.line)
      return undefined
    /**
     * The gesture, made. A steer rides the open Run and returns at once, and
     * the Run says the line back as a `message`, so the page draws nothing of
     * its own for it.
     */
    case "steer":
      doing.steer(action.line)
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
     * `refresh` follows a Session a command moved, and `stop` leaves a loop
     * this page does not run.
     */
    case "settle":
    case "interrupt":
    case "refresh":
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
