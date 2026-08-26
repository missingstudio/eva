import { readFileSync } from "node:fs"
import { configPath, expand } from "@missingstudio/eva-core/local"
import { Effect } from "effect"
import { parse } from "yaml"
import { deepMerge, leaves } from "./mapping.js"
import { resources } from "./resources.js"

/**
 * One entry per plugin, whether it is internal or external. `disabled`
 * accepts a wildcard; the list is walked left to right and a later entry
 * for the same id sets the fields it names and leaves the rest, so a layer
 * turns a plugin off without restating its package and options.
 */
export interface PluginConfig {
  readonly id: string
  readonly package?: string
  readonly options?: Record<string, unknown>
  readonly disabled?: boolean
}

export interface Config {
  readonly plugins: readonly PluginConfig[]
  // Everything the kernel does not read. Interpreting it is a plugin's job,
  // and `model` is in here rather than beside `plugins` because the Catalog
  // owns what a model name means.
  readonly raw: Record<string, unknown>
  // Each leaf key, dotted, against the source that last set it.
  readonly origin: Readonly<Record<string, string>>
}

export const EMPTY: Config = { plugins: [], raw: {}, origin: {} }

export class ConfigError extends Error {
  override readonly name = "ConfigError"
  readonly path: string
  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.path = path
  }
}

/**
 * Where the person's own config file is. `EVA_CONFIG` replaces that path
 * rather than adding a layer over it, and `--config` is the flag that
 * overlays.
 *
 * It lives beside `expand` in `eva-core/local`, because `eva.approval` writes
 * a grant into the same file and a plugin may not import the kernel.
 */
export { configPath } from "@missingstudio/eva-core/local"

/**
 * Where a key came from. A mapping key has no origin of its own, so this
 * answers with the first leaf below it — enough to name the file.
 */
export const originOf = (config: Config, key: string): string | undefined =>
  config.origin[key] ??
  Object.entries(config.origin).find(([path]) => path.startsWith(`${key}.`))?.[1]

const entry = (value: unknown, path: string): PluginConfig => {
  if (typeof value === "string") return { id: value }
  if (typeof value !== "object" || value === null) {
    throw new ConfigError(path, "a plugin entry is a string or an object")
  }
  const record = value as Record<string, unknown>
  const id = record["id"]
  if (typeof id !== "string" || id.length === 0) {
    throw new ConfigError(path, "a plugin entry object needs an id")
  }
  return {
    id,
    ...(typeof record["package"] === "string" ? { package: record["package"] } : {}),
    ...(typeof record["options"] === "object" && record["options"] !== null
      ? { options: record["options"] as Record<string, unknown> }
      : {}),
    ...(typeof record["disabled"] === "boolean" ? { disabled: record["disabled"] } : {}),
  }
}

/**
 * A mapping read as a config, whatever produced it. The kernel validates only
 * the shape it owns and carries every other key through, because interpreting
 * config is a plugin's job.
 */
export const configOf = (record: Record<string, unknown>, path: string): Config => {
  const plugins = record["plugins"]
  if (plugins !== undefined && !Array.isArray(plugins)) {
    throw new ConfigError(path, "plugins is a list")
  }
  return {
    plugins: (plugins ?? []).map((value) => entry(value, path)),
    raw: record,
    origin: Object.fromEntries(leaves(record).map((key) => [key, path])),
  }
}

export const parseConfig = (source: string, path: string): Config => {
  const parsed: unknown = source.trim() === "" ? {} : parse(source)
  if (parsed === null || parsed === undefined) return EMPTY
  if (typeof parsed !== "object") throw new ConfigError(path, "the config is a mapping")
  return configOf(parsed as Record<string, unknown>, path)
}

// A missing file is not an error: the kernel boots with no config at all.
export const readConfig = (path: string = configPath()): Effect.Effect<Config, ConfigError> =>
  Effect.try({
    try: () => {
      try {
        return parseConfig(readFileSync(path, "utf8"), path)
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return EMPTY
        throw cause
      }
    },
    catch: (cause) => (cause instanceof ConfigError ? cause : new ConfigError(path, String(cause))),
  })

/**
 * Two layers, later wins. Mappings merge key by key, so a project file that
 * names one agent no longer erases the rest. Plugin entries concatenate,
 * because `resolvePlugins` already gives a later entry for the same id the
 * last word — so order carries the precedence and nothing is dropped early.
 */
