import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { API_PLUGIN, makeApi, type Answering } from "@missingstudio/eva-api"
import { approval } from "@missingstudio/eva-approval"
import { auth } from "@missingstudio/eva-auth"
import { budget } from "@missingstudio/eva-budget"
import { catalogModels } from "@missingstudio/eva-catalog-models"
import { catalogPrices } from "@missingstudio/eva-catalog-prices"
import { commands } from "@missingstudio/eva-commands"
import { config } from "@missingstudio/eva-config"
import { diff } from "@missingstudio/eva-diff"
import { fs } from "@missingstudio/eva-fs"
import { harnessLoop } from "@missingstudio/eva-harness-loop"
import { keymap } from "@missingstudio/eva-keymap"
import { print } from "@missingstudio/eva-print"
import { prompt } from "@missingstudio/eva-prompt"
import { providerAnthropic } from "@missingstudio/eva-provider-anthropic"
import { providerCompatible } from "@missingstudio/eva-provider-compatible"
import { providerOpenAI } from "@missingstudio/eva-provider-openai"
import { providerRetry } from "@missingstudio/eva-provider-retry"
import { sandboxNone } from "@missingstudio/eva-sandbox-none"
import { sched } from "@missingstudio/eva-sched"
import { shell } from "@missingstudio/eva-shell"
import { buildOf, type Build } from "@missingstudio/eva-boot"
import type { ReviewedEntry } from "@missingstudio/eva-config"
import type { SessionAPI } from "@missingstudio/eva-core"
import { KERNEL_KEYS, type PluginConfig } from "@missingstudio/eva-kernel"
import type { Plugin, Reads, Running } from "@missingstudio/eva-sdk"
import { sessionJsonl } from "@missingstudio/eva-session-jsonl"
import { themes } from "@missingstudio/eva-themes"
import { toolBash } from "@missingstudio/eva-tool-bash"
import { toolEdit } from "@missingstudio/eva-tool-edit"
import { toolGlob } from "@missingstudio/eva-tool-glob"
import { toolGrep } from "@missingstudio/eva-tool-grep"
import { toolPolicy } from "@missingstudio/eva-tool-policy"
import { toolRead } from "@missingstudio/eva-tool-read"
import { toolWeb } from "@missingstudio/eva-tool-web"
import { trace } from "@missingstudio/eva-trace"
import { traceJsonl } from "@missingstudio/eva-trace-jsonl"
import { traceMemory } from "@missingstudio/eva-trace-memory"
import { tracePostgres } from "@missingstudio/eva-trace-postgres"
import { traceSqlite } from "@missingstudio/eva-trace-sqlite"
import { validator } from "@missingstudio/eva-validator"
import { makeTui, TUI_SURFACE, type TuiOptions } from "@missingstudio/eva-tui-surface"
import { usage } from "@missingstudio/eva-usage"
import { hasPage, makeWeb, WEB_SURFACE } from "@missingstudio/eva-web"
import { workflow } from "@missingstudio/eva-workflow"
import { VERSION } from "./version.js"

/**
 * The plugin holds the Renderer contract; the app holds the terminal.
 * Binding them is the composition root's job.
 *
 * The app is reached through a dynamic import because its rich renderer is
 * native code over Bun's FFI. A `--print` run, and any run on Node, never
 * loads it — the module is not named until a surface actually starts.
 */
const RENDERER: TuiOptions["renderer"] = async (theme) => {
  const { start } = await import("@missingstudio/eva-tui")
  return start(theme === undefined ? {} : { theme })
}

export const tui = makeTui({ renderer: RENDERER, version: VERSION })

// What `scripts/release/build.ts` names the page it stages beside the binary.
const PAGE = "eva-page"

/**
 * Where the built page is. In the workspace that is `apps/web/dist`, beside
 * this app: `src` and `dist` sit at the same depth, so the same lookup answers
 * from source and from the packed build — as `version.ts` reads the manifest
 * above both.
 *
 * A compiled binary carries no tree to look in and has no workspace over it,
 * so the release stages the page beside the binary and this looks there first.
 * `process.execPath` is that binary when Eva is compiled, and it is `bun`
 * itself when Eva is run from source — where nothing is staged beside it, so
 * the workspace answers. The workspace also answers when neither holds a
 * page, because the notice a person then reads names the build they can run.
 */
