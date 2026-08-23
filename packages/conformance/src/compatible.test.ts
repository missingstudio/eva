import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { boot, buildOf, type Kernel } from "@missingstudio/eva-boot"
import { auth } from "@missingstudio/eva-auth"
import { catalogModels } from "@missingstudio/eva-catalog-models"
import { catalogPrices } from "@missingstudio/eva-catalog-prices"
import type { ModelResolution } from "@missingstudio/eva-core"
import { costLine } from "@missingstudio/eva-print"
import { providerCompatible } from "@missingstudio/eva-provider-compatible"
import { costFold, eventID, runID, sessionID, type Event } from "@missingstudio/eva-schema"
import { priceLookup } from "@missingstudio/eva-sdk"
import type { Plugin } from "@missingstudio/eva-sdk"
import { Effect, Exit, Scope } from "effect"
import { describe, expect, it } from "vitest"

interface Loaded {
  readonly plugin: Plugin
  readonly options?: Record<string, unknown>
}

// A live kernel over the named plugins, in the order a build registers them.
const withKernel = <A>(
  loaded: readonly Loaded[],
  body: (kernel: Kernel) => Effect.Effect<A>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const kernel = yield* boot({
        scope,
        resolved: loaded.map((one) => ({
          id: one.plugin.id,
          ...(one.options === undefined ? {} : { options: one.options }),
        })),
        build: buildOf(loaded.map((one) => one.plugin)),
      })
      const result = yield* body(kernel)
      yield* Scope.close(scope, Exit.void)
      return result
    }),
  )

/**
 * `eva.provider.compatible` + `eva.catalog.prices`: two plugins that only
 * meet in a build. A compatible namespace has no Price, so the estimate
 * folds to null and the cost line says so in words — a partial figure over
 * counters the endpoint really reported would be the quiet lie.
 */
describe("a compatible namespace and the prices", () => {
  const OPTIONS = {
    providers: { ollama: { api: "http://localhost:11434/v1", models: ["qwen3-coder"] } },
  }

  it("prices nothing, folds a null estimate, and prints cost unreported", async () => {
    const summary = await withKernel(
      [
        { plugin: catalogModels },
        { plugin: catalogPrices },
        { plugin: providerCompatible, options: OPTIONS },
      ],
      (kernel) =>
        Effect.gen(function* () {
          const prices = priceLookup(yield* kernel.domains.catalog.get)
          expect(prices("ollama/qwen3-coder")).toBeUndefined()

          const usage: Event = {
            id: eventID("evt_1"),
            seq: 1,
            at: { wall: "2026-08-23T09:00:00Z" },
            run: runID("run_1"),
            session: sessionID("sess_1"),
            parent: null,
            payload: {
              kind: "usage",
              model: "ollama/qwen3-coder",
              inputTokens: 2006,
              outputTokens: 450,
              cacheWriteTokens: null,
              cacheReadTokens: 1920,
            },
          }
          return costFold([usage], prices)
        }),
    )

    expect(summary.estimatedCostTicks).toBeNull()
    expect(summary.costTicks).toBeNull()
    expect(costLine(summary)).toContain("cost unreported")
  })
})

/**
 * `eva.provider.compatible` + `eva.auth`: an entry with `credential: true`
 * and a declared `env` mapping meet in the `CredentialStore`. Without the
 * mapping, `ENV_KEYS` cannot see a run-time-named provider however the
 * variable is exported, and `eva auth status` is blind to it.
 */
describe("a compatible entry and the auth store", () => {
  const loaded: readonly Loaded[] = [
    {
      plugin: auth,
      options: {
        authStore: join(mkdtempSync(join(tmpdir(), "eva-conformance-")), "auth.json"),
        env: { vllm: "VLLM_API_KEY" },
      },
    },
    {
      plugin: providerCompatible,
      options: { providers: { vllm: { api: "http://localhost:8000/v1", credential: true } } },
    },
  ]

  // `eva.auth` reads the process environment, so the variable is exported
  // for the body and removed after it.
  const withVllmKey = <A>(body: () => Promise<A>): Promise<A> => {
    process.env["VLLM_API_KEY"] = "sk-vllm-test"
    return body().finally(() => {
      delete process.env["VLLM_API_KEY"]
    })
  }

  it("reaches the credential through the store, so the provider is available", async () => {
    const found = await withVllmKey(() =>
      withKernel(loaded, (kernel) =>
        Effect.gen(function* () {
          let resolution: ModelResolution | undefined
          yield* kernel.hooks.run("model.resolve", {
            reference: { provider: "vllm", model: "qwen3-coder" },
            resolve: (one) => {
              resolution = one
            },
          })
          return resolution
        }),
      ),
    )

    expect(found?.provider.id).toBe("eva.provider.compatible:vllm")
    expect(found?.provider.available()).toBe(true)
  })

  it("lists the entry, so eva auth status sees it", async () => {
    const refs = await withVllmKey(() =>
      withKernel(loaded, (kernel) =>
        Effect.gen(function* () {
          const store = yield* kernel.slot.credentialStore.get
          return yield* store.list
        }),
      ),
    )

    expect(refs).toContainEqual({ id: "vllm", mode: "api_key" })
  })
})
