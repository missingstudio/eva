import { homedir } from "node:os"
import {
  apiKeyVariable,
  CredentialError,
  type Credential,
  type CredentialMode,
  type CredentialRef,
  type CredentialStore,
} from "@missingstudio/eva-core"
import { declare, define, readShape, stringOption } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { defaultStorePath, makeFileStore } from "./store.js"

// `env` maps a Namespace — the Credential id — to its environment variable
// name, merged over `ENV_KEYS`: which providers there are is known when this
// runs, not when it is written, and an endpoint named in config has no
// static row.
const OPTIONS = declare({ authStore: "string", env: "mapping" })

export * from "./store.js"

/**
 * One environment variable per provider, read only under `api_key` mode. The
 * spelling is `eva-core`'s rule rather than a second table, so the refusal a
 * Run reports and the variable this store reads cannot drift apart.
 */
export const ENV_KEYS: Readonly<Record<string, string>> = {
  anthropic: apiKeyVariable("anthropic"),
  openai: apiKeyVariable("openai"),
}

/**
 * Which providers may hold an oauth login. Anthropic is absent by decision,
 * not omission: its consumer-subscription OAuth client belongs to Claude
 * Code and is not offered to third-party tools, so driving it would mean
 * impersonating that client at the risk of the user's own account.
 */
export const OAUTH_PROVIDERS: readonly string[] = []

/**
 * Which way a provider authenticates. The key carries the provider's own id,
 * and which providers there are is known when this runs rather than when it
 * is written, so it is read by name rather than through a declaration.
 */
export const modeOf = (options: Record<string, unknown>, id: string): CredentialMode => {
  const found = stringOption(options, `${id}.auth`, "api_key")
  return found === "oauth" ? "oauth" : "api_key"
}

const fromEnv = (
  id: string,
  env: NodeJS.ProcessEnv,
  keys: Readonly<Record<string, string>>,
): Credential | undefined => {
  const variable = keys[id]
  if (variable === undefined) return undefined
  const found = env[variable]
  if (found === undefined || found === "") return undefined
  return { mode: "api_key", secret: () => Effect.succeed(found) }
}

export interface StoreOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly mode?: (id: string) => CredentialMode
  // One environment variable per provider. Defaults to `ENV_KEYS`.
  readonly keys?: Readonly<Record<string, string>>
  readonly durable: CredentialStore
}

/**
 * The two modes behind one store. The configured mode alone decides which
 * one answers: under `api_key` the environment is read and a stored login is
 * ignored, and under `oauth` the login is read and an exported key is
 * ignored. There is no precedence chain, because the failure a chain
 * produces is a stale exported key silently outranking the login somebody
 * just completed, billing an account they did not choose.
 */
export const makeCredentialStore = (options: StoreOptions): Effect.Effect<CredentialStore> =>
  Effect.sync(() => {
    const env = options.env ?? process.env
    const mode = options.mode ?? (() => "api_key" as CredentialMode)
    const keys = options.keys ?? ENV_KEYS

    return {
      get: (id) =>
        mode(id) === "oauth" ? options.durable.get(id) : Effect.sync(() => fromEnv(id, env, keys)),

      set: options.durable.set,
      remove: options.durable.remove,

      list: Effect.map(options.durable.list, (stored) => {
        const found: CredentialRef[] = []
        for (const id of Object.keys(keys)) {
          if (mode(id) === "api_key" && fromEnv(id, env, keys) !== undefined) {
            found.push({ id, mode: "api_key" })
          }
        }
        for (const ref of stored) {
          if (mode(ref.id) === "oauth") found.push(ref)
        }
        return found
      }),
    }
  })

export const auth = define({
  id: "eva.auth",
  takes: OPTIONS.shapes,
  effect: Effect.fn("eva.auth")(function* (ctx) {
    const path = OPTIONS.read(ctx.options, "authStore", defaultStorePath(homedir()))
    const durable = yield* makeFileStore({ path })
    const mode = (id: string) => modeOf(ctx.options, id)
    // Inside the declared mapping the keys are the person's own, read one
    // level down through the same reader. A value that is not a string names
    // no variable, so the entry changes nothing.
    const keys = { ...ENV_KEYS }
    for (const [id, variable] of Object.entries(OPTIONS.read(ctx.options, "env", {}))) {
      const name = readShape(variable, "string")
      if (name !== undefined) keys[id] = name
    }
    const store = yield* makeCredentialStore({ durable, mode, keys })

    yield* ctx.slot.credentialStore.provide(ctx.id, store)

    /**
     * The integration domain projects how each provider would authenticate
     * and whether that way is live, so `eva auth status` reads one source.
     *
     * An `api_key` row carries the variable it reads, from the merged map: a
     * provider named in config has a variable no static table holds, and a
     * surface that told a person to export the wrong one would be worse than
     * one that said nothing.
     */
    const connected = yield* store.list
    yield* ctx.integration.transform((draft) => {
      const ids = new Set([...Object.keys(keys), ...OAUTH_PROVIDERS])
      for (const id of ids) {
        const chosen = mode(id)
        const ref = connected.find((one) => one.id === id)
        const variable = keys[id]
        draft.set({
          id: `${id}.${chosen}`,
          provider: id,
          mode: chosen,
          connected: ref !== undefined && ref.expired !== true,
          ...(chosen === "api_key" && variable !== undefined ? { variable } : {}),
        })
      }
    })
  }),
})

export { CredentialError }
