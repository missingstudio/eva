import {
  idle,
  waitingText,
  walk,
  type LoopState,
  type LoopStep,
} from "@missingstudio/eva-client-runtime"
import { answerFor } from "@missingstudio/eva-core"
import type { SessionID } from "@missingstudio/eva-schema"
import { namesCommand } from "@missingstudio/eva-sdk"
import type { Asking } from "@missingstudio/eva-session-view"
import { Button } from "@missingstudio/ui/components/button"
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@missingstudio/ui/components/ai-elements/prompt-input"
import { Effect } from "effect"
import { ArrowUpIcon, LockIcon } from "lucide-react"
import { useRef, useState, type ReactNode } from "react"
import { client, command } from "./eva.js"
import { sessionHref } from "./paths.js"
import { useRefusal } from "./refusals.js"
import { sent } from "./refusals.js"
import { SAY_NEXT, type Pipe } from "./shell.js"
import { themed } from "./themes.js"

/**
 * The composer: what a line typed here does, and how it is drawn. The rules a
 * line is read by are the composer fold's in `client-runtime` — which line
 * answers a question, which one waits behind a Run, what a cancel drops — and
 * the fold walks its own answers out, so a line typed at either door means
 * the same thing for one reason and not for two. What is here is the doing —
 * the calls each of the fold's actions turns into, all of them through the
 * one Client.
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
  /**
   * What the far side refused, in its own words. Nothing until it has refused
   * something, and nothing again once the person has said the next thing.
   */
  readonly refused?: string
}

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
  sent(
    client().then((one) =>
      Effect.runPromise(
        one.api.submit(session, { kind: "steer", text: line, target: "next-step" }),
      ),
    ),
  )

const stopped = (session: SessionID): void =>
  sent(client().then((one) => Effect.runPromise(one.api.cancel(session, "user"))))

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
  sent(
    command().then((over) =>
      Effect.runPromise(over(session, line)).then((answer) => {
        said(answer.wrote)
        if (answer.selected !== undefined) window.location.assign(sessionHref(answer.selected))
      }),
    ),
  )

/**
 * The line, as an answer to the question that stands. What the line means is
 * `answerFor`'s, which is the rule the terminal answers by too: the four
 * options are words a person can type at a permission request, and every
 * other question takes the line whole. One question has one answer, whichever
 * door answers it.
 */
