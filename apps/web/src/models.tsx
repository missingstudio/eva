import { modelRef } from "@missingstudio/eva-core"
import { sessionID, type SessionID } from "@missingstudio/eva-schema"
import { NativeSelect, NativeSelectOption } from "@missingstudio/ui/components/native-select"
import { Effect } from "effect"
import { useEffect, useState } from "react"
import { client, models, type PickRow } from "./eva.js"

/**
 * The model this Session runs on, chosen from what the Catalog knows.
 *
 * The rows are read off the wire and never written here: the serving process
 * holds the Catalog, and `/model` in a terminal picks from the same rows, so
 * a list built on this side would be a second answer to what this build can
 * run. That is also why nothing here takes a typed name — a model the Catalog
 * does not hold is one Eva has no rate and no context window for.
 */

// What a row says, in one line. The label is how a person types the model,
// and the detail is what the Catalog knows about it.
const lineOf = (row: PickRow): string =>
  row.detail === undefined || row.detail === "" ? row.label : `${row.label} · ${row.detail}`

/**
 * How the page switches the model. Nothing is waited on, as nothing is for the
 * answer to a permission request: the choice is a Session fact and the next
 * Run is where it shows.
 *
 * A row's id is `provider/model`, so this reads every row the wire answered.
 * A string that is not one names no model and sets none.
 */
export const setModel = (session: SessionID, id: string): void => {
  const wanted = modelRef(id)
  if (wanted === undefined) return
  void client().then((one) => Effect.runPromise(one.api.model.set(session, wanted)))
}

export interface Choosing {
  readonly rows: readonly PickRow[]
  readonly chosen: string | undefined
  readonly choose: (id: string) => void
}

/**
 * The models to offer, and the one this Session is kept at. Two reads, because
 * they are two facts: the Catalog is the build's and the model is the
 * Session's.
 *
 * The choice is held here as well as sent. The Session's model is not on the
 * record this page follows, so a picker that waited for the fold to say so
 * would sit on the old name for as long as the Session ran.
 */
export const useChoosing = (session: SessionID): Choosing => {
  const [rows, setRows] = useState<readonly PickRow[]>([])
  const [chosen, setChosen] = useState<string | undefined>(undefined)

  useEffect(() => {
    // The read outlives a page that navigated away from it, so the answer is
    // dropped rather than written into a component nobody is drawing.
    let drawing = true
    void models().then((known) => {
      if (drawing && known !== undefined) setRows(known)
    })
    return () => void (drawing = false)
  }, [])

  useEffect(() => {
    let drawing = true
    void client()
      .then((one) => Effect.runPromise(one.api.model.get(session)))
      .then((found) => {
        if (drawing) setChosen(`${found.provider}/${found.model}`)
      })
    return () => void (drawing = false)
  }, [session])

  return {
    rows,
    chosen,
    choose: (id) => {
      setChosen(id)
      setModel(session, id)
    },
  }
}

/**
 * The picker, handed its rows, so what it offers is provable without a socket.
 *
 * A control drawn with nowhere to send its message is disabled rather than
 * hidden, as the four permission options are: a control that looks live and
 * reaches nothing is worse than one that says it is not.
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
    <p aria-busy="true" className="mt-3 text-muted-foreground text-sm" role="status">
      Reading the models…
    </p>
  ) : (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground text-[13px] uppercase tracking-label">model</span>
      <NativeSelect
        aria-label="model"
        disabled={choose === undefined}
        onChange={(event) => choose?.(event.target.value)}
        size="sm"
        value={chosen ?? ""}
      >
        {/* Nothing is chosen until the Session has said what it is kept at. */}
        {chosen === undefined ? <NativeSelectOption value="" /> : null}
        {rows.map((row) => (
          <NativeSelectOption key={row.id} value={row.id}>
            {lineOf(row)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )

/**
 * The picker, reading. `Page` reads its own listing for the same reason: the
 * views take what they draw as props, and one component per read is what keeps
 * the reads out of the drawings.
 */
export const Models = ({ session }: { readonly session: string }) => {
  const choosing = useChoosing(sessionID(session))

  return <ModelPicker chosen={choosing.chosen} choose={choosing.choose} rows={choosing.rows} />
}
