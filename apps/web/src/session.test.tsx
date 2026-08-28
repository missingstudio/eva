import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { foldTranscript, PERMISSION_OPTIONS, type SessionHeader } from "@missingstudio/eva-core"
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
import type { Composing } from "./composer.js"
import { Listing, Page } from "./page.js"
import {
  Cost,
  Live,
  Named,
  Notice,
  noticeOf,
  Session,
  type Folded,
  type Pipe,
  type Reading,
} from "./session.js"

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

const folding: Reading = { folded: { kind: "folding" }, said: "", running: false }

const reading = (said = "", running = false): Reading => ({ folded: read(), said, running })

// A pipe that has never gone, which is the one state with nothing to say.
const READY: Pipe = { at: "ready", dropped: false }

// A composer with somewhere to send a line, and nothing waiting.
const COMPOSING: Composing = {
  pending: [],
  open: false,
  send: () => undefined,
  stop: () => undefined,
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
    const drawn = renderToStaticMarkup(
      <Session session={SESSION} header={HEADER} reading={folding} pipe={READY} />,
    )

    expect(drawn).toContain(named)
    expect(drawn).toContain("Reading the transcript")
  })

  // A long Session says which Session it is at once. The title is a Run's to
  // say and arrives with the listing, so the id is what stands in for it.
  it("names the Session by its id before the listing has answered", () => {
    const drawn = renderToStaticMarkup(
      <Session session={SESSION} header={undefined} reading={folding} pipe={READY} />,
    )

    expect(drawn).toContain(SESSION)
    expect(drawn).toContain("no title yet")
  })

  it("names the title and when it last moved, once the listing has answered", () => {
    const drawn = renderToStaticMarkup(
      <Session session={SESSION} header={HEADER} reading={folding} pipe={READY} />,
    )

    expect(drawn).toContain("read the trace back over HTTP")
    expect(drawn).toContain("2026-08-26T00:00:00.000Z")
  })

  /**
   * The title is a Run's intent until an `info` gives a better one, and an
   * intent is a whole prompt. `headerFold` is right to hold all of it and a
   * heading is the wrong place to draw all of it, so the heading is one line
   * and the record's own text is on the element behind it.
   */
  it("draws a whole prompt as one line, and keeps the whole of it on the page", () => {
    const prompt = "rebuild the Session page\n\non Tailwind 4, with AI Elements"
    const drawn = renderToStaticMarkup(
      <Session
        session={SESSION}
        header={{ ...HEADER, title: prompt }}
        reading={folding}
        pipe={READY}
      />,
    )

    expect(drawn).toContain("<h1")
    expect(drawn).toContain("rebuild the Session page…")
    expect(drawn).not.toContain(">rebuild the Session page\n")
    expect(drawn).toContain('title="rebuild the Session page')
  })
})

describe("what was said in it", () => {
  it("draws the Blocks the fold gave back", () => {
    const drawn = renderToStaticMarkup(
      <Session session={SESSION} header={HEADER} reading={reading()} pipe={READY} />,
    )

    expect(drawn).toContain("change it")
    expect(drawn).toContain("one.ts")
    expect(drawn).toContain("2 hunks")
  })
})

/**
 * The stream and the record are two sources and the page never confuses them,
 * which is the rule `Frame` keeps for the terminal. So the tail stands after
 * the fold, on its own, and it is gone the moment the fold has it.
 */
describe("the live tail", () => {
  it("renders after the committed fold", () => {
    const drawn = renderToStaticMarkup(
      <Session session={SESSION} header={HEADER} reading={reading("half a wo")} pipe={READY} />,
    )

    expect(drawn).toContain("half a wo")
    expect(drawn.indexOf("half a wo")).toBeGreaterThan(drawn.indexOf("change it"))
  })

  // And before the cost, because the cost is the record's and the tail is not
  // in the record yet.
  it("stands between what was folded and what it cost", () => {
    const drawn = renderToStaticMarkup(
      <Session session={SESSION} header={HEADER} reading={reading("half a wo")} pipe={READY} />,
    )

    expect(drawn.indexOf("half a wo")).toBeLessThan(drawn.indexOf("tokens in"))
  })

  /**
   * A Run that has said nothing and a Run that is not open are the same thing
   * to a reader, and both are nothing. An empty tail that drew a box would
   * read as a Run waiting on something.
   */
  it("draws nothing at all when the open Run has said nothing", () => {
    expect(renderToStaticMarkup(<Live said="" />)).toBe("")
  })

  it("draws what the open Run has streamed, and nothing around it", () => {
    expect(renderToStaticMarkup(<Live said="a partial" />)).toContain("a partial")
  })
})

