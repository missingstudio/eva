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
import { Session, type Folded, type Pipe, type Reading } from "./session.js"

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
  steer: () => undefined,
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
   * arrived.
   */
  it("renders whole before the fold has arrived", () => {
    const drawn = renderToStaticMarkup(
      <Session session={SESSION} header={HEADER} reading={folding} pipe={READY} />,
    )

    expect(drawn).toContain(SESSION)
    expect(drawn).toContain("2026-08-26T00:00:00.000Z")
    expect(drawn).toContain("Reading the transcript")
  })

  /**
   * And the spend is not drawn at all until the fold has arrived. A Session
   * nobody has read yet is not a Session that spent nothing, and the top bar
   * would say it was.
   */
  it("says nothing about a spend before the fold has arrived", () => {
    const drawn = renderToStaticMarkup(
      <Session session={SESSION} header={HEADER} reading={folding} pipe={READY} />,
    )

    expect(drawn).not.toContain("$0.00")
    expect(drawn).not.toContain("nothing spent yet")
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
   * intent is a whole prompt. `headerFold` is right to hold all of it and the
   * bar over the record is the wrong place to draw all of it, so the bar is
   * one line and the record's own text is on the element behind it.
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

    expect(drawn).toContain("rebuild the Session page…")
    expect(drawn).not.toContain(">rebuild the Session page\n")
    expect(drawn).toContain('title="rebuild the Session page')
  })

  /**
   * The pipe is said in one word beside the id, and nothing while it is
   * plainly up. The sentence above the record is the whole of it; this is for
   * a reader who is looking at the field rather than at the record.
   */
  it("says in one word that the pipe is not up, and nothing while it is", () => {
    const worded = (pipe: Pipe) =>
      renderToStaticMarkup(
        <Session session={SESSION} header={HEADER} reading={folding} pipe={pipe} />,
      )

    expect(worded(READY)).not.toContain("<span>down</span>")
    expect(worded({ at: "disconnected", dropped: true })).toContain("<span>down</span>")
    expect(worded({ at: "synchronizing", dropped: true })).toContain("<span>catching up…</span>")
  })
})

/**
 * Which mode the Session runs under, read off the record and nowhere else. A
 * mode is a fact with a position, so the last one named is the one in force.
 */
describe("the mode the record names", () => {
  const under = (...modes: readonly string[]): Reading => ({
    folded: {
      kind: "folded",
      at: { session: SESSION, seq: 1 },
      cost: EMPTY_COST,
      turns: [
        {
          key: "0",
          author: "agent",
          blocks: modes.map((mode, at) => ({ kind: "mode", key: `0.${at}`, mode })),
        },
      ],
    },
    said: "",
    running: false,
  })

  const pilled = (reading: Reading) =>
    renderToStaticMarkup(
      <Session session={SESSION} header={HEADER} reading={reading} pipe={READY} />,
    )

  // The pill is the lock and the word after it. The record above it draws
  // every mode Block it holds, so the pill is what is asserted on.
  it("takes the last mode the record named", () => {
    const drawn = pilled(under("supervised", "read-only"))

    expect(drawn).toContain("</svg>read-only</span>")
    expect(drawn).not.toContain("</svg>supervised</span>")
  })

  // A record that has never named one leaves it unsaid. A default here would
  // be the page inventing the one fact a reader most needs to trust.
  it("names no mode when the record holds none", () => {
    expect(pilled(under())).not.toContain("lucide-lock")
    expect(pilled(folding)).not.toContain("lucide-lock")
  })
})

/**
 * What a Session cost, when nobody reported what it cost. The rate is the
 * Catalog's and it arrives on the same rows the picker draws, so the bar over
 * the record and the breakdown under it price from one place.
 *
 * `pricing.test.ts` holds the rule; what is held here is that the page applies
 * it, in both places, and marks what it worked out as an estimate.
 */
