import type {
  Budget,
  CredentialStore,
  DiffApplier,
  Domain,
  DomainMiss,
  FileSystem,
  HookFailure,
  Recorder,
  Sandbox,
  SessionStore,
  Shell,
  TraceSink,
  Validator,
} from "@missingstudio/eva-core"
import {
  batch,
  makeBroadcast,
  makeDomain,
  makeHooks,
  makePluginRuntime,
  makeRowDomain,
  makeSlot,
  type HookRegistry,
  type PluginConfig,
  type PluginRuntime,
} from "@missingstudio/eva-kernel"
import type { Broadcast } from "@missingstudio/eva-core"
import {
  priceLookup,
  PROVIDER_BOUNDARIES,
  TOOL_BOUNDARIES,
  type BroadcastMap,
  type CatalogDraft,
  type CatalogState,
  type Domains,
  type Plugin,
  type PluginContext,
  type ProviderHooks,
  type ProviderHookSpec,
  type RowDomainName,
  type RowInfos,
  type Slots,
  type ToolHooks,
  type ToolHookSpec,
} from "@missingstudio/eva-sdk"
import type { PriceLookup } from "@missingstudio/eva-schema"
import { Effect, type Scope } from "effect"

// The catalog is hand-built, because it is the one domain that is not rows.
// Every other domain is `makeRowDomain`, which the kernel owns.
const catalogDomain = (
  publish: (count: number, missed: readonly DomainMiss[]) => Effect.Effect<void>,
) =>
  makeDomain<CatalogState, CatalogDraft>({
    name: "catalog",
    initial: () => ({ providers: new Map(), models: new Map() }),
    // The catalog's `update`s mint what they do not find — the seed is the
    // row — so an edit always reaches and there is nothing to miss here.
    draft: (state) => ({
      provider: {
        list: () => [...state.providers.values()],
        get: (id) => state.providers.get(id),
        update: (id, update) => {
          const found = state.providers.get(id) ?? { id, name: id }
          update(found)
          state.providers.set(id, found)
        },
        remove: (id) => void state.providers.delete(id),
      },
      model: {
        get: (providerID, modelID) => state.models.get(providerID)?.get(modelID),
        update: (providerID, modelID, update) => {
          const models = state.models.get(providerID) ?? new Map()
          const found = models.get(modelID) ?? { id: modelID, name: modelID }
          update(found)
          models.set(modelID, found)
          state.models.set(providerID, models)
        },
        remove: (providerID, modelID) => void state.models.get(providerID)?.delete(modelID),
        default: {
          get: () => state.default,
          set: (model) => void (state.default = model),
        },
      },
    }),
    onCommit: (state, missed) => publish(state.providers.size, missed),
  })

export interface Kernel {
  readonly runtime: PluginRuntime<PluginContext>
  readonly slot: Slots
  readonly broadcast: Broadcast<BroadcastMap>
  readonly hooks: HookRegistry<ProviderHookSpec>
  // The tool boundaries. A second registry rather than a wider spec, because
  // a boundary map belongs to one spec and one caller.
  readonly toolHooks: HookRegistry<ToolHookSpec>
  readonly domains: Domains
  // The Catalog's rates, derived once. The same read a plugin gets.
  readonly prices: Effect.Effect<PriceLookup>
  // The resolved ids this build carries no implementation for. Config may
  // name a plugin nobody has, and a run says which rather than passing over
  // it, because a plugin that never loaded looks exactly like one that did
  // nothing.
  readonly missing: readonly string[]
}

/**
 * The implementations a build carries, which is what separates one
 * composition root from another.
 *
 * It is one object rather than a bare list because the same question — does
 * this build carry that id? — is asked twice: once before boot, to report a
 * config that names a plugin nobody has, and once inside boot, to decide what
 * loads. Asked of two derivations it can get two answers, and then the run
 * and the report disagree about which plugins there were.
 */
export interface Build {
  readonly all: readonly Plugin[]
  // The implementation for an id, or nothing when this build carries none.
  readonly carries: (id: string) => Plugin | undefined
}

// Indexes a build's table once. The composition root owns the table itself;
// this only decides how it is asked.
export const buildOf = (all: readonly Plugin[]): Build => {
  const byID = new Map(all.map((plugin) => [plugin.id, plugin]))
  return { all, carries: (id) => byID.get(id) }
}

