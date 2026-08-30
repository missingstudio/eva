import { foldTranscript } from "@missingstudio/eva-core"
import {
  errorClasses,
  eventID,
  runID,
  sessionID,
  type ErrorClass,
  type Event,
  type Payload,
} from "@missingstudio/eva-schema"
import { blocksOf, errorWords, resultText, type Block } from "@missingstudio/eva-session-view"
import { toLines } from "@missingstudio/eva-tui-renderer"
import { EMPTY } from "@missingstudio/eva-tui-core"
import { Turns } from "@missingstudio/eva-web-app"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

/**
 * A failed Run says so at every door.
 *
 * The record has always held how a Run ended. The fold dropped it, so a Run
 * closed by a rejected key, a budget stop or a provider refusal drew a spinner
 * that stopped and no surface could reach the reason. This suite is the claim
 * that it is over: for each of the eight error classes, one Trace, one fold,
 * and a visible Block on the screen and on the page.
 *
 * The eight classes are read from the schema rather than listed here. A class
 * the schema adds arrives in this suite on its own, and a sentence nobody
 * wrote for it fails here rather than in front of a person.
 */

const SESSION = sessionID("sess_out")

let counter = 0
const event = (payload: Payload): Event => {
  counter += 1
  return {
    id: eventID(`evt_${counter}`),
    seq: counter,
    at: { wall: "2026-08-29T00:00:00.000Z" },
    run: runID("run_a"),
    session: SESSION,
    parent: null,
    payload,
  }
}

// What the harness said about the failure, in its own words. It is on the
// record beside the class, so both doors owe it too.
const SAID = "the provider closed the turn"

/**
 * One Run that opened, said a word, and stopped in the named class. It is the
 * shortest Trace that reaches the moment: a person asked, Eva began, and the
 * Run ended without answering.
 */
const stopped = (errorClass: ErrorClass): readonly Event[] => [
  event({ kind: "started", intent: "read the trace back" }),
  event({ kind: "text", block: 0, content: { type: "text", text: "reading" } }),
  event({
    kind: "finished",
    claim: { result: "failed", summary: SAID, errorClass },
  }),
]

// The one fold, from the record a surface is handed. Both doors read this
// same value, so nothing below folds a second time.
const outcomeIn = (events: readonly Event[]): { readonly block: Block; readonly page: string } => {
  const record = foldTranscript(SESSION, events)
  const turns = blocksOf(record)
  const blocks = turns.flatMap((turn) => turn.blocks)
  const found = blocks.filter((one) => one.kind === "outcome")
  expect(found).toHaveLength(1)
  return {
    block: found[0] as Block,
    page: renderToStaticMarkup(<Turns turns={turns} />),
  }
}

// The rows the terminal draws for one Block, joined the way a reader reads
// them: the head row and the rows under it are one thing being said.
const rowsFor = (events: readonly Event[], key: string): string =>
  toLines({ ...EMPTY, session: foldTranscript(SESSION, events).messages() })
    .filter((row) => row.key === key || row.key.startsWith(`${key}.`))
    .map((row) => row.text)
    .join("\n")

describe("a Run that stopped, at both doors", () => {
  it.each(errorClasses())("folds a %s Run to one outcome Block that carries the class", (which) => {
    const { block } = outcomeIn(stopped(which))

    expect(block).toEqual({
      kind: "outcome",
      key: block.key,
      result: "failed",
      summary: SAID,
      errorClass: which,
    })
  })

  it.each(errorClasses())("draws the %s Run at the terminal, class and next step", (which) => {
    const events = stopped(which)
    const { block } = outcomeIn(events)
    const drawn = rowsFor(events, block.key)
    const words = errorWords(which)

    expect(drawn).toContain(resultText("failed"))
    expect(drawn).toContain(which)
    expect(drawn).toContain(SAID)
    expect(drawn).toContain(words.means)
    expect(drawn).toContain(words.next)
  })

  it.each(errorClasses())("draws the %s Run on the page, class and next step", (which) => {
    const { page } = outcomeIn(stopped(which))
    const words = errorWords(which)

    expect(page).toContain(resultText("failed"))
    expect(page).toContain(which)
    expect(page).toContain(SAID)
    expect(page).toContain(words.means)
    expect(page).toContain(words.next)
  })

  /**
   * One table, read twice. The sentence a person reads at the terminal is the
   * sentence they read on the page, character for character — a fix written
   * twice is a fix in the wrong layer, and two doors that word one failure
   * differently are two products.
   */
  it.each(errorClasses())("says the same words about %s at both doors", (which) => {
    const events = stopped(which)
    const { block, page } = outcomeIn(events)
    const said = errorWords(which)

    for (const sentence of [said.means, said.next]) {
      expect(rowsFor(events, block.key)).toContain(sentence)
      expect(page).toContain(sentence)
    }
  })

  // Eight classes, eight sentences. A class that borrowed another's words
  // would tell a person to take a step that does not fit what happened.
  it("gives every class its own words, and a step to take", () => {
    const said = errorClasses().map((which) => errorWords(which))

    expect(new Set(said.map((words) => words.means)).size).toBe(errorClasses().length)
    expect(new Set(said.map((words) => words.next)).size).toBe(errorClasses().length)
    for (const words of said) {
      expect(words.means.endsWith(".")).toBe(true)
      expect(words.next.endsWith(".")).toBe(true)
    }
  })

  /**
   * Absent is not `other`. A failure nobody classified says it stopped and
   * says what the Run said, and it invents no class and no advice — a page
   * that guessed one would be naming a cause the record does not hold.
   */
  it("says a Run stopped when nothing classified it, and names no class", () => {
    const events = [
      event({ kind: "started", intent: "ask" }),
      event({ kind: "finished", claim: { result: "failed", summary: SAID } }),
    ]
    const { block, page } = outcomeIn(events)

    expect(block).toEqual({ kind: "outcome", key: block.key, result: "failed", summary: SAID })
    for (const drawn of [rowsFor(events, block.key), page]) {
      expect(drawn).toContain(resultText("failed"))
      expect(drawn).toContain(SAID)
      for (const which of errorClasses()) expect(drawn).not.toContain(errorWords(which).next)
    }
  })

  // A Run that answered ended too, and both doors say so. The ending is the
  // fourth question a person asks of a Run, and it has one answer.
  it("says a Run finished, at both doors", () => {
    const events = [
      event({ kind: "started", intent: "ask" }),
      event({ kind: "finished", claim: { result: "done" } }),
    ]
    const { block, page } = outcomeIn(events)

    expect(block).toEqual({ kind: "outcome", key: block.key, result: "done" })
    expect(rowsFor(events, block.key)).toContain(resultText("done"))
    expect(page).toContain(resultText("done"))
  })
})
