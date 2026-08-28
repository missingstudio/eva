import { idle, type LoopState, type LoopStep } from "@missingstudio/eva-client-runtime"
import { optionFor } from "@missingstudio/eva-core"
import type { SessionID } from "@missingstudio/eva-schema"
import type { Asking } from "@missingstudio/eva-session-view"
import { Button } from "@missingstudio/ui/components/button"
import { Textarea } from "@missingstudio/ui/components/textarea"
import { Effect } from "effect"
import { useRef, useState } from "react"
import { Wrote } from "./command.js"
import { walk, type Composing } from "./composing.js"
import { client, command } from "./eva.js"
import { sessionHref } from "./paths.js"
import type { Pipe } from "./session.js"

/**
 * The composer: what a line typed here does, and how it is drawn. The rules a
 * line is read by are `composing.ts`'s and the fold's behind it; what is here
 * is the doing — the calls each of the fold's actions turns into, all of them
 * through the one Client.
 */

/**
 * A Prompt, and the Run it opened. `submit` answers when that Run has closed
 * — the contract every filler of the Session API keeps — so it is also what
 * says the queue may move, and the page needs no fiber of its own to hear it.
 */
const prompted = (session: SessionID, line: string): Promise<void> =>
  client().then((one) => Effect.runPromise(one.api.submit(session, { kind: "prompt", text: line })))

/**
 * A steer, which rides the Run that is open. `submit` for a steer answers at
 * once rather than when a Run closed, so nothing waits on it and no Run
 * number is taken. The Run says the line back as a `message`, which the fold
 * already draws as the human-authored message it is.
 */
const steered = (session: SessionID, line: string): void =>
  void client().then((one) =>
    Effect.runPromise(one.api.submit(session, { kind: "steer", text: line, target: "next-step" })),
  )

const stopped = (session: SessionID): void =>
  void client().then((one) => Effect.runPromise(one.api.cancel(session, "user")))

/**
 * A line, run where the Domains are. A command reaches Domains rather than a
 * Session, so it goes over the transport beside the Client and never through
 * it — and it runs on the far side because a page that ran `/mode` for itself
 * would move the approval state of the process nobody is talking to.
 *
 * What it wrote is said back to the composer, which is where a reader is
 * looking. A command that opened a Session is followed there, the way the
 * terminal follows the `select` a local dispatch gives it: a `/clear` the page
 * stayed put for would read as a command that did nothing.
 */
const ran = (session: SessionID, line: string, said: (wrote: string) => void): void =>
  void command().then((over) =>
    Effect.runPromise(over(session, line)).then((answer) => {
      said(answer.wrote)
      if (answer.selected !== undefined) window.location.assign(sessionHref(answer.selected))
    }),
  )

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
 * The composer's half of one Session: what waits, what is open, and the
 * gestures. The loop is held in a ref because it is what the page is doing
 * and not what it is drawing; what is drawn is the state each walk left.
 */
export const useComposer = (session: SessionID, asking: readonly Asking[] = []): Composing => {
  const held = useRef<LoopState>(idle)
  const [shown, setShown] = useState<LoopState>(idle)
  /**
   * What the last command wrote. A command answers in words and the words
   * arrive nowhere else — it is the one write on this page whose outcome is
   * not on the record — so it is held here until the next line replaces it.
   */
  const [wrote, setWrote] = useState<string>()

  // The question a typed line answers is the first one standing, which is the
  // one the terminal answers too.
  const standing = asking[0]?.request

  const drive = (step: LoopStep): void => {
    held.current = walk(held.current, step, {
      open: (run, line) =>
        void prompted(session, line).finally(() => drive({ kind: "settled", run })),
      steer: (line) => steered(session, line),
      cancel: () => stopped(session),
      answer: (line) => {
        if (standing !== undefined) replied(standing, line)
      },
      run: (line) => ran(session, line, setWrote),
    })
    setShown(held.current)
  }

  return {
    pending: shown.pending,
    open: shown.open !== undefined,
    ...(wrote === undefined ? {} : { wrote }),
    send: (line) => drive({ kind: "line", line, asking: standing !== undefined }),
    steer: (line) => drive({ kind: "line", line, asking: standing !== undefined, steer: true }),
    stop: () => drive({ kind: "cancel" }),
  }
}