export const assetRoot = (executable: string = process.execPath): string => {
  const staged = resolve(dirname(executable), PAGE)
  return hasPage(staged) ? staged : fileURLToPath(new URL("../../web/dist", import.meta.url))
}

/**
 * The plugin holds the server; the app holds the tree the page was built
 * into. This table is assembled before a World is read, so the entry here
 * serves and says nothing — `serving` rebuilds it with one run's own writer
 * and bind, because a bind is a fact of a run and not of a build.
 */
export const web = makeWeb({ assets: assetRoot })

/**
 * The other half of the same port. `eva.api` answers the calls and `eva.web`
 * binds, and neither may import the other — so the two meet here, as the
 * terminal and its renderer do. This entry hands its wire nowhere, for the
 * reason the `eva.web` entry says nothing: `serving` rebuilds both with one
 * run's own cell.
 */
export const api = makeApi({ serve: () => undefined })

// The bind a run asked for. Absent means the surface's own default.
export interface WebBind {
  readonly host?: string
  readonly port?: number
}

/**
 * This build, with the two halves of one port wired to each other and to what
 * the command line asked for. A surface row is started with a Client and
 * nothing else, so the bind and the writer are closed over when the plugin is
 * made — and the flags are only known once a run has parsed them. The
 * composition root is where a flag and a plugin meet, exactly as it is for
 * `makeTui({ renderer })`.
 *
 * The cell is this run's own. `eva.api` fills it when it loads, so a run that
 * left it out serves the page and answers no call — a degradation, and not a
 * crash.
 */
export const serving = (build: Build, bind: WebBind, write: (text: string) => void): Build => {
  let wire: ((api: SessionAPI) => Answering) | undefined

  return buildOf([
    ...build.all.filter((plugin) => plugin.id !== WEB_SURFACE && plugin.id !== API_PLUGIN),
    makeApi({ serve: (one) => void (wire = one) }),
    makeWeb({
      assets: assetRoot,
      api: (client) => wire?.(client.api),
      write,
      ...(bind.host === undefined ? {} : { host: bind.host }),
      ...(bind.port === undefined ? {} : { port: bind.port }),
    }),
  ])
}

/**
 * This build, with the terminal pointed at a runtime another process serves.
 *
 * Two things change and nothing else does. A line runs where the Domains are,
 * because a command mutates state where it runs — a `/mode` dispatched here
 * would move this process's approval state and leave the Run under the mode it
 * already had. And the banner names the address rather than this directory,
 * because the repository the work happens in is on the machine the runtime is
 * on.
 *
 * The rest of the table stays: the terminal reads its theme, its keymap and
 * its renderer from the process the person is sitting at, which is this one.
 *
 * The row is replaced where it stands, and a build carrying none gets none.
 * Load order is what says a person who typed a verb with no surface in it
 * gets the terminal and not the page — `eva.tui` is registered before
 * `eva.web` for exactly that — so a rebuild that moved it would attach a
 * browser to the runtime instead of this terminal.
 */
export const attaching = (build: Build, origin: string, run: Running): Build =>
  buildOf(
    build.all.map((plugin) =>
      plugin.id === TUI_SURFACE
        ? makeTui({
            renderer: RENDERER,
            version: VERSION,
            where: () => ({ kind: "runtime", origin }),
            run,
          })
        : plugin,
    ),
  )

/**
 * The built-in table, in load order: the trace first because everything
 * records, then base data, then providers and their hooks, then capabilities,
 * then the config projection last so a later entry wins, then surfaces.
 * An explicit import table rather than discovery, so a bare kernel has
 * nothing to scan.
 */
