/**
 * The loop's own rules, as a fold. The Console says what the screen shows;
 * this says what the loop does next — which Run is open, which lines are
 * waiting behind it, and which `settled` closes which Run.
 *
 * It is here for the reason the Console fold is: those rules are where the
 * races live, and until this they were mutable locals inside the surface,
 * reachable only through a real renderer, a real Client and a real event
 * loop. Their suite slept for them. This one does not.
 *
 * Nothing here touches a fiber, the Session API or the clock. It is handed
 * what happened and answers with what to do; the surface does it.
 */

// Where the loop stands.
export interface LoopState {
  /**
   * The one open Run, by the number that names it. A Run that ended while a
   * cancel was landing cannot close the one that follows it, because the
   * number the loop is holding is not the number that stopped.
   */
  readonly open?: number
  // Lines typed while a Run was open. They wait their turn rather than
  // racing it, oldest first.
  readonly pending: readonly string[]
  // How many Runs this loop has opened. It only ever counts up, so no two
  // Runs of one Console share a number.
  readonly runs: number
}

export const idle: LoopState = { pending: [], runs: 0 }

/**
 * What happened. A line is what a person submitted, however it was typed —
 * at the prompt or taken from the panel — and `handled` is what running it
 * turned out to mean.
 */
export type LoopStep =
  /**
   * A line left the editor. `asking` is whether a question is open, because
   * a line then answers it rather than meaning anything else. `steer` is
   * whether the person used the steer gesture instead of submitting, which
   * is a different thing to mean and not the queue.
   */
  | {
      readonly kind: "line"
      readonly line: string
      readonly asking: boolean
      readonly steer?: boolean
    }
  /**
   * The line was dispatched. `ran` says a command answered it, so no Run
   * opens; `moved` says that command opened another Session, so the screen
   * follows it there.
   */
  | {
      readonly kind: "handled"
      readonly line: string
      readonly ran: boolean
      readonly moved: boolean
    }
  // The Run this names has stopped, whether it finished or was interrupted.
  | { readonly kind: "settled"; readonly run: number }
  // The person cancelled whatever was open.
  | { readonly kind: "cancel" }
  // The Console is going away.
  | { readonly kind: "quit" }

// What the surface is asked to do. Everything that reaches outside the fold
// is one of these.
export type LoopAction =
  // The line answers the open question.
  | { readonly kind: "answer"; readonly line: string }
  // Dispatch the line: run the command it names, or report it opened a Run.
  | { readonly kind: "handle"; readonly line: string }
  /**
   * Steer with this line. A steer rides the Run that is open and returns at
   * once, so it opens no Run, takes no number and leaves the queue alone.
   */
  | { readonly kind: "steer"; readonly line: string }
  // Open a Run on this line, under this number.
  | { readonly kind: "open"; readonly run: number; readonly line: string }
  // Fold the record onto the screen, because the Session moved.
  | { readonly kind: "refresh" }
  // Stop this Run.
  | { readonly kind: "interrupt"; readonly run: number }
  // Read how this Run ended, and say so if it failed.
  | { readonly kind: "settle"; readonly run: number }
  // Tell Eva the person cancelled, say so, and fold what was kept.
  | { readonly kind: "cancelled" }
  // Leave the loop.
  | { readonly kind: "stop" }

export interface Stepped {
  readonly state: LoopState
  readonly actions: readonly LoopAction[]
}

const only = (state: LoopState, ...actions: readonly LoopAction[]): Stepped => ({ state, actions })

/**
 * The same loop, with no Run open and the given lines waiting. The key is
 * dropped rather than set to `undefined`: no Run open and a Run named
 * `undefined` are one thing said two ways.
 */
const closed = (state: LoopState, pending: readonly string[] = state.pending): LoopState => ({
  pending,
  runs: state.runs,
})

/**
 * One step of the loop. A step answers with every action it wants, in the
 * order they are to happen, so an action a caller drops is a rule it broke
 * rather than a line it forgot.
 */
export const stepped = (state: LoopState, step: LoopStep): Stepped => {
  switch (step.kind) {
    case "line": {
      // A question outranks everything a line could otherwise mean.
      if (step.asking) return only(state, { kind: "answer", line: step.line })
      // A steered line is the gesture the person made, open Run or not. It
      // changes nothing here, because steering opens no Run.
      if (step.steer === true) return only(state, { kind: "steer", line: step.line })
      // A line typed during a Run waits its turn rather than racing it.
      if (state.open !== undefined) {
        return only({ ...state, pending: [...state.pending, step.line] })
      }
      return only(state, { kind: "handle", line: step.line })
    }

    case "handled": {
      if (!step.ran) {
        const run = state.runs + 1
        return only(
          { ...state, runs: run, open: run },
          {
            kind: "open",
            run,
            line: step.line,
          },
        )
      }
      /**
       * A command that opened another Session is followed there: what the
       * screen shows is the fold of the Session now open, which for a new
       * one is nothing — that is what clearing looks like.
       */
      return step.moved ? only(state, { kind: "refresh" }) : only(state)
    }

    case "settled": {
      // A Run that is not the one being held closes nothing. This is what
      // keeps a Run that ended during a cancel from closing its successor.
      if (state.open !== step.run) return only(state)
      const [next, ...rest] = state.pending
      const settled: LoopAction = { kind: "settle", run: step.run }
      const after = closed(state, rest)
      return next === undefined
        ? only(after, settled)
        : only(after, settled, { kind: "handle", line: next })
    }

    case "cancel": {
      /**
       * Stop means stop: the lines waiting behind the Run are dropped with
       * it. Eva is told whether or not a Run was open here, because a cancel
       * with nothing open is still the answer to a question Eva asked.
       */
      const after = closed(state, [])
      return state.open === undefined
        ? only(after, { kind: "cancelled" })
        : only(after, { kind: "interrupt", run: state.open }, { kind: "cancelled" })
    }

    case "quit": {
      const after = closed(state, [])
      return state.open === undefined
        ? only(after, { kind: "stop" })
        : only(after, { kind: "interrupt", run: state.open }, { kind: "stop" })
    }
  }
}