/**
 * What the queue says, and nothing while nothing waits. A queue a reader
 * cannot see is a line they type a second time, and two Runs is not what they
 * asked for.
 */
export const waitingText = (pending: readonly string[]): string | undefined =>
  pending.length === 0 ? undefined : `${pending.length} waiting`

/**
 * Why nothing can be sent, or nothing while it can. A write that cannot reach
 * the far side waits behind the pipe and retries with the key it minted once,
 * so a send during a drop is not lost — it is silent, and that is the lie: a
 * page that took a line and said nothing reads as a Run that started. So the
 * send is refused where the person is looking.
 */
export const refusalOf = (pipe: Pipe): string | undefined =>
  pipe.at === "disconnected"
    ? "Nothing goes out while the pipe is down. The line waits here, where it can be seen."
    : undefined

/**
 * What to say next: the line, how to send it, and how to stop what is open.
 * One field, because one line means one thing — a line that names a command
 * runs it where the Domains are and answers in words, and any other line is a
 * Prompt.
 *
 * `running` is what the record says — a Run any door opened is streaming into
 * this page — and `Composing.open` is what this page opened itself. Either is
 * something to stop, so the stop is offered for both.
 */
export const Composer = ({
  pipe,
  running = false,
  composer,
}: {
  readonly pipe: Pipe
  readonly running?: boolean
  readonly composer?: Composing
}) => {
  const [line, setLine] = useState("")
  const refused = refusalOf(pipe)
  const off = refused !== undefined || composer === undefined
  const waiting = waitingText(composer?.pending ?? [])
  const open = running || composer?.open === true

  /**
   * The line as either gesture takes it: trimmed, and nothing when there is
   * no line or nowhere to send one. Both read it the same way, which is the
   * rule the terminal's editor keeps for both of its keys.
   */
  const taken = (): string | undefined => {
    const said = line.trim()
    return off || said === "" ? undefined : said
  }

  const send = () => {
    const said = taken()
    if (said === undefined) return
    composer?.send(said)
    setLine("")
  }

  // The deliberate gesture. A plain line queues; this one rides the Run.
  const steer = () => {
    const said = taken()
    if (said === undefined) return
    composer?.steer(said)
    setLine("")
  }

  return (
    <section aria-label="what to say next" className="mt-8 border-graphite border-t pt-4">
      {/* Above the field, where the tail of an open Run is: it is the last
          thing the program said, and the field is for the next thing. */}
      <Wrote {...(composer?.wrote === undefined ? {} : { text: composer.wrote })} />
      <Textarea
        aria-label="a line for Eva"
        disabled={off}
        onChange={(event) => setLine(event.target.value)}
        onKeyDown={(event) => {
          // Enter sends and shift+Enter makes a line, which is what the
          // terminal is bound to: one gesture, whichever door a person is at.
          if (event.key !== "Enter" || event.shiftKey) return
          event.preventDefault()
          send()
        }}
        placeholder="Say something to Eva"
        value={line}
      />
      {/* The row beside send, which is where another gesture goes. */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button disabled={off} onClick={send} size="sm">
          Send
        </Button>
        {/*
          Steering rides a Run, so it is offered while one is going and not
          before. A control that is always drawn is a control that means
          nothing, which is the rule the stop beside it keeps.
        */}
        {open ? (
          <Button disabled={off} onClick={steer} size="sm" variant="outline">
            Steer
          </Button>
        ) : null}
        {open ? (
          <Button
            disabled={composer === undefined}
            onClick={() => composer?.stop()}
            size="sm"
            variant="outline"
          >
            Stop
          </Button>
        ) : null}
        {waiting === undefined ? null : (
          <p className="text-muted-foreground text-sm" role="status">
            {waiting}
          </p>
        )}
      </div>
      {refused === undefined ? null : (
        <p className="mt-2 text-ember text-sm" role="status">
          {refused}
        </p>
      )}
    </section>
  )
}
