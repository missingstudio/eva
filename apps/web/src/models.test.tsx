import { modelRowsIn, readModels, type PickRow, type Request } from "@missingstudio/eva-api/client"
import { modelRows, type CatalogState, type ModelInfo } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
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

const drawn = (rows: readonly PickRow[], chosen?: string) =>
  renderToStaticMarkup(<ModelPicker chosen={chosen} choose={() => undefined} rows={rows} />)

/**
 * The page switches models by choosing from what the Catalog knows, and the
 * rows it offers are `modelRows` of that Catalog — the same function `/model`
 * picks from in a terminal. One list, two doors, so the two cannot drift.
 */
describe("the model picker", () => {
  it("offers the rows the terminal's panel picks from, and no others", async () => {
    const read = await Effect.runPromise(readModels({ request: answering(ROWS) }))

    expect(read).toEqual(ROWS)

    const markup = drawn(read ?? [], ROWS[0]?.id)
    for (const row of ROWS) expect(markup).toContain(row.label)
    expect(markup.match(/<option/g)).toHaveLength(ROWS.length)
  })

  // What the Catalog knows helps somebody choose. What it does not know is
  // left unsaid rather than guessed at, on this door as on the other.
  it("says beside each model what the Catalog holds about it", () => {
    const markup = drawn(ROWS)

    expect(markup).toContain("openai/gpt-5.6-terra · 400k context")
    expect(markup).toContain("anthropic/claude-opus-5 · $3.00/Mtok in")
  })

  // The order is the Catalog's own, provider first. A listing that reordered
  // itself between two doors is a listing a person reads twice.
  it("keeps the order the Catalog holds them in", () => {
    const markup = drawn(ROWS)

    expect(markup.indexOf("openai/gpt-5.6-terra")).toBeLessThan(
      markup.indexOf("anthropic/claude-opus-5"),
    )
  })

  /**
   * A model is picked and never typed. Every row the Catalog holds is an
   * option and there is nowhere here to write one that is not — the same
   * refusal the wire makes by taking a `ModelRef` and nothing else.
   */
  it("offers no field to type a model into", () => {
    const markup = drawn(ROWS, "anthropic/claude-opus-5")

    expect(markup).toContain("<select")
    for (const field of ["<input", "<textarea", "<form"]) expect(markup).not.toContain(field)
  })

  // Nothing is chosen until the Session has said what it is kept at, so the
  // picker names no model rather than naming the first one it was handed.
  it("chooses nothing until the Session has said what it is kept at", () => {
    expect(drawn(ROWS).match(/<option/g)).toHaveLength(ROWS.length + 1)
    expect(drawn(ROWS, "anthropic/claude-opus-5").match(/<option/g)).toHaveLength(ROWS.length)
  })

  /**
   * A control drawn with nowhere to send its message says it is not live,
   * which is the rule the four permission options keep: one that looks live
   * and reaches nothing is worse than one that says it is not.
   */
  it("takes no choice when it was drawn with nowhere to send one", () => {
    const nowhere = renderToStaticMarkup(<ModelPicker chosen={undefined} rows={ROWS} />)

    expect(nowhere).toContain('disabled=""')
    expect(drawn(ROWS)).not.toContain('disabled=""')
  })

  // A picker with nothing to offer says it is reading, rather than drawing an
  // empty one that reads as a Catalog holding no model.
  it("says it is reading while it has no rows", () => {
    expect(drawn([])).toContain("Reading the models…")
    expect(drawn([])).not.toContain("<select")
  })

  // And nothing is what a far side that answered no rows gives back, which is
  // that same state rather than an empty listing it invented.
  it("has no rows when nothing on the far side answered any", async () => {
    expect(await Effect.runPromise(readModels({ request: answering("not rows") }))).toBeUndefined()
    expect(modelRowsIn([{ label: "a row with no id" }])).toBeUndefined()
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
        pipe={{ at: "ready", dropped: false }}
        reading={{ folded: { kind: "folding" }, running: false, said: "" }}
        session="ses_one"
      />,
    )

    expect(markup).toContain("Reading the models…")
  })
})
