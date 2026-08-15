import { Effect } from "effect"
import {
  fileLayer,
  inlineLayer,
  layered,
  resolvePlugins,
  valueLayer,
  type Config,
  type ConfigError,
  type Layer,
  type PluginConfig,
} from "./config.js"
import { resolveLocation, type Location } from "./location.js"

/**
 * What the command line contributes to the resolution order. `config` names
 * files to overlay; the rest become the last layer, so a flag wins over
 * every file and says so.
 */
export interface Overlays {
  readonly config?: readonly string[]
  readonly model?: string
  readonly plugin?: readonly string[]
  readonly noPlugin?: readonly string[]
}

// The origin a flag leaves against every key it set.
export const COMMAND_LINE = "the command line"

/**
 * The flags as one layer. They merge like any other rung rather than being
 * applied to the result, so `--model` carries an origin and the file it
 * overrode is no longer the name printed against the key.
 */
export const flagLayer = (overlays: Overlays): Layer | undefined => {
  const plugins = [
    ...(overlays.plugin ?? []).map((id) => ({ id })),
    ...(overlays.noPlugin ?? []).map((id) => ({ id, disabled: true })),
  ]
  const raw: Record<string, unknown> = {
    ...(overlays.model === undefined ? {} : { model: overlays.model }),
    ...(plugins.length === 0 ? {} : { plugins }),
  }
  return Object.keys(raw).length === 0 ? undefined : valueLayer(raw, COMMAND_LINE)
}

/**
 * The top-level config keys the kernel itself reads. It is not a plugin, so
 * it declares here rather than beside an id.
 */
export const KERNEL_KEYS = { plugins: "list" } as const

/** Where a run would read config from, what it says, and which plugins load. */
export interface Resolution {
  readonly location: Location
  readonly config: Config
  readonly plugins: readonly PluginConfig[]
}

export interface ResolveOptions {
  readonly builtIn?: readonly string[]
  readonly overlays?: Overlays
  readonly directory?: string
  readonly env?: NodeJS.ProcessEnv
}

/**
 * The whole resolution order architecture §10 defines, and nothing else — no
 * kernel, no plugin runs. `eva config show` answers from this, so it reports
 * what a run would use without starting one.
 *
 * Lowest precedence first: the user directory and file, then
 * `EVA_CONFIG_DIR`, then the project directories if this one is trusted, then
 * every `--config` in argv order, then `EVA_CONFIG_CONTENT`, then the flags.
 * Bundles and profiles are rungs 2 and 3 and do not exist yet; they land
 * between the built-in defaults and the user directory, here.
 *
 * The directory and the environment are arguments, so a test resolves against
 * a scratch directory rather than the person's own.
 */
export const resolveConfiguration = Effect.fn("kernel.resolveConfiguration")(function* (
  options: ResolveOptions = {},
): Effect.fn.Return<Resolution, ConfigError> {
  const { builtIn = [], overlays = {}, directory = process.cwd(), env = process.env } = options

  const location = yield* resolveLocation(directory, env)
  const inline = inlineLayer(env)
  const flags = flagLayer(overlays)

  const config = yield* layered([
    ...location.chain,
    ...(overlays.config ?? []).map((path) => fileLayer(path)),
    ...(inline === undefined ? [] : [inline]),
    ...(flags === undefined ? [] : [flags]),
  ])

  return { location, config, plugins: resolvePlugins(config, builtIn) } satisfies Resolution
})
