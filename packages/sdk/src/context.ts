import type {
  Broadcast,
  Budget,
  CredentialStore,
  DiffApplier,
  DomainMiss,
  FileSystem,
  Hooks,
  Recorder,
  Sandbox,
  SessionStore,
  Shell,
  Slot,
  TraceSink,
  Validator,
} from "@missingstudio/eva-core"
import type { PriceLookup } from "@missingstudio/eva-schema"
import type { Effect } from "effect"
import type { Domains } from "./domains.js"
import type { Plugin } from "./plugin.js"
import type { ProviderHookSpec } from "./hooks.js"

/**
 * Every domain says when it commits. The topics are derived from the domain
 * table, so a domain cannot arrive without one — which is how three of five
 * Slots once ended up publishing nothing.
 */
export type DomainUpdated = {
  readonly [Name in keyof Domains as `${Name}.updated`]: {
    readonly count: number
    // The edits that reached no row this rebuild, each naming the id it
    // reached for and the plugin whose transform reached.
    readonly missed: readonly DomainMiss[]
  }
}

export interface BroadcastMap extends DomainUpdated {
  "plugin.added": { readonly id: string }
  "plugin.removed": { readonly id: string }
  // `hook` names the boundary when an observing hook of a loaded plugin
  // threw, and is absent when the plugin's own load died.
  "plugin.failed": { readonly id: string; readonly cause: unknown; readonly hook?: string }
  "config.changed": { readonly path: string }
  "session.started": { readonly session: string }
  "run.opened": { readonly run: string; readonly session: string }
  "run.finished": { readonly run: string; readonly session: string }
  // `evicted` names a live holder with a different id this fill displaced.
  "slot.filled": { readonly slot: string; readonly by: string; readonly evicted?: string }
  "slot.emptied": { readonly slot: string }
}

// Every slot the SDK declares. Adding one is a reviewed SDK change.
export interface Slots {
  readonly recorder: Slot<Recorder>
  readonly traceSink: Slot<TraceSink>
  readonly sessionStore: Slot<SessionStore>
  readonly credentialStore: Slot<CredentialStore>
  readonly budget: Slot<Budget>
  readonly validator: Slot<Validator>
  readonly fileSystem: Slot<FileSystem>
  readonly shell: Slot<Shell>
  readonly sandbox: Slot<Sandbox>
  readonly diffApplier: Slot<DiffApplier>
}

export type ProviderHooks = Hooks<ProviderHookSpec>

/**
 * Everything a plugin may touch. A plugin reaches the kernel no other way,
 * so adding an extension point is a change to this file and a reviewed one.
 */
export interface PluginContext extends Domains {
  readonly id: string
  readonly options: Record<string, unknown>

  readonly slot: Slots
  readonly provider: ProviderHooks
  readonly broadcast: Broadcast<BroadcastMap>

  // The kernel reads config; interpreting it is `eva.config`'s job. There is
  // no `model` beside this: the Catalog holds the default, and a second copy
  // here answered from before the Catalog had loaded.
  readonly config: Effect.Effect<Record<string, unknown>>

  /**
   * The Catalog's rates, as an Estimate reads them. It is derived here rather
   * than at each caller, because the rule a lookup carries — that a dated
   * model id falls back to the undated one — is one rule, and three callers
   * each spelling `priceLookup(catalog.get)` were three places to get it
   * wrong.
   *
   * An Effect and not a value: the Catalog is rebuilt, so a caller that
   * captured a rate would go on quoting one a vendor has since moved.
   */
  readonly prices: Effect.Effect<PriceLookup>

  /**
   * A plugin may host plugins. A hosted scope is a child of its host's.
   *
   * `Plugin` names the real type rather than `{ id, effect: unknown }`: the
   * two modules refer to each other, which for types alone is fine, and the
   * structural stand-in it replaces cost the kernel a cast to restore what
   * the caller already knew.
   */
  readonly plugin: {
    readonly add: (plugin: Plugin) => Effect.Effect<void>
    readonly remove: (id: string) => Effect.Effect<void>
    readonly list: Effect.Effect<readonly string[]>
  }
}
