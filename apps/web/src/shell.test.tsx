// @vitest-environment happy-dom
import type { SessionHeader } from "@missingstudio/eva-core"
import { sessionID } from "@missingstudio/eva-schema"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"
import { buildLine } from "./build.js"
import type { Listing } from "./sessions.js"
import { Sidebar, TopBar } from "./shell.js"
import { NO_TITLE } from "./title.js"

/**
 * The rail, which is where the listing lives now.
 *
 * It used to be the index route's whole page, and this suite carries that
 * suite's meaning: every Session Eva holds is named, an untitled one is named
 * by its id rather than left off, a whole prompt is one row, and an empty
 * listing says so rather than looking like one still reading. What changed is
 * where it is drawn — beside the record instead of instead of it — which is
 * the point of the frame: opening a Session costs the listing nothing.
 *
 * Rendered to a string, as every drawing on this page is, with one exception
 * at the end: the delete confirmation is a dialog, and a dialog draws none of
 * itself until it is open. The rule it exists for — that a press asks before
 * it writes — has no drawing to read, so that part is read in a document,
 * the way the model picker's rows are.
 */

const HELD: readonly SessionHeader[] = [
  {
    id: sessionID("ses_one"),
    title: "the first ask",
    updatedAt: "2026-08-25T09:00:00.000Z",
  },
  { id: sessionID("ses_two"), updatedAt: "2026-08-25T08:00:00.000Z" },
]

const NOW = new Date("2026-08-25T11:00:00.000Z")

const read = (sessions: readonly SessionHeader[] = HELD): Listing => ({ kind: "read", sessions })

const rail = (listing: Listing = read(), over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<Sidebar listing={listing} now={NOW} {...over} />)

// One control's own tag. The rail has two writes now, and a clause that read
// the whole markup for `disabled` would read one write's rule off the other.
const tagOf = (drawn: string, className: string): string =>
  new RegExp(`<button[^>]*class="${className}"[^>]*>`).exec(drawn)?.[0] ?? ""

describe("the listing, on the rail", () => {
  it("names every Session Eva holds, with its Header", () => {
    const drawn = rail()

    expect(drawn).toContain("the first ask")
    expect(drawn).toContain("ses_one")
    expect(drawn).toContain("2026-08-25T09:00:00.000Z")
  })

  // A title is what a Run said, so a Session that has heard nothing has none.
  // It is still on the rail: one a person cannot see is one they cannot open.
  it("names a Session that has no title yet, rather than leaving it out", () => {
    const drawn = rail()

    expect(drawn).toContain("ses_two")
    expect(drawn).toContain("no title yet")
  })

  // A Run's intent is a whole prompt, so a rail that drew every title as the
  // record holds it would be a rail nobody can scan.
  it("draws a whole prompt as one row, and keeps the whole of it on the row", () => {
    const drawn = rail(
      read([
        {
          id: sessionID("ses_long"),
          title: "make it read\nlike a transcript",
          updatedAt: "2026-08-25T09:00:00.000Z",
        },
      ]),
    )

    expect(drawn).toContain("make it read…")
    expect(drawn).toContain('title="make it read')
  })

  // An empty listing and a listing that has not arrived are two different
  // things, and a rail that drew them the same way would be lying about one.
  it("says Eva holds none, rather than looking like it is still reading", () => {
    const drawn = rail(read([]))

    expect(drawn).toContain("Eva holds no Session yet")
    expect(drawn).not.toContain("Reading")
  })

  it("says it is reading before the wire has answered", () => {
    expect(rail({ kind: "reading" })).toContain("Reading the Sessions…")
  })

  /**
   * Every row keeps its `href`, so the listing is reachable without a router
   * standing behind it — and so a modified click still opens a second tab.
   * Where a router is standing behind it, the click is handed there instead:
   * a load would unmount the rail, read the listing again, and say it was
   * reading where the Sessions had been.
   */
  it("opens each Session at its own path, with or without somewhere to send a click", () => {
    expect(rail()).toContain('href="/sessions/ses_one"')
    expect(rail(read(), { go: () => undefined })).toContain('href="/sessions/ses_one"')
  })

  it("says which build it is", () => {
    expect(rail()).toContain(buildLine())
  })

  // The one write the rail has: another Session. A control drawn with nowhere
  // to send a press says so rather than looking live.
  it("offers a new Session, and takes no press when it was drawn with nowhere to send one", () => {
    expect(rail()).toContain("New Session")
    expect(tagOf(rail(), "side-btn side-new")).toContain("disabled")
    expect(tagOf(rail(read(), { open: () => undefined }), "side-btn side-new")).not.toContain(
      "disabled",
    )
  })
})

/**
 * The rail's second write, and the only irreversible one.
 *
 * The control is on every row and it is named by the Session it acts on,
 * because a column of identical glyphs names nothing to a reader hearing the
 * page read aloud. A rail handed nowhere to send a press draws it disabled,
 * which is the rule New Session already keeps.
 */
