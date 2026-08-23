import type { Credential } from "@missingstudio/eva-core"
import { readShape } from "@missingstudio/eva-sdk"
import { PLUGIN_ID, type CompatibleOptions } from "./provider.js"

/**
 * One configured endpoint, read. The key is the Catalog namespace and the
 * Credential id: `ollama` in `ollama/qwen3-coder`.
 */
export interface CompatibleEntry {
  readonly namespace: string
  // The Catalog row's display name. Defaults to the mapping key.
  readonly name: string
  /**
   * The base URL a curl would take, including whatever version segment the
   * server serves at. Nothing is appended.
   */
  readonly api: string
  /**
   * Whether this endpoint needs a Credential. False means it needs none, so
   * `available()` answers true and no Authorization header is sent. True
   * means the store is asked for a Credential named like the entry.
   */
  readonly credential: boolean
  // Model ids to write into the Catalog, so `/model` can list them. Empty
  // means none are listed; a typed reference still runs.
  readonly models: readonly string[]
  // Omitted from the request when absent. The server's own default is better
  // than one Eva invented.
  readonly maxTokens?: number
  /**
   * Whether to ask for usage counters. Default true, because vLLM, Ollama and
   * LM Studio all report them and throwing them away loses the Budget's
   * input. False for a server that refuses the field, which then reports one
   * usage payload with every counter null. Degrade, never fail.
   */
  readonly usage: boolean
}

/**
 * The raw `providers` mapping into entries, one per namespace. An entry
 * without `api` is not an endpoint: it claims no namespace and writes no
 * rows. Inside a declared mapping the keys are the person's own, read one
 * level down through the same reader the declaration uses.
 */
export const readEntries = (providers: Record<string, unknown>): readonly CompatibleEntry[] =>
  Object.entries(providers).flatMap(([namespace, value]) => {
    const row = readShape(value, "mapping")
    if (row === undefined) return []
    const api = readShape(row["api"], "string")
    if (api === undefined) return []

    const models = (readShape(row["models"], "list") ?? []).flatMap((one) => {
      const id = readShape(one, "string")
      return id === undefined ? [] : [id]
    })
    const maxTokens = readShape(row["maxTokens"], "number")

    return [
      {
        namespace,
        name: readShape(row["name"], "string") ?? namespace,
        api,
        credential: readShape(row["credential"], "boolean") ?? false,
        models,
        ...(maxTokens === undefined ? {} : { maxTokens }),
        usage: readShape(row["usage"], "boolean") ?? true,
      },
    ]
  })

/**
 * The whole decision for one endpoint, Credential state included: what the
 * Provider is handed, as a value a plain test can assert. The tri-state is
 * the part that can actually be wrong — a keyless endpoint carries no
 * credential and stays available, an entry that asked and was answered
 * carries the Credential, and an entry that asked and got nothing carries
 * `false` so the Run closes auth_failed before the wire. `found` is read
 * only when the entry asked, so a stray store answer cannot turn a keyless
 * endpoint into a keyed one.
 */
export const endpointOf = (
  entry: CompatibleEntry,
  found: Credential | undefined,
): CompatibleOptions => ({
  id: `${PLUGIN_ID}:${entry.namespace}`,
  namespace: entry.namespace,
  api: entry.api,
  ...(entry.credential ? { credential: found ?? false } : {}),
  ...(entry.maxTokens === undefined ? {} : { maxTokens: entry.maxTokens }),
  ...(entry.usage ? {} : { usage: false }),
})
