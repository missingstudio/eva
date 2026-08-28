import { sessionID } from "@missingstudio/eva-schema"
import { Button } from "@missingstudio/ui/components/button"
import { Effect } from "effect"
import { useState } from "react"
import { command } from "./eva.js"

/**
 * A command line, and what the last one wrote. The line is sent whole and
 * nothing here knows what any of the commands do: the rows live where the
 * Domains do, so `/mode` and `/undo` reach this page by being on the wire and
 * not by being drawn a second time.
 *
 * What a command writes is the whole of its answer, so it is drawn on the
 * panel the open Run is drawn on — it is the program talking, in words it
 * chose. A command that would have asked lists its options there instead,
 * because this door supplies no way to pick one.
 */
export const CommandLine = ({
  run,
  wrote,
}: {
  readonly run?: (line: string) => void
  readonly wrote?: string
}) => {
  const [line, setLine] = useState("")
  // A control that reaches nothing is disabled and not hidden, and an empty
  // line names no command.
  const ready = run !== undefined && line.trim() !== ""

  const send = () => {
    if (!ready) return
    run(line)
    setLine("")
  }

  return (
    <section aria-label="command" className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="command line"
          className="h-8 min-w-0 flex-[1_1_16rem] rounded-lg border border-input bg-transparent px-2.5 py-1 disabled:opacity-50"
          disabled={run === undefined}
          onChange={(event) => setLine(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") send()
          }}
          placeholder="/mode read-only"
          value={line}
        />
        <Button disabled={!ready} onClick={send} size="sm" variant="outline">
          Run
        </Button>
      </div>
      {wrote === undefined || wrote === "" ? null : (
        <p
          className="panel-terminal my-2 whitespace-pre-wrap rounded-md px-3 py-2 text-sm"
          role="status"
        >
          {wrote}
        </p>
      )}
    </section>
  )
}

/**
 * The line, sent. A command answers in words and the words arrive nowhere
 * else — this is the one write on this page whose outcome is not on the
 * record — so what it wrote is held here until the next line replaces it.
 */
export const Commands = ({ session }: { readonly session: string }) => {
  const [wrote, setWrote] = useState<string>()

  const run = (line: string): void =>
    void command().then((over) =>
      Effect.runPromise(over(sessionID(session), line)).then((ran) => setWrote(ran.wrote)),
    )

  return <CommandLine run={run} {...(wrote === undefined ? {} : { wrote })} />
}