export const BUILT_IN: readonly Plugin[] = [
  trace,
  traceSqlite,
  sessionJsonl,
  auth,
  catalogModels,
  catalogPrices,
  providerAnthropic,
  providerOpenAI,
  // After `providerOpenAI`, so a person who names an endpoint `openai`
  // overrides the first-party one: load order is the documented answer.
  providerCompatible,
  providerRetry,
  usage,
  budget,
  validator,
  fs,
  shell,
  // After `shell`, which it starts a command through. Load order does not
  // bind them — the Sandbox reads the Shell slot at the moment of use — and
  // the table still reads in the order the capabilities stack.
  sandboxNone,
  diff,
  // The tools, together. Load order binds none of them to a filler above —
  // every one reads its slot at the moment of use — so stage 4's containment
  // arrives behind `toolBash` with no change here.
  toolRead,
  toolEdit,
  toolGrep,
  toolGlob,
  toolWeb,
  toolBash,
  // After the tools, because it narrows the rows they registered: a build
  // that makes a tool a barrier edits a row that is already there.
  sched,
  // After the tools it gates, which is how the table reads rather than how the
  // gate works: a hook decides wherever it registered, and the strictest
  // decision wins whatever the order was.
  toolPolicy,
  // After the tools, because a mode removes rows they registered. After
  // `toolPolicy` for the way the table reads and not for the way the two
  // gates compose: a mandate is a decision, supervision is a baseline, and
  // neither reads the other.
  approval,
  commands,
  themes,
  keymap,
  // After every plugin that seeds a built-in Template, so the person's
  // config wins the same-id replace.
  prompt,
  // After `prompt`, `catalogModels`, `catalogPrices`, the providers and
  // `validator`: load order is transform-replay precedence, and the built-in
  // repair Template fills only a row the person's config left empty.
  workflow,
  // After `prompt` for the same reason, and after the tools and both gates:
  // the loop reads the tool domain at every Step, so what it offers a model
  // is the domain the mode built.
  harnessLoop,
  config,
  print,
  tui,
  // Before `eva.web`, which serves the port it answers on. It registers no
  // row: a wire is not a Domain, and the plugin id is what a person turns off.
  api,
  /**
   * Last, and after `tui`. Both rows are interactive, and the first one wins
   * the interactive branch — so the order here is what says a person who
   * typed `eva` gets the terminal. `eva serve` names this row by id.
   */
  web,
]

/**
 * Available by id but not loaded unless config asks for it. The other three
 * trace sinks live here: SQLite is the default, and swapping it is two
 * lines of config — disable `eva.trace.sqlite`, name the one wanted.
 */
export const OPTIONAL: readonly Plugin[] = [traceJsonl, traceMemory, tracePostgres]

/**
 * What this build carries, as the one thing that answers for it. `boot` is
 * handed this, and so is the key sweep that reports a config naming a plugin
 * nobody has — so `eva --show-config` and the run that follows it cannot
 * disagree about which ids this binary has an implementation for.
 */
export const BUILD: Build = buildOf([...BUILT_IN, ...OPTIONAL])
export const ALL: readonly Plugin[] = BUILD.all
export const BUILT_IN_IDS: readonly string[] = BUILT_IN.map((plugin) => plugin.id)

export const byID = (id: string): Plugin | undefined => BUILD.carries(id)

// The resolved ids this build has no implementation for. `Kernel.missing`
// answers the same question after booting, from the same predicate — but the
// findings are reported before anything loads, and `eva config show` never
// boots at all.
export const uncarriedOf = (resolved: readonly PluginConfig[]): readonly string[] =>
  resolved.filter((entry) => BUILD.carries(entry.id) === undefined).map((entry) => entry.id)

/**
 * Every config key the plugins that would load declare they read, and the
 * kernel's own. A plugin this build does not carry declares nothing, so its
 * keys are reported as reaching nothing — which is what they did.
 */
export const readsOf = (resolved: readonly PluginConfig[]): Reads =>
  Object.assign(
    {},
    KERNEL_KEYS,
    ...resolved.map((entry) => BUILD.carries(entry.id)?.reads ?? {}),
  ) as Reads

/**
 * Each resolved entry beside what the plugin that would load declares its
 * options are, so the sweep reaches a plugin's own options too. An id this
 * build carries no implementation for is left out: it is reported as
 * uncarried already, and it declares nothing to check against.
 */
export const entriesOf = (resolved: readonly PluginConfig[]): readonly ReviewedEntry[] =>
  resolved.flatMap((entry) => {
    const plugin = BUILD.carries(entry.id)
    return plugin === undefined
      ? []
      : [{ id: entry.id, options: entry.options ?? {}, takes: plugin.takes ?? {} }]
  })