describe("the spend, priced from the Catalog", () => {
  const COUNTED: CostSummary = { ...EMPTY_COST, inputTokens: 1_000_000, outputTokens: 1_000_000 }

  const CHOOSING = {
    chosen: "anthropic/claude-opus-5",
    choose: () => undefined,
    rows: [
      {
        id: "anthropic/claude-opus-5",
        label: "anthropic/claude-opus-5",
        price: { inputTicks: 50_000_000_000, outputTicks: 250_000_000_000 },
      },
    ],
  }

  const spent = (choosing?: typeof CHOOSING) =>
    renderToStaticMarkup(
      <Session
        header={HEADER}
        pipe={READY}
        reading={{
          folded: { kind: "folded", at: { session: SESSION, seq: 1 }, cost: COUNTED, turns: [] },
          running: false,
          said: "",
        }}
        session={SESSION}
        {...(choosing === undefined ? {} : { choosing })}
      />,
    )

  it("prices the counters at the Catalog's rate, over the record and under it", () => {
    const drawn = spent(CHOOSING)

    expect(drawn.match(/~\$30\.00 est/g)).toHaveLength(2)
  })

  // And says nothing it cannot price. A page with no rows has no rate, which
  // is not the same as a Session that cost nothing.
  it("says the cost is unreported while it holds no rate for the model", () => {
    expect(spent()).toContain("cost unreported")
    // `est` alone is in half the words on the page; the tilde is what marks a
    // figure Eva worked out.
    expect(spent()).not.toContain("~$")
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
    const drawn = renderToStaticMarkup(
      <Session session={SESSION} header={HEADER} reading={reading("")} pipe={READY} />,
    )

    expect(drawn).not.toContain("prose live")
  })

  it("draws what the open Run has streamed, and nothing around it", () => {
    const drawn = renderToStaticMarkup(
      <Session session={SESSION} header={HEADER} reading={reading("a partial")} pipe={READY} />,
    )

    expect(drawn).toContain("a partial")
    expect(drawn).toContain("prose live")
  })

  /**
   * And draws it as the prose it is being written as, not as its source. A Run
   * writes markdown while it writes, so a tail drawn as plain characters shows
   * a reader the source of the answer and then rewrites it as prose the moment
   * the Run closes. It is the same renderer the committed fold goes through,
   * reading a half-written document rather than waiting for a closed one.
   */
  it("draws a half-written answer as prose, in the drawing the fold will replace it with", () => {
    const drawn = renderToStaticMarkup(
      <Session
        session={SESSION}
        header={HEADER}
        reading={reading("## still writing\n\n- one\n- tw")}
        pipe={READY}
      />,
    )

    expect(drawn).toContain("<h2")
    expect(drawn).toContain("<li")
    expect(drawn).toContain("still writing")
    expect(drawn).not.toContain("## still writing")
  })
})

/**
 * A page frozen on a dead pipe reads as a Session that stopped, so the page
 * says which of the two it is. What it reads for that is the Client's `state`
 * and nothing else about the pipe.
 */
