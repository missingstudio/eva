import { modelRef } from "@missingstudio/eva-core"
import { toUsd } from "@missingstudio/eva-schema"
import {
  define,
  helpText,
  type CatalogState,
  type CommandContext,
  type CommandInfo,
  type ModelInfo,
  type PickRow,
} from "@missingstudio/eva-sdk"
import { Effect } from "effect"

// One block of lines, said once. A surface shows what it is given, so what
// is one answer arrives as one answer.
const wrote = (ctx: CommandContext, lines: readonly string[]): void =>
  ctx.write(`${lines.join("\n")}\n`)

// What the Catalog knows about a model that helps somebody choose one. A
// fact the Catalog does not hold is left unsaid rather than guessed at.
const modelDetail = (model: ModelInfo): string =>
  [
    model.contextWindow === undefined ? "" : `${Math.round(model.contextWindow / 1000)}k context`,
    model.price === undefined ? "" : `$${toUsd(model.price.inputTicks).toFixed(2)}/Mtok in`,
  ]
    .filter((part) => part !== "")
    .join(" · ")

// Every model this build can reach, named the way a person types one — so
// the row a panel takes is the argument the line would have carried.
export const modelRows = (catalog: CatalogState): readonly PickRow[] =>
  [...catalog.models].flatMap(([provider, models]) =>
    [...models.values()].map((model) => ({
      id: `${provider}/${model.id}`,
      label: `${provider}/${model.id}`,
      detail: modelDetail(model),
    })),
  )

const setModel = Effect.fn("eva.commands.model.set")(function* (
  ctx: CommandContext,
  named: string,
) {
  const wanted = modelRef(named)
  if (wanted === undefined) {
    ctx.write(`not a model reference: ${named}\n`)
    return
  }
  yield* ctx.api.model.set(ctx.session, wanted)
  // The outcome is said in words, so a pipe transcript is never poorer than
  // the screen: a choice taken from a panel reads back the way a choice
  // typed on the line does.
  ctx.write(`model → ${wanted.provider}/${wanted.model}\n`)
})

/**
 * `/model`: an argument sets it, and no argument asks. Asking is a panel
 * where the surface draws one, and the model beside the models where it
 * does not — the same answer, in what the surface can say.
 */
const showModel = (catalog: Effect.Effect<CatalogState>) =>
  Effect.fn("eva.commands.model")(function* (ctx: CommandContext) {
    if (ctx.argument !== undefined) return yield* setModel(ctx, ctx.argument)

    const rows = modelRows(yield* catalog)
    if (ctx.pick === undefined) {
      const current = yield* ctx.api.model.get(ctx.session)
      wrote(ctx, [`${current.provider}/${current.model}`, ...rows.map((row) => `  ${row.label}`)])
      return
    }

    const chosen = yield* ctx.pick("model", rows)
    // Nothing chosen is what keeping what you had is called, and a Session
    // fact is never changed by a panel that was only looked at.
    if (chosen !== undefined) yield* setModel(ctx, chosen.id)
  })

// Opening is the whole answer: the surface follows the selection and shows
// the new Session's fold, which is empty. A raw session id is a fact for the
// record, not a line for a person, so nothing is written.
const openNew = Effect.fn("eva.commands.clear")(function* (ctx: CommandContext) {
  ctx.select(yield* ctx.api.create(process.cwd()))
})

/**
 * The rows this plugin registers, as the Domain holds them. A row without
 * `run` names a command whose behaviour is not a function of the line alone:
 * `/cost` belongs to the plugin that prints, and `/help` and `/model` read
 * Domains this plugin is itself registered in, so their handlers are built
 * where that context is.
 */
export const COMMANDS: readonly CommandInfo[] = [
  { id: "model", description: "Show or set the session model", argumentHint: "provider/model" },
  { id: "cost", description: "Show what this session has spent" },
  { id: "clear", description: "Open a new Session", aliases: ["new"], run: openNew },
  { id: "help", description: "List the commands" },
]

export const commands = define({
  id: "eva.commands",
  effect: Effect.fn("eva.commands")(function* (ctx) {
    const showHelp = Effect.fn("eva.commands.help")(function* (command: CommandContext) {
      command.write(`${helpText(yield* ctx.command.get)}\n`)
    })
    const chooseModel = showModel(ctx.catalog.get)

    yield* ctx.command.transform((draft) => {
      for (const command of COMMANDS) draft.set(command)
      // The two above are registered without a `run`, because the ones they
      // need close over this context. The rows exist by now, so this edits
      // them.
      draft.update("help", (row) => {
        row.run = showHelp
      })
      draft.update("model", (row) => {
        row.run = chooseModel
      })
    })
  }),
})
