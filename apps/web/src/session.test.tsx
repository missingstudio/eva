import { foldTranscript, type SessionHeader } from "@missingstudio/eva-core"
import {
  eventID,
  runID,
  sessionID,
  type CostSummary,
  type Event,
  type Payload,
} from "@missingstudio/eva-schema"
import { blocksOf } from "@missingstudio/eva-session-view"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Page } from "./page.js"
import { Cost, Named, Session, type Folded } from "./session.js"

const SESSION = sessionID("ses_one")

const HEADER: SessionHeader = {
  id: SESSION,
  title: "read the trace back over HTTP",
  updatedAt: "2026-08-26T00:00:00.000Z",
}

let counter = 0
const event = (payload: Payload): Event => {
  counter += 1
  return {
    id: eventID(`evt_${counter}`),
    seq: counter,
    at: { wall: "2026-08-26T00:00:00.000Z" },
    run: runID("run_a"),
    session: SESSION,
    parent: null,
    payload,
  }
}

// The record, folded the way the page folds it: `attach` hands back a
// Transcript and the Blocks come out of the one fold.
const read = (): Folded => {
  const record = foldTranscript(SESSION, [
    event({ kind: "started", intent: "change it" }),
    event({ kind: "edit", path: "one.ts", hunks: 2 }),
  ])
  return { kind: "folded", at: record.at, turns: blocksOf(record), cost: record.cost() }
}

const EMPTY_COST: CostSummary = {
  inputTokens: null,
  outputTokens: null,
  cacheWriteTokens: null,
  cacheReadTokens: null,
  reasoningTokens: null,
  serverToolTokens: null,
  costTicks: null,
  estimatedCostTicks: null,
}

describe("which Session this is", () => {
  /**
   * Reading is progressive. The Header is drawn from the id the page was
   * asked for, so what a page can say at once is what it says at once — and
   * the proof is that the whole of it is on the page while the fold has not
   * arrived. `Named` takes no fold, so it cannot be waiting on one.
   */
  it("renders whole before the fold has arrived", () => {
    const named = renderToStaticMarkup(<Named session={SESSION} header={HEADER} />)
    const folding = renderToStaticMarkup(
      <Session session={SESSION} header={HEADER} folded={{ kind: "folding" }} />,
    )

    expect(folding).toContain(named)
    expect(folding).toContain("Reading the transcript")
  })

  // A long Session says which Session it is at once. The title is a Run's to
  // say and arrives with the listing, so the id is what stands in for it.
  it("names the Session by its id before the listing has answered", () => {
    const drawn = renderToStaticMarkup(
      <Session session={SESSION} header={undefined} folded={{ kind: "folding" }} />,
    )

    expect(drawn).toContain(SESSION)
    expect(drawn).toContain("no title yet")
  })

  it("names the title and when it last moved, once the listing has answered", () => {
    const drawn = renderToStaticMarkup(
      <Session session={SESSION} header={HEADER} folded={{ kind: "folding" }} />,
    )

    expect(drawn).toContain("read the trace back over HTTP")
    expect(drawn).toContain("2026-08-26T00:00:00.000Z")
  })
})

describe("what was said in it", () => {
  it("draws the Blocks the fold gave back", () => {
    const drawn = renderToStaticMarkup(
      <Session session={SESSION} header={HEADER} folded={read()} />,
    )

    expect(drawn).toContain("change it")
    expect(drawn).toContain("one.ts")
    expect(drawn).toContain("2 hunks")
  })
})

describe("the cost line", () => {
  /**
   * The figure is the Transcript's own cost fold. Nothing on the page prices
   * anything: the fold happens on this side of the wire and this side holds
   * no Catalog, so what a reader is shown is what a Provider reported.
   */
  it("shows what a Provider reported", () => {
    const drawn = renderToStaticMarkup(
      <Cost cost={{ ...EMPTY_COST, costTicks: 13_000_000, inputTokens: 40 }} ran={true} />,
    )

    expect(drawn).toContain("$0.0013")
    expect(drawn).toContain("40")
  })

  // Silence is not zero, and a page that printed a number nobody reported
  // would be inventing one.
  it("says the cost is unreported rather than showing a figure nobody gave", () => {
    expect(renderToStaticMarkup(<Cost cost={EMPTY_COST} ran={true} />)).toContain("cost unreported")
  })

  // A Session that has not run has spent nothing, which is not a spend
  // nobody reported.
  it("says nothing has been spent when the Session has not run", () => {
    expect(renderToStaticMarkup(<Cost cost={EMPTY_COST} ran={false} />)).toContain(
      "nothing spent yet",
    )
  })

  /**
   * An estimate cannot arrive on this page today, and the arm is drawn all the
   * same: a figure Eva worked out is never shown as one a Provider gave, and
   * a page missing the arm would show one as the other the day a Catalog
   * reaches this side.
   */
  it("marks an estimate as an estimate, if one ever reaches this side", () => {
    const drawn = renderToStaticMarkup(
      <Cost cost={{ ...EMPTY_COST, estimatedCostTicks: 20_000_000_000 }} ran={true} />,
    )

    expect(drawn).toContain("~$2.00 est")
  })
})

/**
 * The page takes no input of any kind — no prompt box, no permission answer,
 * no model switch. Those are W2's and they wait for the permission gate, so
 * the count of controls on the page is zero and it is a check that fails
 * rather than a habit.
 */
describe("what the page offers", () => {
  it.each(["<input", "<textarea", "<button", "<form", "<select"])(
    "no %s, on the Session or the listing",
    (control) => {
      expect(
        renderToStaticMarkup(<Session session={SESSION} header={HEADER} folded={read()} />),
      ).not.toContain(control)
      expect(renderToStaticMarkup(<Page />)).not.toContain(control)
    },
  )
})
