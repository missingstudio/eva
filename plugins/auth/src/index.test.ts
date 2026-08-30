import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CredentialMode, CredentialStore } from "@missingstudio/eva-core"
import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { auth, ENV_KEYS, makeCredentialStore } from "./index.js"
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
    expect(ENV_KEYS).toEqual({ anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" })
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
    const store = await Effect.runPromise(build({ MISTRAL_API_KEY: "sk" }, "api_key"))
    expect(await Effect.runPromise(store.get("mistral"))).toBeUndefined()
  })

  // The secret is behind an Effect, so serialization reaches the mode only.
  it("keeps the secret out of the serialized credential", async () => {
    const store = await Effect.runPromise(build({ ANTHROPIC_API_KEY: "sk" }, "api_key"))
    const found = await Effect.runPromise(store.get("anthropic"))
    expect(JSON.parse(JSON.stringify(found))).toEqual({ mode: "api_key" })
  })

  // `ENV_KEYS` is static and which providers there are is known when this
  // runs: a declared mapping merges over it, so an endpoint named at run
  // time reaches the environment too.
  it("answers for a run-time-named provider the keys mapping carries", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const durable = yield* makeFileStore({ path: temp() })
        const store = yield* makeCredentialStore({
          env: { VLLM_API_KEY: "sk-vllm" },
          mode: () => "api_key",
          keys: { ...ENV_KEYS, vllm: "VLLM_API_KEY" },
          durable,
        })
        return yield* secretOf(store, "vllm")
      }),
    )
    expect(found).toBe("sk-vllm")
  })

  // `eva auth status` reads `store.list`, so a provider the mapping names is
  // seen there too.
  it("lists a run-time-named provider the keys mapping carries", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const durable = yield* makeFileStore({ path: temp() })
        const store = yield* makeCredentialStore({
          env: { VLLM_API_KEY: "sk-vllm" },
          mode: () => "api_key",
          keys: { ...ENV_KEYS, vllm: "VLLM_API_KEY" },
          durable,
        })
        return yield* store.list
      }),
    )
    expect(found).toEqual([{ id: "vllm", mode: "api_key" }])
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

/**
 * The effect body, over the same boot a run uses. The four lines that build
 * `keys` from the declared `env` mapping, and the integration projection
 * `eva auth status` reads, run only inside the effect — a bug there used to
 * fail far from home, in a conformance suite about a different plugin.
 */
describe("the effect body over a real kernel", () => {
  // `eva.auth` reads the process environment, so the variable is exported
  // for the body and removed after it.
  const withVllmKey = <A>(body: () => Promise<A>): Promise<A> => {
    process.env["VLLM_API_KEY"] = "sk-vllm-test"
    return body().finally(() => {
      delete process.env["VLLM_API_KEY"]
    })
  }

  const options = (env: Record<string, unknown>) => ({
    options: { authStore: temp(), env },
  })

  it("merges the declared env mapping over ENV_KEYS", async () => {
    const found = await withVllmKey(() =>
      withPlugin(
        auth,
        (kernel) =>
          Effect.gen(function* () {
            const store = yield* kernel.slot.credentialStore.get
            return yield* Effect.orDie(secretOf(store, "vllm"))
          }),
        options({ vllm: "VLLM_API_KEY" }),
      ),
    )

    expect(found).toBe("sk-vllm-test")
  })

  // A value that is not a string names no variable, so the entry changes
  // nothing rather than shadowing a static key with garbage.
  it("keeps an env entry that names no string out of the merge", async () => {
    const found = await withVllmKey(() =>
      withPlugin(
        auth,
        (kernel) =>
          Effect.gen(function* () {
            const store = yield* kernel.slot.credentialStore.get
            return yield* store.get("vllm")
          }),
        options({ vllm: 42 }),
      ),
    )

    expect(found).toBeUndefined()
  })

  // The integration domain is the one source `eva auth status` reads.
  it("projects a connected integration row for the run-time-named provider", async () => {
    const rows = await withVllmKey(() =>
      withPlugin(
        auth,
        (kernel) => kernel.domains.integration.get,
        options({ vllm: "VLLM_API_KEY" }),
      ),
    )

    expect(rows).toContainEqual({
      id: "vllm.api_key",
      provider: "vllm",
      mode: "api_key",
      connected: true,
      variable: "VLLM_API_KEY",
    })
  })

  /**
   * The row carries the variable it reads, from the merged map rather than
   * from `ENV_KEYS`. A surface tells a person what to export, and a provider
   * named in config has a variable no static table holds.
   */
  it("projects the row as not connected, and names the variable it reads", async () => {
    const rows = await withPlugin(
      auth,
      (kernel) => kernel.domains.integration.get,
      options({ vllm: "VLLM_API_KEY" }),
    )

    expect(rows).toContainEqual({
      id: "vllm.api_key",
      provider: "vllm",
      mode: "api_key",
      connected: false,
      variable: "VLLM_API_KEY",
    })
  })
})
