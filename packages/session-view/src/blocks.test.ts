import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { foldTranscript } from "@missingstudio/eva-core"
import {
  eventID,
  runID,
  sessionID,
  type ContentBlock,
  type Event,
  type Payload,
  type TranscriptMessage,
} from "@missingstudio/eva-schema"
import { describe, expect, it } from "vitest"
import { askingOf, blockFold, blocksOf, type Asking, type Block } from "./blocks.js"

const agent = (blocks: TranscriptMessage["blocks"]): TranscriptMessage => ({
  author: "agent",
  blocks,
})

const content = (value: ContentBlock): TranscriptMessage["blocks"] => [
  { type: "content", block: 0, content: value },
]

const kinds = (turns: readonly { readonly blocks: readonly Block[] }[]): readonly string[] =>
  turns.flatMap((turn) => turn.blocks.map((block) => block.kind))

describe("the fold to Blocks", () => {
  it("carries the author on the turn, so a Block does not repeat it", () => {
    const turns = blockFold([
      { author: "human", blocks: content({ type: "text", text: "ask" }) },
      agent(content({ type: "text", text: "answer" })),
    ])
    expect(turns.map((turn) => [turn.author, turn.blocks[0]])).toEqual([
      ["human", { kind: "words", key: "0.0", text: "ask" }],
      ["agent", { kind: "words", key: "1.0", text: "answer" }],
    ])
  })

  it("names reasoning reasoning, whoever the author is", () => {
    const turns = blockFold([
      agent([{ type: "thought", block: 0, content: { type: "text", text: "hmm" } }]),
    ])
    expect(turns[0]?.blocks[0]).toEqual({ kind: "reasoning", key: "0.0", text: "hmm" })
  })

  // A call has a Tool Status while it is open and a Disposition once a result
  // has answered it. Both are the same call, so both are one Block.
  it("draws an open call as the call, with where it is in its life", () => {
    const turns = blockFold([
      agent([{ type: "tool", id: "t1", name: "read", tool: "read", status: "in_progress" }]),
    ])
    expect(turns[0]?.blocks[0]).toEqual({
      kind: "tool",
      key: "0.0",
      call: "t1",
      name: "read",
      tool: "read",
      status: "in_progress",
    })
  })

  it("draws an answered call as the result, with its Tool Status and its Disposition", () => {
    const turns = blockFold([
      agent([
        {
          type: "tool",
          id: "t1",
          name: "write",
          tool: "edit",
          status: "failed",
          disposition: "denied",
        },
      ]),
    ])
    expect(turns[0]?.blocks[0]).toEqual({
      kind: "result",
      key: "0.0",
      call: "t1",
      name: "write",
      tool: "edit",
      status: "failed",
      disposition: "denied",
    })
  })

  // The record holds a path and a count of hunks, so that is what a renderer
  // is given to draw.
  it("draws an edit as a diff, with the path and the count of hunks", () => {
    const turns = blockFold([agent([{ type: "edit", path: "docs/summary.md", hunks: 3 }])])
    expect(turns[0]?.blocks[0]).toEqual({
      kind: "diff",
      key: "0.0",
      path: "docs/summary.md",
      hunks: 3,
    })
  })

  /**
   * A mode is a fact on the record, so it reaches a renderer as a Block. Left
   * out of the fold it would be recorded and drawn nowhere, and a reader would
   * see writes refused with nothing saying what refused them.
   */
  it("draws a mode change as the mode and why it changed", () => {
    const turns = blockFold([
      agent([{ type: "mode", mode: "read-only", reason: "a person named it" }]),
    ])
    expect(turns[0]?.blocks[0]).toEqual({
      kind: "mode",
      key: "0.0",
      mode: "read-only",
      reason: "a person named it",
    })
  })

  // Absent means absent. A reason nothing recorded is not an empty one, and a
  // renderer that was handed one would say more than the record.
  it("carries no reason when the record holds none", () => {
    const turns = blockFold([agent([{ type: "mode", mode: "autonomous" }])])
    expect(turns[0]?.blocks[0]).toEqual({ kind: "mode", key: "0.0", mode: "autonomous" })
  })

  it("carries an image, so a renderer that can draw one has it", () => {
    const turns = blockFold([
      agent(content({ type: "image", data: "x", mimeType: "image/png", uri: "file://one.png" })),
    ])
    expect(turns[0]?.blocks[0]).toEqual({
      kind: "image",
      key: "0.0",
      mimeType: "image/png",
      data: "x",
      uri: "file://one.png",
    })
  })

  /**
   * A Surface may render less than another; it may never know more. So a
   * content kind no member covers folds to `unknown` and says what it was,
   * rather than falling out of the transcript.
   */
  it.each([
    { type: "audio", data: "x", mimeType: "audio/wav" },
    { type: "resource_link", uri: "file://one.ts", name: "one.ts" },
    { type: "resource", resource: { uri: "file://one.ts", text: "one" } },
  ] as const satisfies readonly ContentBlock[])("folds $type to unknown", (one) => {
    expect(blockFold([agent(content(one))])[0]?.blocks[0]).toEqual({
      kind: "unknown",
      key: "0.0",
      originalKind: one.type,
      raw: one,
    })
  })

  it("drops no block: one Block comes back for every block of the record", () => {
    const blocks: TranscriptMessage["blocks"] = [
      { type: "content", block: 0, content: { type: "text", text: "words" } },
      { type: "thought", block: 1, content: { type: "text", text: "reasoning" } },
      { type: "content", block: 2, content: { type: "audio", data: "x", mimeType: "audio/wav" } },
      { type: "tool", id: "t1", name: "read", tool: "read", status: "pending" },
      {
        type: "tool",
        id: "t2",
        name: "read",
        tool: "read",
        status: "completed",
        disposition: "ok",
      },
      { type: "edit", path: "one.ts", hunks: 1 },
      { type: "mode", mode: "plan" },
    ]
    expect(kinds(blockFold([agent(blocks)]))).toEqual([
      "words",
      "reasoning",
      "unknown",
      "tool",
      "result",
      "diff",
      "mode",
    ])
  })

  // A renderer keys its rows by this, so two Blocks must never share one.
  it("gives every Block its own key", () => {
    const turns = blockFold([
      agent([...content({ type: "text", text: "one" }), ...content({ type: "text", text: "two" })]),
      agent(content({ type: "text", text: "three" })),
    ])
    const keys = turns.flatMap((turn) => turn.blocks.map((block) => block.key))
    expect(new Set(keys).size).toBe(keys.length)
  })

  // A payload kind the schema does not define reaches this fold as its own
  // block. It is the same fact as a content type nothing names: the record
  // holds one, and no renderer here can draw it.
  it("folds a payload kind nothing names to unknown", () => {
    const blocks: TranscriptMessage["blocks"] = [
      { type: "unknown", originalKind: "acp/party_mode", raw: { confetti: true } },
    ]
    expect(blockFold([agent(blocks)])[0]?.blocks[0]).toEqual({
      kind: "unknown",
      key: "0.0",
      originalKind: "acp/party_mode",
      raw: { confetti: true },
    })
  })

  it("folds an empty record to nothing", () => {
    expect(blockFold([])).toEqual([])
  })
})

