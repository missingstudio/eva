import { Button } from "@missingstudio/ui/components/button"
import { Textarea } from "@missingstudio/ui/components/textarea"
import { useState } from "react"
import type { Pipe } from "./session.js"

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
