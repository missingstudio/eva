// @vitest-environment happy-dom
import { CALLS, readModels, type PickRow, type Request } from "@missingstudio/eva-api/client"
import { modelRows, type CatalogState, type ModelInfo } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"
import { ModelPicker } from "./models.js"
import { Session } from "./session.js"

/**
 * The Catalog a serving process holds, filled the way a Provider's plugin
 * fills one: a model it knows a context window for, and a model it knows a
 * rate for.
 */
const CATALOG: CatalogState = {
  providers: new Map(),
  models: new Map<string, Map<string, ModelInfo>>([
    [
      "openai",
      new Map([["gpt-5.6-terra", { id: "gpt-5.6-terra", name: "Terra", contextWindow: 400_000 }]]),
    ],
    [
      "anthropic",
      new Map([
        [
          "claude-opus-5",
          {
            id: "claude-opus-5",
            name: "Opus 5",
            price: { inputTicks: 30_000_000_000, outputTicks: 150_000_000_000 },
          },
        ],
      ]),
    ],
  ]),
}

const ROWS = modelRows(CATALOG)

// The wire, answering a body. The route is proven in `plugins/api` against a
// real socket; what is read here is the page's half of the same answer.
const answering = (body: unknown): Request =>
  (async () =>
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json; charset=utf-8" },
    })) as Request

/**
 * The picker, in a document.
 *
 * A listbox draws its rows only while it is open, so a rendered string holds
 * the trigger and nothing else. Reading it here instead is what keeps the
 * clauses this suite has always made — the rows are the Catalog's, in the
 * Catalog's order, and nothing is chosen until the Session has said — and it
 * buys one the string never could: that taking a row reaches `choose`.
 */
let mounted: Root | undefined

afterEach(() => {
  act(() => mounted?.unmount())
  mounted = undefined
  document.body.replaceChildren()
})

const shown = async (rows: readonly PickRow[], chosen?: string, choose?: (id: string) => void) => {
  const host = document.createElement("div")
  document.body.append(host)
  mounted = createRoot(host)

  await act(async () => {
    mounted?.render(
      <ModelPicker chosen={chosen} rows={rows} {...(choose === undefined ? {} : { choose })} />,
    )
  })

  return document.querySelector<HTMLElement>('[aria-label="model"]')
}

// The picker, opened, and the rows a person then sees.
const opened = async (rows: readonly PickRow[], chosen?: string, choose?: (id: string) => void) => {
  const trigger = await shown(rows, chosen, choose)
  await act(async () => trigger?.click())
  return [...document.querySelectorAll('[role="option"]')].map((one) => one.textContent ?? "")
}