let counter = 0
const event = (payload: Payload): Event => {
  counter += 1
  return {
    id: eventID(`evt_${counter}`),
    seq: counter,
    at: { wall: "2026-08-15T09:00:00Z" },
    run: runID("run_a"),
    session: sessionID("sess_a"),
    parent: null,
    payload,
  }
}

describe("the fold from a Transcript", () => {
  // The page is handed a Transcript rather than a list of Messages, so the
  // call that opens one is made here rather than in every surface.
  it("folds what the record holds, through the same fold", () => {
    const events = [
      event({ kind: "started", intent: "change it" }),
      event({ kind: "edit", path: "one.ts", hunks: 2 }),
    ]
    const transcript = foldTranscript(sessionID("sess_a"), events)
    expect(blocksOf(transcript)).toEqual(blockFold(transcript.messages()))
    expect(kinds(blocksOf(transcript))).toEqual(["words", "diff"])
  })
})

/**
 * The one Block that is not on the record. A question nobody has answered has
 * no position on the Trace — an answered one is the Disposition of the call it
 * gated — so it folds separately, and both renderers still switch over one
 * union.
 */
describe("the questions that stand", () => {
  const ASK: Asking = { kind: "permission", request: "call_1", question: "run git push?" }

  it("folds one question to one Block, with the id an answer names", () => {
    expect(askingOf([ASK])).toEqual([
      {
        key: "asking",
        author: "agent",
        blocks: [
          { kind: "permission", key: "asking.0", request: "call_1", question: "run git push?" },
        ],
      },
    ])
  })

  // One Turn, whatever stands. A reader is being asked once, however many
  // calls are waiting on them.
  it("folds every question that stands into one Turn", () => {
    const turns = askingOf([
      ASK,
      { kind: "permission", request: "call_2", question: "and this one?" },
    ])
    expect(turns).toHaveLength(1)
    expect(kinds(turns)).toEqual(["permission", "permission"])
  })

  // A renderer keys its rows by this, and the record's own keys are numbers —
  // so a question can never take a key a Turn of the record made.
  it("keys the Blocks apart from the record's", () => {
    const record = blockFold([agent(content({ type: "text", text: "one" }))])
    const keys = [
      ...record.flatMap((turn) => turn.blocks.map((block) => block.key)),
      ...askingOf([ASK]).flatMap((turn) => turn.blocks.map((block) => block.key)),
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("folds nothing when nothing is standing", () => {
    expect(askingOf([])).toEqual([])
  })
})

const REPO = join(new URL(".", import.meta.url).pathname, "..", "..", "..")

// Deliberately crude: it greps. A rule a person cannot repeat is a rule
// nobody keeps, and this one is repeatable by hand.
const sources = (): readonly string[] =>
  readdirSync(join(REPO, "packages/session-view/src"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.endsWith(".test.ts"))
    .map((entry) => relative(REPO, join(entry.parentPath, entry.name)))
    .sort()

const naming = (word: string): readonly string[] =>
  sources().filter((path) => readFileSync(join(REPO, path), "utf8").includes(word))

describe("what the fold is allowed to know", () => {
  // A fold that named a renderer would be a fold with a favourite surface.
  it.each(["eva-tui", "opentui", "react", "eva-sdk"])("names no %s", (word) => {
    expect(naming(word)).toEqual([])
  })

  // It registers into nothing, which is what makes it a package and not a
  // plugin: nothing here is reachable only when a kernel booted.
  it("declares no plugin and takes no slot", () => {
    expect(naming("define(")).toEqual([])
    expect(naming("slot")).toEqual([])
  })
})