/**
 * A page frozen on a dead pipe reads as a Session that stopped, so the page
 * says which of the two it is. What it reads for that is the Client's `state`
 * and nothing else about the pipe.
 */
describe("what the page says about the pipe", () => {
  it("says the pipe is down while it is down", () => {
    expect(noticeOf({ at: "disconnected", dropped: true })).toContain("The pipe is down")
  })

  // And says the Session is not the thing that stopped. The record goes on
  // without this page and the page catches up by Cursor.
  it("says the Session goes on while the pipe does not", () => {
    expect(noticeOf({ at: "disconnected", dropped: true })).toContain("The Session goes on")
  })

  it("says the pipe is back once it is", () => {
    expect(noticeOf({ at: "ready", dropped: true })).toBe("The pipe is back.")
  })

  /**
   * And says nothing to a reader who was never told it had gone. "The pipe is
   * back" is a fact about a page that lost it, not about a page that has been
   * reading all along.
   */
  it("says nothing about a pipe that has never gone", () => {
    expect(noticeOf(READY)).toBeUndefined()
    expect(renderToStaticMarkup(<Notice pipe={READY} />)).toBe("")
  })

  /**
   * `synchronizing` cannot arrive on this page: it is a Run refolding and this
   * page drives no Run. The arm is drawn all the same, because the three are a
   * closed set and one left off is a page that says nothing on the day the
   * write half lands.
   */
  it("says it is catching up, if a Run ever reaches this side", () => {
    expect(noticeOf({ at: "synchronizing", dropped: true })).toContain("Catching up")
  })

  // Above the transcript, because a reader looking at the words is who has to
  // know the words have stopped arriving.
  it("stands above what was said in the Session", () => {
    const drawn = renderToStaticMarkup(
      <Session
        session={SESSION}
        header={HEADER}
        reading={reading()}
        pipe={{ at: "disconnected", dropped: true }}
      />,
    )

    expect(drawn.indexOf("The pipe is down")).toBeLessThan(drawn.indexOf("change it"))
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
 * The page prompts now, so the count this suite kept is inverted rather than
 * dropped. It used to be a count of the ways to put something into Eva from
 * here — zero, checked rather than remembered. It is now a count of the ways
 * this page names, and the same rule holds: a way in that nobody wrote down
 * is a way in nobody reviewed.
 *
 * What is counted is the rule and not a proxy for it. A field is no longer
 * the rule — there is one, and the composer is what it is for — so what is
 * counted is every reach for Eva, read off what ships. Most of them go
 * through the one Client and are written `one.api.X`. The command line does
 * not: the contract has no command method, so it comes off the transport
 * beside the Client and is written `command()`. Both spellings are grepped,
 * because a reach this count cannot see is the defect the count exists for.
 *
 * `eva.ts` is where every door is opened, so its exports are counted too. A
 * third door would be a reach `one.api.` and `command()` both miss, and it
 * lands on that line before it lands anywhere else.
 *
 * Each surface is drawn in the state a reader sees it in. `renderToStaticMarkup`
 * runs no effect, so `Page` draws only the words it says before the listing has
 * answered — the drawn listing is `Listing`, and it is handed the rows.
 */
describe("what the page offers", () => {
  const SRC = new URL(".", import.meta.url).pathname

  const shipped = (): readonly string[] =>
    readdirSync(SRC, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
      .filter((entry) => !/\.test\.tsx?$/.test(entry.name))
      .map((entry) => join(SRC, entry.name))
      .sort()

  // The grep, written once so a reviewer can run the same one by hand.
  const REACH = /one\.api\.[a-z.]+|\bcommand\(\)/g

  const calls = (): readonly string[] => {
    const found = new Set<string>()
    for (const path of shipped()) {
      for (const said of readFileSync(path, "utf8").match(REACH) ?? []) {
        found.add(said.startsWith("one.api.") ? said.slice("one.api.".length) : "command")
      }
    }
    return [...found].sort()
  }

  const doors = (): readonly string[] =>
    (readFileSync(join(SRC, "eva.ts"), "utf8").match(/export const [a-z]+/g) ?? [])
      .map((said) => said.slice("export const ".length))
      .sort()

  const page = (composer?: Composing) =>
    renderToStaticMarkup(
      <Session
        header={HEADER}
        pipe={READY}
        reading={reading()}
        session={SESSION}
        {...(composer === undefined ? {} : { composer })}
      />,
    )

  /**
   * `create` opens a Session, `submit` says something in one, `cancel` stops
   * what is open and `answer` answers a question that stands. `list` is the
   * listing, which is the read this page opened with. `command` is the odd
   * one: it is no Session API method at all, and it runs a line where the
   * Domains live. Nothing else: a model switch is still to come, and it
   * belongs on this line the day it lands.
   */
  it("makes these calls on Eva and no others", () => {
    expect(calls()).toEqual(["answer", "cancel", "command", "create", "list", "submit"])
  })

  // Two doors, and `eva.ts` holds both. A third would be a call the count
  // above is blind to, which is the one failure this suite must not allow.
  it("reaches Eva through these doors and no others", () => {
    expect(doors()).toEqual(["client", "command"])
  })

  // The composer is the field, and it is the only one. A page with two ways
  // to type a line is a page with two answers to what Enter means.
  it("offers one field, and it is the composer", () => {
    const drawn = page(COMPOSING)

    expect(drawn.match(/<textarea/g)).toHaveLength(1)
    expect(drawn).not.toContain("<input")
    expect(drawn).not.toContain("<select")
    expect(drawn).toContain("Send")
  })

  /**
   * And no `<form>`. Enter is read on the field, so the page never hands a
   * line to the browser to send: a form that submitted would leave the page
   * and lose the Session the reader is watching.
   */
  it("sends through the Client and never through the browser", () => {
    expect(page(COMPOSING)).not.toContain("<form")
  })

  // The listing offers the one write it has: another Session.
  it("offers a new Session on the listing", () => {
    expect(renderToStaticMarkup(<Page />)).toContain("New Session")
    expect(renderToStaticMarkup(<Listing sessions={[HEADER]} />)).not.toContain("New Session")
  })

  // A line typed during a Run waits, and the wait is on the page. A queue
  // nobody can see is a line a person types a second time.
  it("says how many lines wait behind the Run that is open", () => {
    expect(page({ ...COMPOSING, open: true, pending: ["and rename it"] })).toContain("1 waiting")
  })

  /**
   * A send that reached nothing and said nothing would read as a Run that
   * started. So the send is off and the reason is drawn, on the same page as
   * the notice about the pipe.
   */
  it("refuses a send while the pipe is down, and says why", () => {
    const drawn = renderToStaticMarkup(
      <Session
        composer={COMPOSING}
        header={HEADER}
        pipe={{ at: "disconnected", dropped: true }}
        reading={reading()}
        session={SESSION}
      />,
    )

    expect(drawn).toContain("The line waits here")
    expect(drawn).toContain('data-disabled=""')
  })

  // Nothing is offered while nothing is standing. A page that always drew
  // four options would be asking a reader to answer a question nobody asked.
  it("offers no answer while no question stands", () => {
    for (const option of PERMISSION_OPTIONS) expect(page(COMPOSING)).not.toContain(option.name)
  })

  /**
   * The four options where a question stands, and the composer under them. A
   * reader picks one of four words the gate already knows, and a line typed
   * at the field answers the same question rather than opening a Run.
   */
  it("offers the four options where a question stands", () => {
    const drawn = renderToStaticMarkup(
      <Session
        answer={() => undefined}
        asking={[{ request: "call_1", question: "edit may change something. Run it?" }]}
        composer={COMPOSING}
        header={HEADER}
        pipe={READY}
        reading={reading()}
        session={SESSION}
      />,
    )

    expect(drawn).toContain("edit may change something. Run it?")
    for (const option of PERMISSION_OPTIONS) expect(drawn).toContain(option.name)
  })

  // The rows are on the page this was read from, so a listing that drew
  // nothing could not pass the clauses above by drawing nothing.
  it("draws the Sessions it was handed", () => {
    const drawn = renderToStaticMarkup(<Listing sessions={[HEADER]} />)

    expect(drawn).toContain(SESSION)
    expect(drawn).toContain("read the trace back over HTTP")
  })
})
