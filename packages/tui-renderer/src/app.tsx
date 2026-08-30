/** @jsxImportSource @opentui/react */
import type { BorderCharacters, BorderSides, TextRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import type { Frame } from "@missingstudio/eva-tui-core"
import { useEffect, useRef } from "react"
import {
  bannerRows,
  caret,
  inputHeight,
  panelWindow,
  HINT,
  PLACEHOLDER,
  PROMPT_PREFIX,
  statusLeft,
  statusRight,
  TAGLINE,
  TITLE,
  toGroups,
  workLine,
  type Group,
  type Line,
  type WorkLine,
} from "./frame.js"
import { paletteFrom, type Palette } from "./palette.js"

// The gutter is a bar, not a rule, so the box that draws it says which
// character it draws. Only the left side is on, so the rest never appears.
const BAR = "▌"
const GUTTER: BorderCharacters = {
  topLeft: " ",
  topRight: " ",
  bottomLeft: " ",
  bottomRight: " ",
  horizontal: " ",
  vertical: BAR,
  topT: " ",
  bottomT: " ",
  leftT: " ",
  rightT: " ",
  cross: " ",
}

const colorOf = (palette: Palette, kind: Line["kind"]): string =>
  kind === "human"
    ? palette.human
    : kind === "thought"
      ? palette.thought
      : kind === "tool"
        ? palette.tool
        : kind === "system"
          ? palette.muted
          : palette.agent

// Who is speaking, said in one colour down the left of the whole turn.
const barOf = (palette: Palette, kind: Group["kind"]): string =>
  kind === "human" ? palette.accent : palette.muted

// What the screen keeps clear of the terminal's edge, on both sides. One
// number, so the fold, the line and the status all stand in one column.
const PAD = 2

const gutter = (color: string) => ({
  border: ["left"] as BorderSides[],
  customBorderChars: GUTTER,
  borderColor: color,
  paddingLeft: 1,
  flexDirection: "column" as const,
})

// A turn and the stream that becomes one are drawn the same way, so nothing
// moves when the fold replaces the stream.
const Said = ({ bar, children }: { bar: string; children: React.ReactNode }) => (
  <box style={{ paddingTop: 1 }}>
    <box style={gutter(bar)}>{children}</box>
  </box>
)

// What this build is and where it runs, said once at the top of the fold.
export const Banner = ({ frame, palette }: { frame: Frame; palette: Palette }) => (
  <box style={{ flexDirection: "column" }}>
    <box style={gutter(palette.accent)}>
      <text>
        <b style={{ fg: palette.agent }}>{TITLE}</b>
      </text>
      <text content={TAGLINE} style={{ fg: palette.muted }} />
      <text content="" />
      {bannerRows(frame).map(({ label, value }) => (
        <text key={label}>
          <span style={{ fg: palette.muted }}>{label}</span>
          <span style={{ fg: palette.agent }}>{value}</span>
        </text>
      ))}
    </box>
    <box style={{ paddingTop: 1 }}>
      <text content={HINT} style={{ fg: palette.muted }} />
    </box>
  </box>
)

/**
 * What the surface said of its own — command output, a notice, a question.
 * They stand after the conversation, in the colour the record's own system
 * lines are drawn in, because they are the surface speaking rather than a
 * Run.
 */
export const Notes = ({ frame, palette }: { frame: Frame; palette: Palette }) =>
  frame.notes.length === 0 ? null : (
    <Said bar={palette.muted}>
      {frame.notes.map((note, at) => (
        <text key={`note.${at}`} content={note} style={{ fg: palette.muted, wrapMode: "word" }} />
      ))}
    </Said>
  )

export const Turn = ({ group, palette }: { group: Group; palette: Palette }) => (
  <Said bar={barOf(palette, group.kind)}>
    {group.lines.map((line) =>
      line.kind === "human" ? (
        <text key={line.key} style={{ wrapMode: "word" }}>
          <b style={{ fg: colorOf(palette, line.kind) }}>{line.text}</b>
        </text>
      ) : (
        <text
          key={line.key}
          content={line.text}
          style={{ fg: colorOf(palette, line.kind), wrapMode: "word" }}
        />
      ),
    )}
    {group.note === "" ? null : (
      <box style={{ flexDirection: "column", paddingTop: 1 }}>
        <text content={group.note} style={{ fg: palette.muted }} />
      </box>
    )}
  </Said>
)

/**
 * The stream, while a Run is open. It stands where the turn it becomes will
 * stand, under the question that asked for it, so the answer is never drawn
 * in one place and then moved to another when the fold takes over.
 */
export const LiveArea = ({ frame, palette }: { frame: Frame; palette: Palette }) =>
  frame.live === "" ? null : (
    <Said bar={palette.muted}>
      <text content={frame.live} style={{ fg: palette.agent, wrapMode: "word" }} />
    </Said>
  )

// The fold. It scrolls, and it holds everything a Run committed. It follows
// the foot of the transcript, because that is where the newest turn lands.
export const SessionPane = ({ frame, palette }: { frame: Frame; palette: Palette }) => (
  <scrollbox style={{ flexGrow: 1, paddingTop: 1 }} focused stickyScroll stickyStart="bottom">
    <Banner frame={frame} palette={palette} />
    {toGroups(frame).map((group) => (
      <Turn key={group.key} group={group} palette={palette} />
    ))}
    <LiveArea frame={frame} palette={palette} />
    <Notes frame={frame} palette={palette} />
  </scrollbox>
)

/**
 * The terminal's own caret, put where the typing goes: the ref goes on the
 * text it belongs to, and the position is read from the corner of that text.
 * The terminal blinks it, so nothing here has to redraw to make it blink.
 *
 * There is one caret and there are two lines that may hold it, so a line
 * that does not hold it asks for none rather than fighting for it.
 */
const useCaret = (at: { readonly row: number; readonly column: number } | undefined) => {
  const renderer = useRenderer()
  const line = useRef<TextRenderable>(null)

  useEffect(() => {
    const drawn = line.current
    if (drawn === null || at === undefined) return
    renderer.setCursorStyle({ style: "block", blinking: true })
    // The line reports where it is from the corner of the screen; the
    // terminal counts its cells from one.
    renderer.setCursorPosition(drawn.x + at.column + 1, drawn.y + at.row + 1, true)
  })

  return line
}

/**
 * The one panel, over the fold and under the input line. It takes rows of
 * its own rather than floating above the transcript: a floating panel needs
 * a background to hide what is behind it, and the theme contract carries no
 * background — a color no renderer reads is not carried.
 *
 * A panel with its own query draws it; one that follows the input line does
 * not, because the line it follows is drawn just below it and the same text
 * twice reads as two different texts.
 */
export const OverlayPanel = ({ frame, palette }: { frame: Frame; palette: Palette }) => {
  const overlay = frame.overlay
  const query = `${PROMPT_PREFIX}${overlay?.query ?? ""}`
  // The caret belongs to the query line while a panel owns one: that is
  // where typing lands, so that is where the caret has to be.
  const line = useCaret(
    overlay?.source === "query" ? { row: 0, column: Array.from(query).length } : undefined,
  )
  if (overlay === undefined) return null

  const panel = panelWindow(overlay)
  return (
    <box
      title={overlay.title}
      bottomTitle={overlay.hint}
      style={{
        border: true,
        borderColor: palette.muted,
        titleColor: palette.muted,
        paddingLeft: 1,
        paddingRight: 1,
        marginTop: 1,
        flexShrink: 0,
        flexDirection: "column",
      }}
    >
      {overlay.source === "query" ? (
        <text ref={line}>
          <span style={{ fg: palette.muted }}>{PROMPT_PREFIX}</span>
          <span style={{ fg: palette.agent }}>{overlay.query}</span>
        </text>
      ) : null}
      {panel.rows.map((row, at) => {
        const chosen = panel.from + at === overlay.selected
        return (
          <text key={row.id}>
            <span style={{ fg: chosen ? palette.accent : palette.agent }}>
              {`${chosen ? "▸" : " "} ${row.label}`}
            </span>
            <span style={{ fg: palette.muted }}>{row.detail === "" ? "" : `  ${row.detail}`}</span>
          </text>
        )
      })}
    </box>
  )
}

// The surface holds the line and this only draws it, so a redraw never
// loses what somebody was part way through typing.
export const InputBar = ({ frame, palette }: { frame: Frame; palette: Palette }) => {
  const line = useCaret(frame.overlay?.source === "query" ? undefined : caret(frame))

  return (
    <box
      style={{
        border: ["top", "bottom"],
        borderColor: palette.muted,
        paddingLeft: 1,
        marginTop: 1,
        height: inputHeight(frame),
        flexShrink: 0,
      }}
    >
      <text ref={line}>
        <span style={{ fg: palette.muted }}>{PROMPT_PREFIX}</span>
        {frame.input === "" ? (
          <span style={{ fg: palette.muted }}>{PLACEHOLDER}</span>
        ) : (
          <span style={{ fg: palette.agent }}>{frame.input}</span>
        )}
      </text>
    </box>
  )
}

// The spinner is the one thing on this line that moves, so it is the one
// thing that carries the accent. The hint is last, because the surface
// chose those words and every renderer says the same ones.
const Working = ({ work, palette }: { work: WorkLine; palette: Palette }) => (
  <text>
    <span style={{ fg: palette.accent }}>{`${work.spinner} `}</span>
    <span style={{ fg: palette.agent }}>{work.caption}</span>
    <span style={{ fg: palette.muted }}>{work.since}</span>
    <span style={{ fg: palette.muted }}>{work.hint}</span>
  </text>
)

// What the Run is doing on the left, and what it has spent on the right.
export const StatusBar = ({ frame, palette }: { frame: Frame; palette: Palette }) => {
  const work = workLine(frame)
  return (
    <box
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        height: 1,
        flexShrink: 0,
      }}
    >
      {work === undefined ? (
        <text content={statusLeft(frame)} style={{ fg: palette.muted }} />
      ) : (
        <Working work={work} palette={palette} />
      )}
      <text content={statusRight(frame)} style={{ fg: palette.muted }} />
    </box>
  )
}

/**
 * The screen, painted in the colors the Frame carries. The palette is
 * derived on every draw rather than fixed when the renderer started, which
 * is the whole of live preview: a theme picker moves the selection, the
 * surface says which colors, and the next frame is drawn in them. A Frame
 * with no theme keeps what this renderer was built with.
 */
export const App = ({ frame, palette }: { frame: Frame; palette: Palette }) => {
  const painted = frame.theme === undefined ? palette : paletteFrom(frame.theme)
  return (
    <box
      style={{
        flexDirection: "column",
        width: "100%",
        height: "100%",
        paddingLeft: PAD,
        paddingRight: PAD,
      }}
    >
      <SessionPane frame={frame} palette={painted} />
      <OverlayPanel frame={frame} palette={painted} />
      <InputBar frame={frame} palette={painted} />
      <StatusBar frame={frame} palette={painted} />
    </box>
  )
}