export const mergeConfig = (base: Config, over: Config): Config => {
  const raw = deepMerge(base.raw, over.raw)
  const origin: Record<string, string> = { ...base.origin, ...over.origin }
  return {
    plugins: [...base.plugins, ...over.plugins],
    raw,
    // A key the later layer replaced wholesale takes the origins under it
    // away, because those leaves are no longer in the merged mapping.
    origin: Object.fromEntries(
      leaves(raw).flatMap((key) => {
        const from = origin[key]
        return from === undefined ? [] : [[key, from] as const]
      }),
    ),
  }
}

/**
 * One rung of the resolution order. A directory holds the resources beside
 * a config file — an agent is a Markdown file, not a YAML string — an inline
 * layer is config given in the environment rather than on disk, and a values
 * layer is a mapping something built rather than read.
 */
export type Layer =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "directory"; readonly path: string }
  | { readonly kind: "inline"; readonly source: string; readonly label: string }
  | { readonly kind: "values"; readonly raw: Record<string, unknown>; readonly label: string }

export const fileLayer = (path: string): Layer => ({ kind: "file", path })
export const directoryLayer = (path: string): Layer => ({ kind: "directory", path })

/**
 * A mapping that never was a file. The flags are the layer this exists for:
 * a rung of the order that merges and carries an origin like the rest, so
 * the file a flag overrode is no longer the name against the key.
 */
export const valueLayer = (raw: Record<string, unknown>, label: string): Layer => ({
  kind: "values",
  raw,
  label,
})

export const INLINE = "EVA_CONFIG_CONTENT"

/**
 * Config carried in the environment. It layers over every file and under
 * the flags, so a script sets two keys without writing a temporary file.
 */
export const inlineLayer = (env: NodeJS.ProcessEnv = process.env): Layer | undefined => {
  const source = env[INLINE]
  return source === undefined || source.trim() === ""
    ? undefined
    : { kind: "inline", source, label: INLINE }
}

// The resources a directory holds, as a layer that merges like any other.
export const readResources = (path: string): Effect.Effect<Config, ConfigError> =>
  Effect.try({
    try: () => {
      const found = resources(path)
      return { plugins: [], raw: found.raw, origin: found.origin } satisfies Config
    },
    catch: (cause) => (cause instanceof ConfigError ? cause : new ConfigError(path, String(cause))),
  })

const readLayer = (layer: Layer): Effect.Effect<Config, ConfigError> => {
  if (layer.kind === "file") return readConfig(expand(layer.path))
  if (layer.kind === "directory") return readResources(expand(layer.path))
  const label = layer.label
  return Effect.try({
    try: () =>
      layer.kind === "values" ? configOf(layer.raw, label) : parseConfig(layer.source, label),
    catch: (cause) =>
      cause instanceof ConfigError ? cause : new ConfigError(label, String(cause)),
  })
}

/**
 * The config layers architecture §10 defines, read lowest precedence first.
 * `resolveConfiguration` supplies the whole order; this only merges what it
 * is handed, so a caller with layers of its own can still use it.
 */
export const layered = (layers: readonly Layer[]): Effect.Effect<Config, ConfigError> =>
  Effect.reduce(
    layers,
    () => EMPTY,
    (config, layer) => Effect.map(readLayer(layer), (one) => mergeConfig(config, one)),
  )

const matches = (pattern: string, id: string): boolean => {
  if (pattern === id) return true
  if (!pattern.endsWith("*")) return false
  return id.startsWith(pattern.slice(0, -1))
}

/**
 * Resolves which plugins load, in list order. A later entry for the same id
 * sets the fields it names and keeps the rest, so `[{id:"*",disabled:true}]`
 * boots the bare kernel and `--plugin` turns one back on without erasing the
 * options a config file set. A field replaces as a unit: a later `options`
 * is the whole options, never a deep merge of two.
 */
export const resolvePlugins = (
  config: Config,
  builtIn: readonly string[],
): readonly PluginConfig[] => {
  const order: string[] = [...builtIn]
  const settings = new Map<string, PluginConfig>()

  for (const id of builtIn) settings.set(id, { id })

  for (const item of config.plugins) {
    if (item.id.includes("*")) {
      for (const id of order) {
        if (matches(item.id, id)) {
          settings.set(id, { ...settings.get(id), ...item, id })
        }
      }
      continue
    }

    if (!order.includes(item.id)) order.push(item.id)
    settings.set(item.id, { ...settings.get(item.id), ...item })
  }

  return order
    .map((id) => settings.get(id))
    .filter((item): item is PluginConfig => item !== undefined && item.disabled !== true)
}