// A build that carries nothing: every resolved id comes back missing.
export const CARRIES_NOTHING: Build = buildOf([])

export interface BootOptions {
  readonly scope: Scope.Scope
  readonly resolved: readonly PluginConfig[]
  /**
   * What this build carries. Boot loads the resolved entries it holds and
   * names the rest in `missing`, through the one predicate the composition
   * root reports from.
   */
  readonly build?: Build
  readonly config?: Record<string, unknown>
  /**
   * Runs after the kernel is assembled and before anything loads. A
   * Broadcast has no replay, so a caller that wants to see boot's own
   * commits — a domain's misses, a slot's fills — subscribes here.
   */
  readonly observe?: (kernel: Kernel) => Effect.Effect<void>
}

/**
 * Assembles the kernel and loads what the config resolved to, in one call.
 * Loading used to sit in the composition root, so every caller repeated the
 * batch rule and the lookup, and each of them repeated it differently.
 *
 * A caller that wants a bare kernel resolves to nothing; one that hot-swaps
 * a plugin later still reaches `runtime.add`.
 */
export const boot = Effect.fn("boot")(function* (options: BootOptions): Effect.fn.Return<Kernel> {
  // An `.updated` payload is a snapshot — a count and the current misses —
  // so a lagging subscriber that reads only the latest commit has lost
  // nothing. Every other topic is an event a consumer counts, and stays
  // unbounded.
  const broadcast = yield* makeBroadcast<BroadcastMap>((type) =>
    String(type).endsWith(".updated") ? 1 : undefined,
  )

  // One rule for every Slot, so a surface watching the traffic sees every
  // swap rather than the two that were wired by hand.
  const slotOf = <Filling>(name: string) =>
    makeSlot<Filling>(name, {
      filled: (slot, by, evicted) =>
        broadcast.publish("slot.filled", {
          slot,
          by,
          ...(evicted === undefined ? {} : { evicted }),
        }),
      emptied: (slot) => broadcast.publish("slot.emptied", { slot }),
    })

  const slot = {
    recorder: yield* slotOf<Recorder>("Recorder"),
    traceSink: yield* slotOf<TraceSink>("TraceSink"),
    sessionStore: yield* slotOf<SessionStore>("SessionStore"),
    credentialStore: yield* slotOf<CredentialStore>("CredentialStore"),
    budget: yield* slotOf<Budget>("Budget"),
    validator: yield* slotOf<Validator>("Validator"),
    fileSystem: yield* slotOf<FileSystem>("FileSystem"),
    shell: yield* slotOf<Shell>("Shell"),
    sandbox: yield* slotOf<Sandbox>("Sandbox"),
    diffApplier: yield* slotOf<DiffApplier>("DiffApplier"),
  }

  // The topic is derived from the name, so a domain cannot be wired up with
  // the wrong one or with none.
  const rowsOf = <Name extends RowDomainName>(name: Name) =>
    makeRowDomain<RowInfos[Name]>(name, (count, missed) =>
      broadcast.publish(`${name}.updated`, { count, missed }),
    )

  /**
   * Every domain the kernel holds. `satisfies Domains` ties this to the SDK's
   * table: a domain the SDK declares and this object misses is a compile
   * error, the same way `ProviderHooks` holds the hook map to its spec.
   */
  const domains = {
    catalog: yield* catalogDomain((count, missed) =>
      broadcast.publish("catalog.updated", { count, missed }),
    ),
    command: yield* rowsOf("command"),
    theme: yield* rowsOf("theme"),
    keymap: yield* rowsOf("keymap"),
    agent: yield* rowsOf("agent"),
    prompt: yield* rowsOf("prompt"),
    harness: yield* rowsOf("harness"),
    surface: yield* rowsOf("surface"),
    integration: yield* rowsOf("integration"),
    tool: yield* rowsOf("tool"),
  } satisfies Domains

  // Derived once, beside the Catalog it folds. Read at the point of use, so
  // a Catalog rebuild moves the next estimate.
  const prices = Effect.map(domains.catalog.get, priceLookup)

  /**
   * The boundaries come from the SDK beside the spec, so this build cannot
   * soften one. An observing hook that threw is reported as the failure of
   * the plugin that registered it, because that is what it is.
   */
  const reportFailure = {
    failed: (failure: HookFailure) =>
      broadcast.publish("plugin.failed", {
        id: failure.owner,
        cause: failure.cause,
        hook: failure.hook,
      }),
  }
  const hooks = yield* makeHooks<ProviderHookSpec>(PROVIDER_BOUNDARIES, reportFailure)
  const toolHooks = yield* makeHooks<ToolHookSpec>(TOOL_BOUNDARIES, reportFailure)
  const optionsFor = new Map(options.resolved.map((entry) => [entry.id, entry.options ?? {}]))

  // Each entry is checked against the spec, so a hook the SDK declares and
  // this map misses is a compile error. The owner is stamped here the way a
  // domain's transform stamps it: a plugin never names its own id.
  const providerFor = (owner: string): ProviderHooks => ({
    "model.resolve": (callback) => hooks.on("model.resolve", callback, owner),
    "provider.request.before": (callback) => hooks.on("provider.request.before", callback, owner),
    "provider.response.after": (callback) => hooks.on("provider.response.after", callback, owner),
    "provider.retry": (callback) => hooks.on("provider.retry", callback, owner),
  })

  const toolHooksFor = (owner: string): ToolHooks => ({
    "tool.resolve": (callback) => toolHooks.on("tool.resolve", callback, owner),
    "tool.execute.before": (callback) => toolHooks.on("tool.execute.before", callback, owner),
    "tool.execute.after": (callback) => toolHooks.on("tool.execute.after", callback, owner),
  })

  const runtime: PluginRuntime<PluginContext> = yield* makePluginRuntime<PluginContext>(
    options.scope,
    (id) => context(id),
    {
      added: (id) => broadcast.publish("plugin.added", { id }),
      removed: (id) => broadcast.publish("plugin.removed", { id }),
      failed: (id, cause) => broadcast.publish("plugin.failed", { id, cause }),
    },
  )

  // A domain handed to a plugin stamps the plugin's own id on every
  // transform, so a miss can say which plugin reached for the row.
  const withOwner = <State, Draft>(domain: Domain<State, Draft>, owner: string) =>
    ({
      ...domain,
      transform: (callback, explicit) => domain.transform(callback, explicit ?? owner),
    }) satisfies Domain<State, Draft>

  function context(id: string): PluginContext {
    return {
      id,
      options: optionsFor.get(id) ?? {},
      catalog: withOwner(domains.catalog, id),
      command: withOwner(domains.command, id),
      theme: withOwner(domains.theme, id),
      keymap: withOwner(domains.keymap, id),
      agent: withOwner(domains.agent, id),
      prompt: withOwner(domains.prompt, id),
      harness: withOwner(domains.harness, id),
      surface: withOwner(domains.surface, id),
      integration: withOwner(domains.integration, id),
      tool: withOwner(domains.tool, id),
      slot,
      provider: providerFor(id),
      toolHooks: toolHooksFor(id),
      broadcast,
      prices,
      config: Effect.succeed(options.config ?? {}),
      plugin: {
        add: (plugin) => runtime.add(plugin),
        remove: (pluginID) => runtime.remove(pluginID),
        list: runtime.list,
      },
    }
  }

  const build = options.build ?? CARRIES_NOTHING

  const kernel: Kernel = {
    runtime,
    slot,
    broadcast,
    hooks,
    toolHooks,
    domains,
    prices,
    // The same predicate the report asked before booting, so a run and the
    // findings printed above it cannot name different plugins.
    missing: options.resolved
      .filter((entry) => build.carries(entry.id) === undefined)
      .map((entry) => entry.id),
  }

  // Assembled but not yet loaded: the seam where a subscriber still sees
  // everything the batch below will publish.
  if (options.observe !== undefined) yield* options.observe(kernel)

  // One batch, so each domain rebuilds once at the end rather than once per
  // transform. The rule lives here because this is the only place that loads.
  yield* batch(
    Effect.forEach(
      options.resolved,
      (entry) => {
        const plugin = build.carries(entry.id)
        return plugin === undefined ? Effect.void : runtime.add(plugin)
      },
      { discard: true },
    ),
  )

  return kernel
})
