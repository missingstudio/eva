import { fileURLToPath } from "node:url"
import { auth } from "@missingstudio/eva-auth"
import { budget } from "@missingstudio/eva-budget"
import { catalogModels } from "@missingstudio/eva-catalog-models"
import { catalogPrices } from "@missingstudio/eva-catalog-prices"
import { commands } from "@missingstudio/eva-commands"
import { config } from "@missingstudio/eva-config"
import { keymap } from "@missingstudio/eva-keymap"
import { print } from "@missingstudio/eva-print"
import { prompt } from "@missingstudio/eva-prompt"
import { providerAnthropic } from "@missingstudio/eva-provider-anthropic"
import { providerCompatible } from "@missingstudio/eva-provider-compatible"
import { providerOpenAI } from "@missingstudio/eva-provider-openai"
import { providerRetry } from "@missingstudio/eva-provider-retry"
import { buildOf, type Build } from "@missingstudio/eva-boot"
import type { ReviewedEntry } from "@missingstudio/eva-config"
import { KERNEL_KEYS, type PluginConfig } from "@missingstudio/eva-kernel"
import type { Plugin, Reads } from "@missingstudio/eva-sdk"
import { sessionJsonl } from "@missingstudio/eva-session-jsonl"
import { themes } from "@missingstudio/eva-themes"
import { trace } from "@missingstudio/eva-trace"
import { traceJsonl } from "@missingstudio/eva-trace-jsonl"
import { traceMemory } from "@missingstudio/eva-trace-memory"
import { validator } from "@missingstudio/eva-validator"
import { makeTui } from "@missingstudio/eva-tui-surface"
import { usage } from "@missingstudio/eva-usage"
import { makeWeb, WEB_SURFACE } from "@missingstudio/eva-web"
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
export const tui = makeTui({
  renderer: async (theme) => {
    const { start } = await import("@missingstudio/eva-tui")
    return start(theme === undefined ? {} : { theme })
  },
  version: VERSION,
})

/**
 * Where the built page is: `apps/web/dist`, beside this app. `src` and `dist`
 * sit at the same depth, so the same lookup answers from source and from the
 * packed build — as `version.ts` reads the manifest above both.
 *
 * A compiled binary carries no tree to look in. Carrying `apps/web/dist` next
 * to a release is `scripts/release/build.ts`'s concern, and until it is done
 * the surface says there is no built page rather than serving 404s.
 */
export const assetRoot = (): string => fileURLToPath(new URL("../../web/dist", import.meta.url))

/**
 * The plugin holds the server; the app holds the tree the page was built
 * into. This table is assembled before a World is read, so the entry here
 * serves and says nothing — `serving` rebuilds it with one run's own writer
 * and bind, because a bind is a fact of a run and not of a build.
 */
export const web = makeWeb({ assets: assetRoot })

// The bind a run asked for. Absent means the surface's own default.
export interface WebBind {
  readonly host?: string
  readonly port?: number
}

/**
 * This build, with `eva.web` bound to what the command line asked for. A
 * surface row is started with a Client and nothing else, so the bind and the
 * writer are closed over when the plugin is made — and the flags are only
 * known once a run has parsed them. The composition root is where a flag and
 * a plugin meet, exactly as it is for `makeTui({ renderer })`.
 */
export const serving = (build: Build, bind: WebBind, write: (text: string) => void): Build =>
  buildOf([
    ...build.all.filter((plugin) => plugin.id !== WEB_SURFACE),
    makeWeb({
      assets: assetRoot,
      write,
      ...(bind.host === undefined ? {} : { host: bind.host }),
      ...(bind.port === undefined ? {} : { port: bind.port }),
    }),
  ])

/**
 * The built-in table, in load order: the trace first because everything
 * records, then base data, then providers and their hooks, then capabilities,
 * then the config projection last so a later entry wins, then surfaces.
 * An explicit import table rather than discovery, so a bare kernel has
 * nothing to scan.
 */
export const BUILT_IN: readonly Plugin[] = [
  trace,
  traceJsonl,
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
  config,
  print,
  tui,
  // Last, and after `tui`: `eva.web` says `interactive: false`, so it can
  // never take the interactive branch from the surface a person types into.
  web,
]

// Available by id but not loaded unless config asks for it.
export const OPTIONAL: readonly Plugin[] = [traceMemory]

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