describe("deleting a Session, from the rail", () => {
  const away = (over: Record<string, unknown> = {}) =>
    rail(read(), { retire: () => undefined, ...over })

  it("offers it on every row, named by the Session it would delete", () => {
    const drawn = away()

    expect(drawn).toContain('aria-label="Delete the first ask"')
    expect(drawn).toContain(`aria-label="Delete ${NO_TITLE}"`)
    expect(drawn.match(/class="side-del"/g)).toHaveLength(HELD.length)
  })

  it("takes no press when the rail was drawn with nowhere to send one", () => {
    expect(tagOf(rail(), "side-del")).toContain("disabled")
    expect(tagOf(away(), "side-del")).not.toContain("disabled")
  })

  /**
   * Deleting is a record a reader cannot get back to from this page, so the
   * press opens a question and never the write. The dialog draws nothing
   * until it is open — it is a portal, and this suite renders to a string —
   * so what is read here is that the row carries no way of its own to
   * delete: the control is a button, and the anchor beside it still goes to
   * the Session. Pressing through the dialog is proven in the document
   * below.
   */
  it("asks rather than writing, so a press on a row deletes nothing", () => {
    const drawn = away()

    expect(drawn).toContain('href="/sessions/ses_one"')
    expect(drawn).not.toContain("Delete Session")
    expect(drawn).not.toContain("Delete this Session?")
  })
})

/**
 * The confirmation, in a document.
 *
 * A dialog draws none of itself until it is open, so a rendered string holds
 * the row's control and nothing else — and the rule worth proving is the one
 * the string cannot show: a press asks, and only the answer writes.
 */
let mounted: Root | undefined

afterEach(() => {
  act(() => mounted?.unmount())
  mounted = undefined
  document.body.replaceChildren()
})

const railed = async (retire: (session: string) => void) => {
  const host = document.createElement("div")
  document.body.append(host)
  mounted = createRoot(host)

  await act(async () => {
    mounted?.render(<Sidebar listing={read()} now={NOW} retire={retire} />)
  })

  return document.querySelector<HTMLElement>('[aria-label="Delete the first ask"]')
}

// The dialog, with the question standing. Nothing has been written yet.
const asking = async (retire: (session: string) => void) => {
  const control = await railed(retire)
  await act(async () => control?.click())
  return document.querySelector<HTMLElement>('[data-slot="alert-dialog-content"]')
}

const pressing = async (dialog: HTMLElement | null, name: string) => {
  const found = [...dialog!.querySelectorAll("button")].find((one) =>
    (one.textContent ?? "").includes(name),
  )
  await act(async () => found?.click())
}

describe("the delete confirmation", () => {
  it("asks before it writes, and names the Session it would delete", async () => {
    const asked: string[] = []
    const dialog = await asking((session) => void asked.push(session))

    expect(dialog?.textContent).toContain("Delete this Session?")
    expect(dialog?.textContent).toContain("the first ask")
    // The press opened the question and wrote nothing.
    expect(asked).toEqual([])
  })

  /**
   * The destructive choice is named on the button that does it, so nobody
   * confirms a question they have stopped reading.
   */
  it("puts the Session away when the answer is the one that says so", async () => {
    const asked: string[] = []
    const dialog = await asking((session) => void asked.push(session))
    await pressing(dialog, "Delete Session")

    expect(asked).toEqual(["ses_one"])
  })

  it("writes nothing when the question is answered the other way", async () => {
    const asked: string[] = []
    const dialog = await asking((session) => void asked.push(session))
    await pressing(dialog, "Cancel")

    expect(asked).toEqual([])
    expect(document.querySelector('[data-slot="alert-dialog-content"]')).toBeNull()
  })
})

describe("the day groups on the rail", () => {
  it("labels each group by the day the Headers fall in", () => {
    const drawn = rail(
      read([
        { id: sessionID("ses_now"), updatedAt: "2026-08-25T09:00:00.000Z" },
        { id: sessionID("ses_then"), updatedAt: "2026-08-24T09:00:00.000Z" },
      ]),
    )

    expect(drawn).toContain("Today")
    expect(drawn).toContain("Yesterday")
    expect(drawn.indexOf("Today")).toBeLessThan(drawn.indexOf("Yesterday"))
  })

  it("gathers a Session with no stamp at the end, under a label that says so", () => {
    expect(rail(read([...HELD, { id: sessionID("ses_undated") }]))).toContain("Undated")
  })
})

/**
 * The dot says a Run is open. It is drawn on the Session this page is watching
 * and on no other, because that is the only Run state the page honestly knows
 * — every other row would be a guess.
 */
describe("the running dot", () => {
  it("marks the Session this page is watching", () => {
    const drawn = rail(read(), { watching: "ses_one", running: true })

    expect(drawn).toContain("dot-run")
    expect(drawn).toContain("running")
  })

  it("marks no row while the watched Run is not open", () => {
    expect(rail(read(), { watching: "ses_one", running: false })).not.toContain("dot-run")
  })

  // Including the row a reader is on. A page that is not watching a Session
  // cannot say whether its Run is open.
  it("marks no row on a page that is watching no Session", () => {
    expect(rail(read(), { running: true })).not.toContain("dot-run")
  })

  it("marks the row a reader is on as the current page", () => {
    const drawn = rail(read(), { watching: "ses_one" })

    expect(drawn).toContain('aria-current="page"')
    expect(drawn.match(/aria-current="page"/g)).toHaveLength(1)
  })
})

describe("the top bar", () => {
  it("names the Session, and offers the rail where the rail has no column", () => {
    const drawn = renderToStaticMarkup(<TopBar title="the first ask" />)

    expect(drawn).toContain("the first ask")
    expect(drawn).toContain('aria-label="every Session"')
    expect(drawn).toContain('aria-expanded="false"')
  })

  /**
   * A Session nobody has read yet is not one that spent nothing. The slot is
   * empty until the fold has arrived, because `$0.00` would say it was.
   */
  it("says nothing about a spend the fold has not reported", () => {
    expect(renderToStaticMarkup(<TopBar title="Eva" />)).not.toContain("spend")
    expect(renderToStaticMarkup(<TopBar spend="$0.42" title="Eva" />)).toContain("$0.42")
  })
})
