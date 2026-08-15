/** @jsxImportSource @opentui/react */
import { setMaxListeners } from "node:events"
import { PasteEvent } from "@opentui/core"
import { pasteBytes } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"
import { EMPTY, type Frame, type Overlay } from "@missingstudio/eva-tui-core"
import { App } from "./app.js"
import { PLACEHOLDER } from "./frame.js"
import { DEFAULT_PALETTE } from "./palette.js"
import { makeStore, Root } from "./renderer.js"

/**
 * What the rich renderer draws, checked. OpenTUI is native code over Bun's
 * FFI and the test runner is Node, so this cannot be a vitest file — it is a
 * script Bun runs, and CI runs it.
 *
 * It is a checked `.tsx` rather than a line of shell, because the thing it
 * exists to catch is a Frame that no longer satisfies the contract. A frame
 * spelled in `bun -e` is not type-checked, and one that was missing half its
 * fields passed for as long as the process exited before React drew it.
 */

type Message = Frame["session"][number]

const said = (author: Message["author"], text: string): Message => ({
  author,
  blocks: [{ type: "content", block: 0, content: { type: "text", text } }],
})

const OVERLAY: Overlay = {
  title: "commands",
  source: "query",
  query: "mo",
  rows: [
    { id: "model", label: "/model", detail: "Show or set the session model" },
    { id: "clear", label: "/clear", detail: "Open a new Session" },
  ],
  selected: 1,
  hint: "↑↓ move · enter run · esc close",
}

// One screen to draw, and what has to be on it. `absent` is what must not
// be, because a placeholder drawn over a typed line is the same defect as a
// line that never appeared.
interface Case {
  readonly name: string
  readonly frame: Frame
  readonly present: readonly string[]
  readonly absent?: readonly string[]
}

const CASES: readonly Case[] = [
  {
    name: "the banner",
    frame: {
      ...EMPTY,
      banner: { version: "9.9.9", model: "a-model", branch: "a-branch", directory: "~/eva" },
    },
    present: ["EVA", "9.9.9", "a-branch", "~/eva"],
  },
  {
    name: "a turn from each author",
    frame: { ...EMPTY, session: [said("human", "a question"), said("agent", "an answer")] },
    present: ["a question", "an answer"],
  },
  {
    name: "what the Run took",
    frame: { ...EMPTY, session: [said("agent", "an answer")], took: "took 1.2s" },
    present: ["an answer", "took 1.2s"],
  },
  {
    name: "the notes this surface said",
    frame: { ...EMPTY, session: [said("agent", "an answer")], notes: ["a notice"] },
    present: ["an answer", "a notice"],
  },
  {
    name: "the live area while a Run is open",
    frame: { ...EMPTY, live: "streaming" },
    present: ["streaming"],
  },
  {
    name: "the status line",
    frame: {
      ...EMPTY,
      status: { model: "a-model", tokens: "10 in / 4 out", cost: "$0.0012", mode: "ready" },
    },
    present: ["ready", "10 in / 4 out", "$0.0012", "a-model"],
  },
  {
    name: "the typed line",
    frame: { ...EMPTY, input: "half typed" },
    present: ["half typed"],
    absent: [PLACEHOLDER],
  },
  {
    name: "the placeholder when nothing is typed",
    frame: { ...EMPTY, input: "" },
    present: [PLACEHOLDER],
  },
  {
    name: "the panel, with the row under the selection marked",
    frame: { ...EMPTY, overlay: OVERLAY },
    present: ["/model", "/clear", "▸ /clear"],
    absent: ["▸ /model"],
  },
  {
    name: "the spinner while the Run is working",
    frame: { ...EMPTY, work: { running: true, elapsed: "1.0s", tick: 0, hint: "" } },
    present: ["Thinking…", "1.0s"],
  },
  {
    name: "what pressing esc would do, in the surface's own words",
    frame: {
      ...EMPTY,
      work: { running: true, elapsed: "1.0s", tick: 0, hint: "esc again to interrupt" },
    },
    present: ["esc again to interrupt"],
  },
]

// One renderer per screen, and every one of them listens. The warning is
// about a leak; these are deliberate and they go with the process.
setMaxListeners(CASES.length * 2)

const drawn = async (frame: Frame): Promise<string> => {
  const setup = await testRender(<App frame={frame} palette={DEFAULT_PALETTE} />, {
    width: 80,
    height: 30,
  })
  await setup.flush()
  return setup.captureCharFrame()
}

const failures: string[] = []

for (const one of CASES) {
  const screen = await drawn(one.frame)
  for (const want of one.present) {
    if (!screen.includes(want)) failures.push(`${one.name}: nothing drew ${JSON.stringify(want)}`)
  }
  for (const not of one.absent ?? []) {
    if (screen.includes(not)) failures.push(`${one.name}: ${JSON.stringify(not)} was drawn`)
  }
}

/**
 * A paste reaches the surface as one block. OpenTUI reports a pasted block
 * as its own event, and it used to reach neither the keymap nor the line
 * editor — a paste into the rich renderer did nothing at all.
 */
const pastedText = async (): Promise<readonly string[]> => {
  const store = makeStore()
  const seen: string[] = []
  const setup = await testRender(
    <Root
      store={store}
      palette={DEFAULT_PALETTE}
      onKey={() => {}}
      onPaste={(t) => void seen.push(t)}
    />,
    { width: 80, height: 30 },
  )
  await setup.flush()
  setup.renderer.keyInput.emit("paste", new PasteEvent(pasteBytes("one\ntwo")))
  await setup.flush()
  return seen
}

const pasted = await pastedText()
if (pasted.length !== 1 || pasted[0] !== "one\ntwo") {
  failures.push(`a paste reached the surface as ${JSON.stringify(pasted)}`)
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`not drawn — ${failure}`)
  process.exit(1)
}

console.log(`the rich renderer drew ${CASES.length} screens, and carried a paste`)
process.exit(0)