describe("what the page says about the pipe", () => {
  const said = (pipe: Pipe) =>
    renderToStaticMarkup(
      <Session session={SESSION} header={HEADER} reading={reading()} pipe={pipe} />,
    )

  it("says the pipe is down while it is down", () => {
    expect(said({ at: "disconnected", dropped: true })).toContain("The pipe is down")
  })

  // And says the Session is not the thing that stopped. The record goes on
  // without this page and the page catches up by Cursor.
  it("says the Session goes on while the pipe does not", () => {
    expect(said({ at: "disconnected", dropped: true })).toContain("The Session goes on")
  })

  it("says the pipe is back once it is", () => {
    expect(said({ at: "ready", dropped: true })).toContain("The pipe is back.")
  })

  /**
   * And says nothing to a reader who was never told it had gone. "The pipe is
   * back" is a fact about a page that lost it, not about a page that has been
   * reading all along.
   */
  it("says nothing about a pipe that has never gone", () => {
    expect(said(READY)).not.toContain("The pipe is back.")
    expect(said(READY)).not.toContain('class="notice"')
  })

  /**
   * `synchronizing` arrives whenever the pipe comes back with a Run to catch
   * up on. The arm is drawn with the other two, because the three are a
   * closed set and one left off is a page that says nothing during the one
   * recovery a reader is watching.
   */
  it("says it is catching up while the runtime refolds", () => {
    expect(said({ at: "synchronizing", dropped: true })).toContain("Catching up")
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
  const costing = (cost: CostSummary, ran = true): Reading => ({
    folded: { kind: "folded", at: { session: SESSION, seq: ran ? 1 : 0 }, cost, turns: [] },
    said: "",
    running: false,
  })

  const spentOn = (cost: CostSummary, ran = true) =>
    renderToStaticMarkup(
      <Session session={SESSION} header={HEADER} reading={costing(cost, ran)} pipe={READY} />,
    )

  /**
   * The figure is the Transcript's own cost fold. Nothing on the page prices
   * anything: the fold happens on this side of the wire and this side holds
   * no Catalog, so what a reader is shown is what a Provider reported.
   */
  it("shows what a Provider reported", () => {
    const drawn = spentOn({ ...EMPTY_COST, costTicks: 13_000_000, inputTokens: 40 })

    expect(drawn).toContain("$0.0013")
    expect(drawn).toContain("40")
  })

  // Silence is not zero, and a page that printed a number nobody reported
  // would be inventing one.
  it("says the cost is unreported rather than showing a figure nobody gave", () => {
    expect(spentOn(EMPTY_COST)).toContain("cost unreported")
  })

  // A Session that has not run has spent nothing, which is not a spend
  // nobody reported.
  it("says nothing has been spent when the Session has not run", () => {
    expect(spentOn(EMPTY_COST, false)).toContain("nothing spent yet")
  })

  /**
   * An estimate cannot arrive on this page with no rate in hand, and the arm
   * is drawn all the same: a figure Eva worked out is never shown as one a
   * Provider gave, and a page missing the arm would show one as the other the
   * day a Catalog reaches this side.
   */
  it("marks an estimate as an estimate, if one ever reaches this side", () => {
    expect(spentOn({ ...EMPTY_COST, estimatedCostTicks: 20_000_000_000 })).toContain("~$2.00 est")
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
 * through the one Client and are written `one.api.X`, and the Client's own
 * two are reaches as well: the followed Session is written `one.follow` and
 * the pipe's state `one.state`. Two more go beside the Client, because
 * neither is a Session API method: a command line comes off the transport
 * and is written `command()`, and the Catalog's rows are read beside it and
 * written `models()`. Every spelling is grepped, because a reach this count
 * cannot see is the defect the count exists for.
 *
 * `eva.ts` is where every door is opened, so its exports are counted too. A
 * fourth door would be a reach all three spellings miss, and it lands on that
 * line before it lands anywhere else.
 *
 * Each surface is drawn in the state a reader sees it in. `renderToStaticMarkup`
 * runs no effect, so a component that reads for itself draws only the words it
 * says before the wire has answered. The listing is on the rail now, and
 * `shell.test.tsx` draws it there with the rows in hand.
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
  const REACH = /one\.(?:api\.[a-z.]+|follow\b|state\b)|\bcommand\(\)|\bmodels\(\)/g

  const calls = (): readonly string[] => {
    const found = new Set<string>()
    for (const path of shipped()) {
      for (const said of readFileSync(path, "utf8").match(REACH) ?? []) {
        // A door is named by the call without its parentheses; a Session API
        // call by the method under `one.api.`, and the Client's own two by
        // their names.
        found.add(
          said.startsWith("one.api.")
            ? said.slice("one.api.".length)
            : said.startsWith("one.")
              ? said.slice("one.".length)
              : said.slice(0, -2),
        )
      }
    }
    return [...found].sort()
  }

  const doors = (): readonly string[] =>
    (readFileSync(join(SRC, "eva.ts"), "utf8").match(/export const [a-z]+/g) ?? [])
      .map((said) => said.slice("export const ".length))
      .sort()

  /**
   * The Session page, composed the way `routes.tsx` composes it: every prop
   * that route hands over and no prop it does not. A page drawn without one
   * of them is a page this build never renders, and a guard on it guards
   * nothing.
   */
  const page = (composer: Composing) =>
    renderToStaticMarkup(
      <Session
        answer={() => undefined}
        asking={[]}
        composer={composer}
        header={HEADER}
        pipe={READY}
        reading={reading()}
        session={SESSION}
      />,
    )

  /**
   * `create` opens a Session, `submit` says something in one, `cancel` stops
   * what is open and `answer` answers a question that stands. `list` is the
   * listing, which is the read this page opened with, and `retire` is the
   * rail's second write: the Session a person deleted. `model.get` and
   * `model.set` are the picker: what this Session is kept at, and the row a
   * reader chose. `follow` is how the page reads a Session at all, and
   * `state` is the pipe's word — the Client's own two. `command` and `models`
   * are the odd two — neither is a Session API method at all. One runs a line
   * where the Domains live, and the other reads what the Catalog knows.
   * Nothing else.
   */
  it("makes these calls on Eva and no others", () => {
    expect(calls()).toEqual([
      "answer",
      "cancel",
      "command",
      "create",
      "follow",
      "list",
      "model.get",
      "model.set",
      "models",
      "retire",
      "state",
      "submit",
    ])
  })

  // Three doors, and `eva.ts` holds all of them. A fourth would be a call the
  // count above is blind to, which is the one failure this suite must not
  // allow.
  it("reaches Eva through these doors and no others", () => {
    expect(doors()).toEqual(["client", "command", "models"])
  })

  /**
   * The composer is the field, and it is the only one. A page with two ways
   * to type a line is a page with two answers to what Enter means — which is
   * why a line naming a command runs through this field and not a second one.
   *
   * What is counted is fields, and the model picker is not one: a model is
   * picked and never typed, which is the refusal ticket 005 asks for. The
   * picker's listbox keeps a hidden input beside its trigger — that is how a
   * form reads a listbox's value — and it is out of the tab order and out of
   * the accessibility tree, so nobody can reach it and nothing announces it.
   * `models.test.tsx` › "offers no field to type a model into" holds it to
   * that, in a document, with the rows loaded. Here the rows have not
   * answered, so the picker is still saying so.
   */
  it("offers one field, and it is the composer", () => {
    const drawn = page(COMPOSING)

    expect(drawn.match(/<textarea/g)).toHaveLength(1)
    expect(drawn).not.toContain("<input")
    expect(drawn).toContain("Send")
    expect(drawn).toContain("Reading the models…")
  })

  /**
   * The card is a form, because that is what makes Enter, the send button and
   * a screen reader's own submit gesture one gesture rather than three
   * bindings. It is a form that can reach nothing: it names no action and no
   * method, and `PromptInput` prevents the default before it hands the line
   * to `useComposer`. A form that submitted would leave the page and lose the
   * Session the reader is watching, so the proof is that there is nowhere for
   * it to go.
   */
  it("sends through the Client and never through the browser", () => {
    const form = /<form[^>]*>/.exec(page(COMPOSING))?.[0]

    expect(form).toBeDefined()
    expect(form).not.toContain("action=")
    expect(form).not.toContain("method=")
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

  // The record is on the page this was read from, so a Session that drew
  // nothing could not pass the clauses above by drawing nothing.
  it("draws the record it was handed", () => {
    const drawn = page(COMPOSING)

    expect(drawn).toContain(SESSION)
    expect(drawn).toContain("read the trace back over HTTP")
  })
})
