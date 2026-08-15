import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CredentialMode, CredentialStore } from "@missingstudio/eva-core"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { ENV_KEYS, makeCredentialStore } from "./index.js"
import { makeFileStore } from "./store.js"

const temp = () => join(mkdtempSync(join(tmpdir(), "eva-auth-")), "auth.json")

const build = (env: NodeJS.ProcessEnv, mode: CredentialMode, path = temp()) =>
  Effect.gen(function* () {
    const durable = yield* makeFileStore({ path })
    return yield* makeCredentialStore({ env, mode: () => mode, durable })
  })

const secretOf = (store: CredentialStore, id: string) =>
  Effect.flatMap(store.get(id), (found) =>
    found === undefined ? Effect.succeed(undefined) : found.secret(),
  )

describe("ENV_KEYS", () => {
  it("names one environment variable per provider", () => {
    expect(ENV_KEYS).toEqual({ anthropic: "ANTHROPIC_API_KEY" })
  })
})

describe("the configured mode alone decides", () => {
  it("reads the environment under api_key", async () => {
    const found = await Effect.runPromise(
      Effect.flatMap(build({ ANTHROPIC_API_KEY: "sk-from-env" }, "api_key"), (store) =>
        secretOf(store, "anthropic"),
      ),
    )
    expect(found).toBe("sk-from-env")
  })

  // The failure a precedence chain produces is a stale exported key winning
  // over the login somebody just completed, billing an account nobody chose.
  it("ignores an exported key under oauth", async () => {
    const path = temp()
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* build({ ANTHROPIC_API_KEY: "sk-from-env" }, "oauth", path)
        yield* store.set("anthropic", { mode: "oauth", access: "tok-from-login" })
        return yield* secretOf(store, "anthropic")
      }),
    )
    expect(found).toBe("tok-from-login")
  })

  it("ignores a stored login under api_key", async () => {
    const path = temp()
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const durable = yield* makeFileStore({ path })
        yield* durable.set("anthropic", { mode: "oauth", access: "tok-from-login" })
        const store = yield* makeCredentialStore({
          env: { ANTHROPIC_API_KEY: "sk-from-env" },
          mode: () => "api_key",
          durable,
        })
        return yield* secretOf(store, "anthropic")
      }),
    )
    expect(found).toBe("sk-from-env")
  })

  it.each([
    ["the variable is unset", {}],
    ["the variable is empty", { ANTHROPIC_API_KEY: "" }],
  ])("finds nothing under api_key when %s", async (_which, env) => {
    const store = await Effect.runPromise(build(env, "api_key"))
    expect(await Effect.runPromise(store.get("anthropic"))).toBeUndefined()
  })

  it("finds nothing for a provider ENV_KEYS does not name", async () => {
    const store = await Effect.runPromise(build({ OPENAI_API_KEY: "sk" }, "api_key"))
    expect(await Effect.runPromise(store.get("openai"))).toBeUndefined()
  })

  // The secret is behind an Effect, so serialization reaches the mode only.
  it("keeps the secret out of the serialized credential", async () => {
    const store = await Effect.runPromise(build({ ANTHROPIC_API_KEY: "sk" }, "api_key"))
    const found = await Effect.runPromise(store.get("anthropic"))
    expect(JSON.parse(JSON.stringify(found))).toEqual({ mode: "api_key" })
  })

  it("lists only what the chosen mode can answer with", async () => {
    const path = temp()
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const durable = yield* makeFileStore({ path })
        yield* durable.set("anthropic", { mode: "oauth", access: "tok" })
        const store = yield* makeCredentialStore({
          env: { ANTHROPIC_API_KEY: "sk" },
          mode: () => "api_key",
          durable,
        })
        return yield* store.list
      }),
    )
    expect(found).toEqual([{ id: "anthropic", mode: "api_key" }])
  })
})
