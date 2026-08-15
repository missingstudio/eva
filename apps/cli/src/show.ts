import { isMapping, leaves } from "@missingstudio/eva-kernel"
import type { ResolvedConfig } from "./run.js"

const CELL = 44

const at = (raw: Record<string, unknown>, path: string): unknown =>
  path.split(".").reduce<unknown>((found, key) => (isMapping(found) ? found[key] : undefined), raw)

// One line per value, so a prompt of ten paragraphs stays one row.
const shown = (value: unknown): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  const line = (text ?? String(value)).replaceAll(/\s+/g, " ").trim()
  return line.length > CELL ? `${line.slice(0, CELL - 1)}…` : line
}

const pad = (text: string, width: number): string => text.padEnd(width)

/**
 * What a run would use, and where each key came from. It answers before the
 * kernel boots, so a config that names a plugin nobody has still prints.
 *
 * `plugins` is left out of the key list because the resolved list below it
 * is the answer — the raw list is what was asked for, not what loads.
 */
export const showConfig = (settled: ResolvedConfig): string => {
  const { config, location, model, plugins } = settled
  const keys = [...leaves(config.raw)].filter((key) => key !== "plugins").sort()
  const width = Math.max(0, ...keys.map((key) => key.length))
  const values = Math.max(0, ...keys.map((key) => shown(at(config.raw, key)).length))

  const lines = [
    `directory  ${location.directory}${location.trusted ? "" : "  (not trusted)"}`,
    `model      ${model.provider}/${model.model}`,
    "",
  ]

  if (keys.length === 0) {
    lines.push("config     nothing set")
  } else {
    lines.push("config")
    for (const key of keys) {
      const from = config.origin[key] ?? "unknown"
      lines.push(`  ${pad(key, width)}  ${pad(shown(at(config.raw, key)), values)}  ${from}`)
    }
  }

  lines.push("", `plugins    ${plugins.length} loaded`)
  const ids = Math.max(0, ...plugins.map((one) => one.id.length))
  for (const plugin of plugins) {
    const options = plugin.options
    lines.push(
      options === undefined ? `  ${plugin.id}` : `  ${pad(plugin.id, ids)}  ${shown(options)}`,
    )
  }

  for (const path of location.ignored) {
    lines.push("", `not read   ${path}`)
  }

  return `${lines.join("\n")}\n`
}