describe("the model picker", () => {
  it("offers the rows the terminal's panel picks from, and no others", async () => {
    const read = await Effect.runPromise(readModels({ request: answering(ROWS) }))

    expect(read).toEqual(ROWS)

    const drawn = await opened(read ?? [], ROWS[0]?.id, () => undefined)
    expect(drawn).toHaveLength(ROWS.length)
    for (const row of ROWS) expect(drawn.join(" ")).toContain(row.label)
  })

  /**
   * What the Catalog knows helps somebody choose. What it does not know is
   * left unsaid rather than guessed at, on this door as on the other.
   *
   * The two sit on two lines of one row, so the row is read rather than the
   * joined string: a name and, under it, what the Catalog holds about it.
   */
  it("says beside each model what the Catalog holds about it", async () => {
    const drawn = (await opened(ROWS, undefined, () => undefined)).join(" ")

    expect(drawn).toContain("openai/gpt-5.6-terra")
    expect(drawn).toContain("400k context")
    expect(drawn).toContain("anthropic/claude-opus-5")
    expect(drawn).toContain("$3.00/Mtok in")
  })

  // The order is the Catalog's own, provider first. A listing that reordered
  // itself between two doors is a listing a person reads twice.
  it("keeps the order the Catalog holds them in", async () => {
    const drawn = await opened(ROWS, undefined, () => undefined)

    expect(drawn[0]).toContain("openai/gpt-5.6-terra")
    expect(drawn[1]).toContain("anthropic/claude-opus-5")
  })

  /**
   * A model is picked and never typed. Every row the Catalog holds is on the
   * list and there is nowhere to write one that is not — the same refusal the
   * wire makes by taking a `ModelRef` and nothing else.
   *
   * The listbox keeps a hidden input beside its trigger, which is how a form
   * reads its value. It is out of the tab order and out of the accessibility
   * tree, so it is not a field: nobody can reach it and nothing announces it.
   */
  it("offers no field to type a model into", async () => {
    await opened(ROWS, "anthropic/claude-opus-5", () => undefined)

    for (const field of document.querySelectorAll("input, textarea")) {
      expect(field.getAttribute("aria-hidden")).toBe("true")
      expect(field.getAttribute("tabindex")).toBe("-1")
    }
    expect(document.querySelector("form")).toBeNull()
  })

  /**
   * Taking a row is what changes the model, and the id it hands over is the
   * row's own — `provider/model`, the argument the typed line would carry.
   */
  it("hands the chosen row's id over, and nothing until a row is taken", async () => {
    const taken: string[] = []
    await opened(ROWS, undefined, (id) => taken.push(id))

    expect(taken).toEqual([])

    const row = [...document.querySelectorAll<HTMLElement>('[role="option"]')][1]
    await act(async () => row?.click())

    expect(taken).toEqual(["anthropic/claude-opus-5"])
  })

  // Nothing is chosen until the Session has said what it is kept at, so the
  // trigger names no model rather than naming the first one it was handed.
  it("chooses nothing until the Session has said what it is kept at", async () => {
    const none = await shown(ROWS, undefined, () => undefined)
    expect(none?.textContent).not.toContain("claude-opus-5")

    act(() => mounted?.unmount())
    document.body.replaceChildren()

    const set = await shown(ROWS, "anthropic/claude-opus-5", () => undefined)
    expect(set?.textContent).toContain("anthropic/claude-opus-5")
  })

  /**
   * A control drawn with nowhere to send its message says it is not live,
   * which is the rule the four permission options keep: one that looks live
   * and reaches nothing is worse than one that says it is not.
   */
  it("takes no choice when it was drawn with nowhere to send one", async () => {
    const nowhere = await shown(ROWS, undefined)
    expect(nowhere?.hasAttribute("disabled")).toBe(true)

    act(() => mounted?.unmount())
    document.body.replaceChildren()

    const live = await shown(ROWS, undefined, () => undefined)
    expect(live?.hasAttribute("disabled")).toBe(false)
  })

  // A picker with nothing to offer says it is reading, rather than drawing an
  // empty one that reads as a Catalog holding no model.
  it("says it is reading while it has no rows", () => {
    const drawn = renderToStaticMarkup(<ModelPicker chosen={undefined} rows={[]} />)

    expect(drawn).toContain("Reading the models…")
    expect(drawn).not.toContain("combobox")
  })

  // And nothing is what a far side that answered no rows gives back, which is
  // that same state rather than an empty listing it invented.
  it("has no rows when nothing on the far side answered any", async () => {
    expect(await Effect.runPromise(readModels({ request: answering("not rows") }))).toBeUndefined()
    expect(CALLS.models.answer.reads([{ label: "a row with no id" }])).toBeUndefined()
  })

  /**
   * And it stands on the Session page. The picker reads for itself, as the
   * listing does, so a page drawn without a socket says it is reading — which
   * is the state a reader sees before the wire has answered.
   */
  it("stands on the Session page", () => {
    const markup = renderToStaticMarkup(
      <Session
        header={undefined}
        pipe={{ at: "ready" }}
        reading={{ folded: { kind: "folding" }, running: false, said: "" }}
        session="ses_one"
      />,
    )

    expect(markup).toContain("Reading the models…")
  })
})