const replied = (asking: Asking, line: string): void => {
  sent(
    client().then((one) =>
      Effect.runPromise(one.api.answer(asking.request, answerFor(asking.kind, line))),
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
  const refused = useRefusal()
  /**
   * What the last command wrote. A command answers in words and the words
   * arrive nowhere else — it is the one write on this page whose outcome is
   * not on the record — so it is held here until the next line replaces it.
   */
  const [wrote, setWrote] = useState<string>()

  // The question a typed line answers is the first one standing, which is the
  // one the terminal answers too.
  const standing = asking[0]

  const drive = (step: LoopStep): void => {
    held.current = Effect.runSync(
      walk(held.current, step, {
        answer: (line) =>
          Effect.sync(() => {
            if (standing !== undefined) replied(standing, line)
          }),
        /**
         * A line that names a command is a command, at whichever door it was
         * typed. Whether it names one is decided here, because it is a fact
         * of the line and of nothing else — `namesCommand` is the rule
         * `dispatch` parses by, so this page and the attached terminal read
         * one line one way. A Prompt sent over to be told it is a Prompt
         * would be one write to learn the answer and a second to act on it.
         *
         * Nothing has moved yet: the answer crosses a wire, and the Session a
         * command opened is followed when it arrives — so `moved` is never
         * this page's to say.
         */
        handle: (line) =>
          Effect.sync(() => {
            if (!namesCommand(line)) return { ran: false, moved: false }
            /*
              One command is answered here: the one that paints. Every other
              runs where the Domains are, and this one cannot — the wire
              supplies no way to paint, so a `/theme` sent over it is a
              command correctly reporting that the surface it can see draws
              no colors, on a page that does.
            */
            const painted = themed(line)
            if (painted !== undefined) {
              setWrote(painted)
              return { ran: true, moved: false }
            }
            ran(session, line, setWrote)
            return { ran: true, moved: false }
          }),
        open: (run, line) =>
          Effect.sync(() => {
            // The conversation moves on, so what a command wrote before it
            // goes with it — the lifetime a Note has at every door.
            setWrote(undefined)
            sent(prompted(session, line).finally(() => drive({ kind: "settled", run })))
          }),
        /**
         * The gesture, made. A steer rides the open Run and returns at once,
         * and the Run says the line back as a `message`, so the page draws
         * nothing of its own for it.
         */
        steer: (line) => Effect.sync(() => steered(session, line)),
        /**
         * Eva is told the person stopped. The `interrupt` beside it is a
         * fiber the terminal holds and this page does not — the page submits
         * and does not run the Run — so telling Eva is the whole of what a
         * stop is here.
         */
        cancelled: () => Effect.sync(() => stopped(session)),
        /**
         * Nothing. `settle` reads how a fiber ended, `interrupt` stops one,
         * and `refresh` follows a Session a command moved — this page holds
         * no fiber and never says `moved`.
         */
        refresh: () => Effect.void,
        interrupt: () => Effect.void,
        settle: () => Effect.void,
      }),
    ).state
    setShown(held.current)
  }

  /**
   * The line, and the refusal it replaces. What was refused is what the far
   * side said about the write before this one, so a person who has said the
   * next thing is no longer reading about the last one.
   */
  const say = (line: string, steer = false): void => {
    refused.clear()
    drive({ kind: "line", line, asking: standing !== undefined, ...(steer ? { steer } : {}) })
  }

  return {
    pending: shown.pending,
    open: shown.open !== undefined,
    ...(wrote === undefined ? {} : { wrote }),
    ...(refused.said === undefined ? {} : { refused: refused.said }),
    send: (line) => say(line),
    steer: (line) => say(line, true),
    stop: () => drive({ kind: "cancel" }),
  }
}

/**
 * What a command wrote, and nothing before one has run.
 *
 * Nothing here knows what any of the commands do: the rows live where the
 * Domains do, so `/mode` and `/undo` reach this page by being on the wire and
 * not by being drawn a second time. There is no field of its own either — the
 * composer dispatches a line that names a command, the way the terminal does,
 * because two fields would be two answers to what one line means.
 *
 * What a command writes is the whole of its answer, so it is drawn as a strip
 * over the field that dispatched it — the last thing the program said, with
 * the place for the next thing directly under it. A command that would have
 * asked lists its options there instead, because this door supplies no way to
 * pick one.
 *
 * It is a strip rather than the program's dark panel: the panel is the live
 * tail's, which is a Run talking while it runs, and a command's answer is
 * neither a Run nor live.
 */
const Wrote = ({ text }: { readonly text?: string }) =>
  text === undefined || text === "" ? null : (
    <p className="wrote" role="status">
      {text}
    </p>
  )

/**
 * The lines waiting behind the Run that is open, oldest first, over the field
 * they were typed into.
 *
 * The count is the composer fold's own words, so every door says a queue the
 * same way. The lines themselves are here because a count answers how many
 * and not which: a person who typed three lines and can see three lines does
 * not type the third one again to find out whether it was taken.
 */
const Waiting = ({ pending }: { readonly pending: readonly string[] }) => {
  const said = waitingText(pending.length)

  return said === undefined ? null : (
    <div className="queue">
      <p className="waiting" role="status">
        {said}
      </p>
      <ol className="queue-lines">
        {pending.map((line, at) => (
          <li key={`${at} ${line}`}>{line}</li>
        ))}
      </ol>
    </div>
  )
}

/**
 * The doors this field has, said where a person first looks. The terminal
 * prints a line of its own for the same reason — a door nobody names is a
 * door nobody finds — and this one names the doors this surface has: a line
 * that starts with a slash runs a command, and `/help` is the one that lists
 * them.
 */
export const HINT = "type /help for the commands"

/**
 * Why nothing can be sent, or nothing while it can. A write that cannot reach
 * the far side waits behind the pipe and retries with the key it minted once,
 * so a send during a drop is not lost — it is silent, and that is the lie: a
 * page that took a line and said nothing reads as a Run that started. So the
 * send is refused where the person is looking.
 *
 * A pipe that is down outranks a write the far side refused: nothing can go
 * out at all while it is down, and that is the sentence a person acts on
 * first. The refusal keeps until they say the next thing, so it is still
 * there when the pipe is.
 */
export const refusalOf = (pipe: Pipe, refused?: string): string | undefined =>
  pipe.at === "disconnected"
    ? "Nothing goes out while the pipe is down. The line waits here, where it can be seen."
    : refused

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
  model,
  mode,
}: {
  readonly pipe: Pipe
  readonly running?: boolean
  readonly composer?: Composing
  /**
   * The model picker, handed in rather than mounted here. It reads for itself
   * and the composer reads nothing, so a composer drawn on its own is still
   * provable without a socket.
   */
  readonly model?: ReactNode
  /**
   * The mode the record last named, or nothing. It is display-only: switching
   * modes is a typed `/mode` line, and a pill that looked like a picker would
   * be a control that reaches nothing. Absent when the record holds no mode
   * Block, because the page never guesses a posture it cannot read.
   */
  readonly mode?: string
}) => {
  const [line, setLine] = useState("")
  const refused = refusalOf(pipe, composer?.refused)
  // A refused write leaves the field alive: what was refused is one write, and
  // the next line is how a person answers it. Only a dead pipe takes the
  // field away, because nothing at all goes out then.
  const off = pipe.at === "disconnected" || composer === undefined
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
    <section aria-label="what to say next">
      {/* Above the card, where the tail of an open Run is: it is the last
          thing the program said, and the field is for the next thing. */}
      <Wrote {...(composer?.wrote === undefined ? {} : { text: composer.wrote })} />
      {/* Under what the program said and over the field, because the queue is
          what the person themselves has said and has not been answered yet. */}
      <Waiting pending={composer?.pending ?? []} />
      {/*
        The card supplies the clothes and the submit plumbing. What a line
        means is decided here and in the fold behind this file: `onSubmit` is
        wired to the same walk the button was, and nothing else about the
        component is allowed an opinion on whether a line may go.
      */}
      <PromptInput className="composer" onSubmit={() => send()}>
        <PromptInputBody>
          <PromptInputTextarea
            aria-label="a line for Eva"
            className="field"
            disabled={off}
            id={SAY_NEXT}
            onChange={(event) => setLine(event.target.value)}
            placeholder="Say something to Eva"
            value={line}
          />
        </PromptInputBody>
        <PromptInputFooter className="controls">
          <PromptInputTools>
            {model}
            {mode === undefined ? null : (
              <span className="ctl">
                <LockIcon aria-hidden="true" />
                {mode}
              </span>
            )}
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
          </PromptInputTools>
          {/*
            The send keeps its accessible name. Its glyph says which way the
            line goes and never what a Run is doing: that is the record's to
            say, and a button that said it too would be a second source.
          */}
          <PromptInputSubmit aria-label="Send" className="send" disabled={off}>
            <ArrowUpIcon />
          </PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>
      {refused === undefined ? null : (
        <p className="refusal" role="status">
          {refused}
        </p>
      )}
      <p className="hint">{HINT}</p>
    </section>
  )
}
