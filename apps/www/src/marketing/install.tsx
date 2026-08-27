import { installChannels as channels } from "@missingstudio/machine"
import { useId, useRef, useState } from "react"
import { SteadyLabel } from "./steady-label.js"

type ChannelId = (typeof channels)[number]["id"]

/**
 * The install snippet. It is a tab set over one code block, so both component
 * rules apply: the channels are real tabs with arrow-key movement, and the
 * copy result announces without moving focus.
 *
 * The field is the terminal panel, dark in both schemes, so everything inside
 * is on the carbon field the transcript uses, and reads the same tokens as
 * everything else — the system is dark only.
 */
export function Install({ version }: { version: string }) {
  const [active, setActive] = useState<ChannelId>("brew")
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle")
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  // The page carries this component more than once, and an id has to be unique
  // in a document or `aria-controls` points at the wrong panel.
  const uid = useId()
  const panelId = `${uid}-command`
  const tabId = (channel: string) => `${uid}-${channel}`

  const index = channels.findIndex((c) => c.id === active)
  const channel = channels[index] ?? channels[0]

  const select = (next: number) => {
    const wrapped = (next + channels.length) % channels.length
    setActive(channels[wrapped]!.id)
    tabs.current[wrapped]?.focus()
  }

  // Arrow keys move between tabs and Home/End jump to the ends. Selection
  // follows focus, which is the right choice when switching costs nothing.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      Home: 0,
      End: channels.length - 1,
    }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    select(next)
  }

  const copy = () => {
    navigator.clipboard.writeText(channel.command).then(
      () => {
        setStatus("copied")
        // Long enough for the announcement to finish before the label reverts.
        setTimeout(() => setStatus("idle"), 1600)
      },
      () => setStatus("failed"),
    )
  }

  return (
    <div className="panel-terminal max-w-measure w-full overflow-hidden rounded-xl">
      <div
        role="tablist"
        aria-label="Install channel"
        onKeyDown={onKeyDown}
        // The row wraps rather than overflowing: at 320px four channels and a
        // version number do not fit on one line, and a clipped tab is a tab
        // nobody can reach.
        className="border-graphite flex flex-wrap items-stretch border-b"
      >
        {channels.map((c, i) => {
          const selected = c.id === active
          return (
            <button
              key={c.id}
              ref={(node) => {
                tabs.current[i] = node
              }}
              type="button"
              role="tab"
              id={tabId(c.id)}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(c.id)}
              // The selected channel is carried by an underline as well as by
              // colour, because colour alone fails SC 1.4.1.
              className={`border-b-2 px-3 py-2 text-[13px] tracking-label uppercase ${
                selected ? "border-bone text-bone" : "text-mist hover:text-bone border-transparent"
              }`}
            >
              {c.label}
            </button>
          )
        })}
        <span className="text-fog tnum ml-auto self-center px-3 text-xs">v{version}</span>
      </div>

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(channel.id)}
        className="flex items-start gap-3 p-4"
      >
        {/*
          The command scrolls inside its own box rather than widening the page.
          A scroll container has to be focusable, or a keyboard reader cannot
          reach the end of a long line — hence the tabIndex and the label.
        */}
        <div
          role="region"
          aria-label={`${channel.label} install command`}
          tabIndex={0}
          className="min-w-0 flex-1 overflow-x-auto"
        >
          <code className="text-code block whitespace-pre">{channel.command}</code>
        </div>

        {/*
          "Copied" is wider than "Copy", so the label reserves the wider one and
          the command beside it never reflows when the reader clicks. That keeps
          a hidden word in the markup, so the name is set explicitly rather than
          read from the content — with the visible word inside it, per SC 2.5.3.
        */}
        <button
          type="button"
          onClick={copy}
          aria-label={status === "copied" ? "Copied" : `Copy the ${channel.label} command`}
          className="border-graphite text-fog hover:text-bone shrink-0 rounded-md border px-2 py-1 text-xs font-semibold"
        >
          <SteadyLabel
            options={["Copy", "Copied"]}
            current={status === "copied" ? "Copied" : "Copy"}
          />
        </button>
      </div>

      {/*
        The result is announced rather than only shown, and focus never moves —
        a reader who copied by keyboard stays exactly where they were.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {status === "copied"
          ? `${channel.label} install command copied`
          : status === "failed"
            ? "Copy failed. Select the command and copy it with your keyboard."
            : ""}
      </p>
    </div>
  )
}
