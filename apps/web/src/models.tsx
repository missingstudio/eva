import { modelRef } from "@missingstudio/eva-core"
import type { SessionID } from "@missingstudio/eva-schema"
import {
  PromptInputSelectContent,
  PromptInputSelectTrigger,
} from "@missingstudio/ui/components/ai-elements/prompt-input"
import { Select, SelectItem, SelectValue } from "@missingstudio/ui/components/select"
import { Effect } from "effect"
import { useEffect, useState } from "react"
import { client, models, type PickRow } from "./eva.js"
import { asked, useHeld, whileDrawn } from "./held.js"

/**
 * The model this Session runs on, chosen from what the Catalog knows.
 *
 * The rows are read off the wire and never written here: the serving process
 * holds the Catalog, and `/model` in a terminal picks from the same rows, so
 * a list built on this side would be a second answer to what this build can
 * run. That is also why nothing here takes a typed name — a model the Catalog
 * does not hold is one Eva has no rate and no context window for.
 */

/**
 * A row, on two lines: how a person types the model, and what the Catalog
 * knows about it under that.
 *
 * On one line the pair runs past the width a listbox has to give it — a
 * provider, a model, a context window and a rate — and the end of every row
 * is then cut, which is the half a person is choosing by. Two lines fit, and
 * they put what a reader scans by at the front of every row.
 */
const Row = ({ row }: { readonly row: PickRow }) => (
  <span className="pick">
    <span className="pick-name">{row.label}</span>
    {row.detail === undefined || row.detail === "" ? null : (
      <span className="pick-detail">{row.detail}</span>
    )}
  </span>
)

/**
 * How the page switches the model. The choice is a Session fact and the next
 * Run is where it shows, so nothing waits on the answer — but the answer is
 * handed back all the same, because the picker holds the choice and a refused
 * write has to take it away again.
 *
 * A row's id is `provider/model`, so this reads every row the wire answered.
 * A string that is not one names no model and sets none.
 */
export const setModel = (session: SessionID, id: string): Promise<void> => {
  const wanted = modelRef(id)
  if (wanted === undefined) return Promise.resolve()
  return client().then((one) => Effect.runPromise(one.api.model.set(session, wanted)))
}

export interface Choosing {
  readonly rows: readonly PickRow[]
  readonly chosen: string | undefined
  readonly choose: (id: string) => void
}

/**
 * The rows this build can run, held for the whole page. A Catalog is a fact
 * of the build and not of a Session, so five Sessions opened in one page read
 * one answer rather than asking five times for the same list.
 *
 * Nothing is what a far side that answered no rows gives back, and an empty
 * listing is what the picker says it is reading.
 */
const catalog = asked<readonly PickRow[]>([], () => models().then((known) => known ?? []))

/**
 * The models to offer, and the one this Session is kept at. Two reads, because
 * they are two facts: the Catalog is the build's and the model is the
 * Session's — so one is held for the page and the other for as long as this
 * reader draws this Session.
 *
 * The choice is held here as well as sent. The Session's model is not on the
 * record this page follows, so a picker that waited for the fold to say so
 * would sit on the old name for as long as the Session ran.
 */
export const useChoosing = (session: SessionID): Choosing => {
  const rows = useHeld(catalog)
  const [chosen, setChosen] = useState<string | undefined>(undefined)

  useEffect(
    () =>
      whileDrawn(
        () => client().then((one) => Effect.runPromise(one.api.model.get(session))),
        (found) => setChosen(`${found.provider}/${found.model}`),
      ),
    [session],
  )

  return {
    rows,
    chosen,
    /**
     * The name shows at once and goes back to what the Session was kept at if
     * the far side refuses it. The picker is the only thing on the page that
     * knows the Session's model — it is not on the record this page follows —
     * so a refusal that left the new name standing would be this page saying
     * the Session runs on a model it does not. What was refused, and why, is
     * said on the refusal channel and drawn where the person is typing.
     */
    choose: (id) => {
      setChosen(id)
      void setModel(session, id).catch(() => setChosen(chosen))
    },
  }
}

/**
 * The picker, handed its rows, so what it offers is provable without a socket.
 *
 * A control drawn with nowhere to send its message is disabled rather than
 * hidden, as the four permission options are: a control that looks live and
 * reaches nothing is worse than one that says it is not.
 *
 * It is the listbox `Select` opens, on the ui package's own
 * `select.tsx`. A native `<select>` opens the operating system's list — its
 * font, its colours, its metrics — which is the one control on this page that
 * cannot follow the skin, and this page's whole claim is that it has two.
 *
 * The rows are drawn only while the listbox is open, so `models.test.tsx`
 * proves them in a document rather than in a string: it opens the picker and
 * reads what a person would see, which also lets it prove that choosing a row
 * reaches `choose` — something a rendered string never could.
 */
export const ModelPicker = ({
  rows,
  chosen,
  choose,
}: {
  readonly rows: readonly PickRow[]
  readonly chosen: string | undefined
  readonly choose?: (id: string) => void
}) =>
  rows.length === 0 ? (
    <p aria-busy="true" className="ctl-said" role="status">
      Reading the models…
    </p>
  ) : (
    <Select
      disabled={choose === undefined}
      onValueChange={(value) => choose?.(String(value))}
      // Nothing is chosen until the Session has said what it is kept at, and
      // the trigger then shows the placeholder rather than a model nobody set.
      value={chosen ?? null}
    >
      <PromptInputSelectTrigger aria-label="model" className="ctl">
        {/* The pill names the model and nothing else. What the Catalog knows
            about it belongs on the row a person is choosing between, not on
            the control that reports the choice already made. */}
        <SelectValue placeholder="model">
          {(value: unknown) => (typeof value === "string" && value !== "" ? value : "model")}
        </SelectValue>
      </PromptInputSelectTrigger>
      <PromptInputSelectContent>
        {rows.map((row) => (
          <SelectItem key={row.id} value={row.id}>
            <Row row={row} />
          </SelectItem>
        ))}
      </PromptInputSelectContent>
    </Select>
  )
