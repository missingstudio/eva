# Architecture

How Eva is put together: the plugin model, the kernel, every module we build,
and every interface a plugin can touch.

Eva is plugin-first — a small kernel loads plugins, and everything else is one,
including the harness. Read [context.md](../context.md) first; it defines the
words used here and it is short. [README.md](../README.md) says what Eva is, and
[roadmap.md](../roadmap.md) says which stage each module arrives in.

Code blocks here are excerpts: they elide imports and surrounding scope, and
their types are checked against the pinned Effect version before they land.

## 1. The architecture in one page

Four extension points carry the whole system. A plugin uses one or more of
them. There are no other ways to extend Eva.

| Extension point | What it is                                     | Who contributes | Example                             |
| --------------- | ---------------------------------------------- | --------------- | ----------------------------------- |
| **Domain**      | Shared state that many plugins build together  | Many plugins    | the catalog of providers and models |
| **Slot**        | One capability that one plugin supplies        | One plugin      | the trace sink                      |
| **Hook**        | A callback at a live operation boundary        | Many plugins    | inspect a tool call before it runs  |
| **Broadcast**   | A typed notification a plugin can subscribe to | Many plugins    | `catalog.updated`                   |

A **domain** rebuilds. The kernel keeps an ordered list of transforms. To
rebuild, it makes fresh state, replays every transform in order, runs the
domain's finalizer, and commits. Add a transform and the domain rebuilds. Remove
a transform and the domain rebuilds. This is how a plugin loads and unloads at
runtime with no restart.

A **slot** is late-bound. A consumer reads the slot at the moment of use. It
never captures the implementation. Replace the plugin behind a slot and the next
read gets the new implementation. An empty slot is a legal state: emptying one
publishes the `slot.emptied` broadcast, and a Run that reads it empty records a
`degraded` payload.

A **hook** runs in registration order at one point in an operation. Later hooks
see what earlier hooks changed.

A **broadcast** is a stream. A plugin subscribes and reacts. Broadcasts never
carry control flow — a hook does that.

```
              ┌─────────────────────────────────────────┐
              │  kernel                                 │
              │   plugin runtime · domain machinery     │
              │   slot table · broadcast bus            │
              │   config source · location              │
              └───────────────┬─────────────────────────┘
                              │ PluginContext
      ┌───────────────┬───────┴────────┬────────────────┐
      ▼               ▼                ▼                ▼
  domains          slots            hooks            broadcasts
  catalog          Recorder         tool.execute     catalog.updated
  tool             TraceSink        session.prompt   tool.updated
  harness          SessionStore     provider.request run.finished
  surface          Sandbox          trace.commit     plugin.added
  agent            FileSystem       harness.prompt   slot.emptied
  command          Shell
  theme            CredentialStore
  keymap           Budget
  integration
  prompt
```

### Why this shape

We validated three plugin systems before settling on it.

**The first reference — one surveyed harness — runs this exact model on Effect
in production.** Its plugin is an `Effect`, not a `Layer`. Its `State` helper —
128 lines — is the domain rebuild engine. We adopt its transform/hook split, its
rebuild semantics, its scoped registration, and its boot batching, because they
are proven and small.

**The second reference — another surveyed harness — proves that "everything is
a plugin" scales:** its agent loop, session, LLM, tools, and sandbox are all
ordinary plugin rows in a patch file. We adopt its bundle/profile packaging and
its split between a contract package and its swappable implementations
(`session-persistence-jsonl` beside `session-persistence-sqlite`).

**Effect v4** supplies `Scope` for disposal, `Fiber` for concurrency, and
`Context` for typed services. It does not supply a dynamic service registry, and
that constraint shapes the plugin contract — the next section says how.

## 2. The plugin contract

A plugin is an object with an `id`, an `effect`, and the config keys it reads.
The effect runs once when the plugin loads. It registers transforms, hooks,
slot implementations, and subscriptions. It does not return anything.

```ts
// packages/sdk/src/plugin.ts
import type { Effect, Scope } from "effect"
import type { PluginContext } from "./context.js"

export type Shape = "string" | "list" | "mapping" | "name"
export type Reads = Readonly<Record<string, Shape>>

export interface Plugin<R = Scope.Scope> {
  /** The identity used by config, the disable list, and hot replace. */
  readonly id: string
  /** The top-level config keys this plugin reads. Data, not a registration. */
  readonly reads?: Reads
  /** Runs once at load. Registers into the context. Returns nothing. */
  readonly effect: (context: PluginContext) => Effect.Effect<void, never, R>
}

export function define<R = Scope.Scope>(plugin: Plugin<R>): Plugin<R> {
  return plugin
}
```

Four rules follow from this shape.

**Registration is imperative.** The plugin calls `ctx.tool.transform(...)` or
`ctx.tool.hook(...)`. It does not return a manifest of hooks. This lets one
plugin register many transforms in the same domain, and lets it register
conditionally.

**Registration is scoped.** Every register call returns a `Registration` and
attaches a finalizer to the plugin's scope. When the plugin unloads, its scope
closes and every registration goes away. A plugin cannot forget to clean up.

```ts
// packages/sdk/src/registration.ts
import type { Effect, Scope } from "effect"

export interface Registration {
  /** Removes this registration early. Calling it twice is safe. */
  readonly dispose: Effect.Effect<void>
}

/** Every domain exposes its runtime hooks through this shape. */
export type Hooks<Spec> = {
  readonly [Name in keyof Spec]: (
    callback: (event: Spec[Name]) => Effect.Effect<void> | void,
  ) => Effect.Effect<Registration, never, Scope.Scope>
}
```

**Errors are defects.** A transform and a hook have no typed error channel. A
failure inside one is a defect, and the kernel reports it and continues. This
keeps plugin code short. A plugin that needs a recoverable failure models it in
its own return value.

**What it reads is a declaration, not a registration.** `reads` sits beside the
id as data, so the key sweep in §10 folds the resolved plugin table and answers
before the kernel boots. It is not a fifth extension point.

### The plugin runtime

The kernel holds the plugin table. It is the only part of the system that is not
a plugin.

```ts
// packages/kernel/src/plugin.ts
export interface PluginRuntime {
  /** Loads a plugin. Re-adding a known id replaces it and keeps its order. */
  readonly add: (id: PluginID, effect: Plugin["effect"]) => Effect.Effect<void>
  /** Unloads a plugin. Closes its scope and removes every registration. */
  readonly remove: (id: PluginID) => Effect.Effect<void>
  /** Waits until a plugin has finished loading. */
  readonly wait: (id: PluginID) => Effect.Effect<void>
  /** Lists loaded plugins in load order. */
  readonly list: Effect.Effect<readonly PluginID[]>
}
```

`add` forks a child scope from the runtime scope, runs the plugin effect in it,
and stores the scope. `remove` closes the scope. Replacing a plugin closes the
old scope before the new effect starts, and the plugin keeps its position in the
order. That position-keeping is Eva's own rule, not inherited: the first
reference's replace re-registers at the end of the order, which silently
changes which transform wins — the kernel reload test asserts the position holds. A load
cycle — a plugin that adds itself — is detected and fails.

### Load order

Order matters, because transforms replay in registration order and later
transforms win. The order is a list, not a phase field on the plugin.

```
1. schema and identity plugins
2. base data sources        (models catalog, installed harness discovery)
3. configuration projections (config → catalog, tool, agent, command)
4. provider normalization and authentication
5. capability plugins        (tools, harnesses, sandbox, session store)
6. surface plugins           (tui, api, print, web)
7. external user plugins
8. domain finalization       (kernel, not a plugin)
```

We considered a `phase` field on the plugin, and rejected it. The second
reference's plugin framework has no phases: its base bundle states that "row
order carries no load semantics (activation is service-availability driven)".
The first reference has no phases either: it uses an explicit `add` sequence. A phase field is a static partition that
forbids legal graphs — a surface plugin that supplies a slot a capability plugin
reads is normal, and a phase would reject it. The list above is a default order,
and a profile can change it.

### A plugin may host plugins

The plugin system is reentrant. A plugin receives `ctx.plugin.add` and
`ctx.plugin.remove`, so it can load plugins of its own. A plugin that does this
is a **host plugin**.

```ts
export interface PluginDomain {
  readonly add: (plugin: Plugin) => Effect.Effect<void>
  readonly remove: (id: string) => Effect.Effect<void>
}
```

Three rules make hosting safe:

**A hosted plugin's scope is a child of its host's scope.** Unload the host and
every plugin it loaded unloads with it, in reverse order. There is no way for a
hosted plugin to outlive its host.

**A host may expose its own extension points.** A host declares domains, slots,
and hooks that only its hosted plugins see. These are ordinary extension points;
what makes them the host's is that the host created them.

**Host-scoped extension points are isolated by host instance.** Two hosts that
declare a domain of the same name have two domains, not one. The second
reference's plugin framework does this with a realm that suffixes the service
key per entry (`key#entryId`) or per
label (`key@label`). Eva does the same: a host-scoped key carries its host's
instance id, so five live harnesses have five compaction strategies and not one
shared one.

**Why this matters.** A harness that is one opaque plugin can only be replaced,
never adjusted. To change how it compacts, or how it builds a system prompt, or
how it schedules parallel tool calls, you would fork it. Both references solved
this the same way, by refusing to make the loop a monolith. The second
reference's `agent-loop` is one row among 78 in its base bundle, sitting beside
`compaction-basic`, `system-prompt`, and `session-title` — each replaceable on
its own. The first reference gives every plugin `ctx.plugin.add`, so a plugin
can compose others.

**Eva's native harness is a host plugin.** `eva.harness.loop` is one entry in
the harness domain, and it is also a host: the context assembler, the compaction
strategy, the system prompt builder, the tool-call scheduler, the retry policy,
and the steering inbox are each plugins it hosts. Replacing Eva's compaction is
a plugin swap inside one harness, not a fork of the harness and not a change
that touches any other harness.

The recursion is bounded in practice, not by rule. A host that hosts a host is
legal and rare. What is not legal is a cycle: a plugin that adds itself, or that
adds a plugin already loading, fails at load with the cycle named.

## 3. Why a plugin is an Effect and not a Layer

This is the load-bearing decision, so it is worth the paragraph.

Effect's `Context<Services>` is a compile-time environment. The set of services
in it is a type. A plugin set that is assembled at runtime cannot be expressed
in that type. If each plugin returns a `Layer` that the loader merges, then
either every layer is typed `Layer<never, never, never>` — in which case the
merged context provides nothing and no consumer can read a service out of it —
or the loader needs a cast at every step and the types stop meaning anything.

We tested this against `effect@4.0.0-rc.109`. A loader that merges
`Layer<never, never, never>` values compiles, and then `Context.get(ctx,
Recorder)` fails with `Type 'Recorder' is not assignable to type 'never'`. The
model does not work.

Both reference implementations avoid it in the same way: **the plugin set is
dynamic and the extension surface is static.** The first reference gives each
plugin a host object with a fixed set of typed domains, and supplies core
services with `Effect.provideService` at load time — for its internal plugins;
an external plugin sees only the host object. The second reference's plugin
framework gets the same result with TypeScript declaration merging on a global
`Context` interface.

Eva takes the first reference's approach, because Eva is already on Effect and
the typing is honest with no merging tricks. The consequence: **`@missingstudio/eva-sdk`
declares every domain, slot, and hook.** Adding a new extension point is an SDK
change. That is the cost, and it is the right cost — an extension point is a
public contract and it should be reviewed.

## 4. Domains

A domain is state that many plugins build together. The kernel owns the rebuild.

### 4.1 How a domain rebuilds

```
fresh initial state
  → replay every active transform, in registration order
  → run the domain finalizer (invariants, indexes, materialization)
  → commit the new state
  → publish the domain's updated event
```

Rules the kernel enforces:

- A transform registers with `transform(callback)` and returns a `Registration`.
- One plugin may register many transforms in one domain.
- Order is plugin load order, then registration order inside the plugin.
- Registering or disposing a transform rebuilds the domain.
- During boot, rebuilds are batched: each affected domain rebuilds once at the
  end, not once per transform.
- Rebuilds are serialized. Calls that arrive during a rebuild coalesce into at
  most one more rebuild.
- A rebuild captures its transform list when it starts. Changes during a replay
  apply to the next rebuild.
- A transform may read another domain, but it must arrange its own rebuild. The
  kernel does not infer cross-domain dependencies.

A transform edits a **draft** — a narrow editor, not the internal state object.
The draft speaks in public types. The kernel maps them to internal branded types
on the way in.

```ts
// packages/kernel/src/domain.ts — the rebuild engine
import { Context, Effect, Scope, Semaphore } from "effect"
import type { Registration } from "@missingstudio/eva-sdk"

export type TransformCallback<Draft> = (draft: Draft) => Effect.Effect<void> | void

export interface DomainOptions<State, Draft> {
  /** Builds the base value for the first build and every rebuild. */
  readonly initial: () => State
  /** Wraps mutable state in the editor a transform sees. */
  readonly draft: (state: State) => Draft
  /** Runs after every transform and before the new state is visible. */
  readonly finalize?: (draft: Draft) => Effect.Effect<void>
}

export interface Domain<State, Draft> {
  readonly get: () => State
  readonly transform: (
    callback: TransformCallback<Draft>,
  ) => Effect.Effect<Registration, never, Scope.Scope>
  readonly reload: () => Effect.Effect<void>
}

/** Collects rebuilds during boot so each domain rebuilds once. */
const CurrentBatch = Context.Reference<Set<() => Effect.Effect<void>> | undefined>(
  "eva/Domain/CurrentBatch",
  { defaultValue: () => undefined },
)

export function batch<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.gen(function* () {
    const current = yield* CurrentBatch
    if (current) return yield* effect
    const reloads = new Set<() => Effect.Effect<void>>()
    const result = yield* effect.pipe(Effect.provideService(CurrentBatch, reloads))
    yield* Effect.forEach(reloads, (reload) => reload(), { discard: true })
    return result
  })
}
```

`create` keeps the transform list, a `Semaphore` of one permit to serialize
rebuilds, and the committed state. A transform's `dispose` removes it from the
list and rebuilds. `Scope.addFinalizer` attaches that `dispose` to the caller's
scope, so a plugin's transforms disappear when the plugin unloads.

### 4.2 The domain list

The ten domains the SDK declares today, their state, and the plugins that
write to them. Later stages add `workspace`, `check`, `memory`, `skill`,
`importer`, and `signal`. Adding one is a reviewed SDK change.

| Domain        | Holds                                           | Finalizer does                                                                | Written by                                                |
| ------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| `catalog`     | providers, models, the default model            | validates policy, builds the lookup index                                     | `eva.catalog.models`, `eva.provider.*`, `eva.config`      |
| `harness`     | harness registrations, one entry per harness    | checks that the selected harness exists — checked at selection, not at commit | `eva.harness.*`, `eva.workflow`                           |
| `surface`     | surface registrations, one entry per surface    | checks id collisions, resolves the active set                                 | `eva.tui`, `eva.print`, `eva.api`, `eva.web`              |
| `agent`       | agent definitions: model, tools, budget, prompt | resolves inheritance, applies the default                                     | `eva.agents`, `eva.profile`, `eva.config`, `eva.approval` |
| `tool`        | tool registrations, one entry per tool          | —                                                                             | `eva.tool.*`, `eva.sched`, `eva.approval`, `eva.config`   |
| `prompt`      | Templates, one row per Template                 | —                                                                             | `eva.prompt`, `eva.workflow`, `eva.config`                |
| `command`     | slash commands and their handlers               | checks name and alias collisions                                              | `eva.commands`, `eva.print`, `eva.config`                 |
| `theme`       | themes: colors and syntax styles                | resolves the active theme, fills missing keys                                 | `eva.themes`, `eva.config`                                |
| `keymap`      | key bindings by surface                         | detects conflicting bindings                                                  | `eva.keymap`, `eva.config`                                |
| `integration` | credential sources and auth methods             | projects live connections                                                     | `eva.auth`, `eva.provider.*`                              |

Each domain publishes `<name>.updated` after it commits.

**What `eva.approval` writes.** One `agent` row per permission mode —
`read-only`, `supervised`, `autonomous`, `plan` — carrying the mode's `id` and
the `prompt` that says what the mode is there to do. That is where a mode is
published: `/mode` lists what the rows say, so a person who overrode a mode's
prompt in config reads their own words. The rows leave `AgentInfo.tools` empty
on purpose. A mode selects by what a tool **does** — its `ToolInfo.kind` — so a
tool that loads tomorrow is selected by its kind rather than by whether
somebody listed its name, and a name list beside that rule would be a second
statement of it that goes stale on the next load.

The selection itself is a `tool` transform that **removes** the rows the mode
does not reach, so a mode change rebuilds the domain rather than filtering it
at call time; and `/mode` is a `command` row. A domain is process-wide and a
mode is per Session, so the domain is built to the widest mode any Session
has named and each Session's own mandate at `tool.execute.before` is what
refuses. The strict side is at the gate, where it decides.

A row that describes an action carries the action. `CommandInfo.run`,
`SurfaceInfo.start`, `HarnessInfo.open` and `ToolInfo.execute` are all
optional, so one plugin may name a command and
another supply what it does: `eva.commands` declares `/cost`, and `eva.print`
fills in its handler, because the formatter it needs belongs to the plugin that
prints. A row with the field absent names something the build knows of but
cannot run, and the surface says so rather than failing silently.

`ToolInfo.execute` takes the input and a `ToolContext`, because a tool that
works for a while says so while it works:

```ts
// packages/core/src/tool.ts
export interface ToolContext {
  /** The call id every record of this call joins on. Not an EventID. */
  readonly id: string
  /** Records the tool writes while it works: streamed output, and progress. */
  readonly emit: (payload: Payload) => Effect.Effect<void>
}

export interface ToolInfo {
  id: string
  description: string
  kind: ToolKind
  /** JSON Schema, the way a Validator is handed one. */
  input: unknown
  /** Whether a call may run beside another. A row with none runs alone. */
  parallelSafe?: (input: unknown) => boolean
  execute?: (input: unknown, context: ToolContext) => Effect.Effect<ToolResult>
}
```

`executeTool` owns the `tool_call`, the closing `tool_update`, and the
`tool_result`; a tool writes its own `tool_update` records in between. The
call record lands before the tool runs, because the fold joins the records by
the call id and drops an orphan without a word.

`executeToolGroup` runs the group one provider response proposed. Ordering a
group is not something a hook can do — a hook fires per call and a barrier is
a property of the group — so the algorithm sits beside `executeTool`, where a
harness plugin can reach it, and the policy it reads is `eva.sched`'s. A run
of consecutive parallel-safe calls is one window, bounded by
`TOOL_GROUP_LIMIT`; every other call is a Barrier and is a window of one. A
window's records are held until it ends and then commit call by call in source
order, so the Trace reads the same bytes whichever call finished first.

### 4.3 A domain draft

The catalog draft, as an example. Every draft follows this shape: `list`, `get`,
`update`, `remove`, and any domain-specific extras.

```ts
// packages/sdk/src/domains/catalog.ts
import type { ModelInfo, ProviderInfo } from "@missingstudio/eva-schema"
import type { Hooks } from "../registration.js"

export interface CatalogDraft {
  readonly provider: {
    list(): readonly ProviderInfo[]
    get(providerID: string): ProviderInfo | undefined
    update(providerID: string, update: (provider: ProviderInfo) => void): void
    remove(providerID: string): void
  }
  readonly model: {
    get(providerID: string, modelID: string): ModelInfo | undefined
    update(providerID: string, modelID: string, update: (model: ModelInfo) => void): void
    remove(providerID: string, modelID: string): void
    readonly default: {
      get(): { providerID: string; modelID: string } | undefined
      set(providerID: string, modelID: string): void
    }
  }
}

export interface CatalogDomain {
  readonly transform: (
    callback: (draft: CatalogDraft) => Effect.Effect<void> | void,
  ) => Effect.Effect<Registration, never, Scope.Scope>
  readonly reload: () => Effect.Effect<void>
}
```

Writing to it:

```ts
export const AnthropicProvider = define({
  id: "eva.provider.anthropic",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update("anthropic", (provider) => {
        provider.name = "Anthropic"
        provider.api = "https://api.anthropic.com"
      })
      catalog.model.update("anthropic", "claude-sonnet-5", (model) => {
        model.contextWindow = 1_000_000
        model.cost = { input: 3, output: 15 }
      })
    })
  }),
})
```

### 4.4 Reacting to change

A transform captures data. When the data changes, the plugin reloads the domain.
The kernel does not track this for you.

```ts
export const ModelsCatalog = define({
  id: "eva.catalog.models",
  effect: Effect.fn(function* (ctx) {
    const source = yield* ModelsSource

    yield* ctx.catalog.transform(
      Effect.fn(function* (catalog) {
        applyCatalog(yield* source.get(), catalog)
      }),
    )

    yield* ctx.broadcast.subscribe("models.refreshed").pipe(
      Stream.runForEach(() => ctx.catalog.reload()),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
```

## 5. Slots

A domain has many contributors. A slot has one. The trace sink, the session
store, and the sandbox are each supplied by exactly one plugin, and each must be
replaceable while Eva runs.

A slot is **late-bound**. Consumers read it at the moment of use.

```ts
// packages/sdk/src/slot.ts
export interface Slot<T> {
  /** Reads the current implementation. Fails as a defect when empty. */
  readonly get: Effect.Effect<T>
  /** Reads the current implementation, or undefined when nothing fills it. */
  readonly peek: Effect.Effect<T | undefined>
  /** Fills the slot. The Registration is bound to the caller's scope. */
  readonly provide: (
    id: string,
    implementation: T,
  ) => Effect.Effect<Registration, never, Scope.Scope>
}
```

This is what makes hot replace work. A consumer that captured a `Recorder` would
keep writing into a closed sink after the trace plugin was replaced. A consumer
that reads `yield* ctx.recorder.get` every time it commits does not. **A plugin
must never hold a slot value across an await.**

Filling a slot that is already filled is an error, unless the new plugin
replaces the old one by id. Emptying a slot publishes the `slot.emptied`
broadcast, and a Run that reads the slot empty records a `degraded` payload
naming it.

### The slot list

The slots that exist through roadmap stage 2. Later stages add `RepoMap`,
`Retriever`, `Workspace`, `Snapshot`, `Verifier`, `Memory`, `TaskStore`,
`Queue`, `Scheduler`, `Identity`, and `MergeQueue` —
[roadmap.md](../roadmap.md#the-extension-points-by-stage) has the full table.

| Slot              | Interface                                                      | Default plugin               | Alternatives                                                |
| ----------------- | -------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------- |
| `Recorder`        | the only path events take to the trace                         | `eva.trace`                  | —                                                           |
| `TraceSink`       | append-only event store                                        | `eva.trace.sqlite`           | `eva.trace.jsonl`, `eva.trace.postgres`, `eva.trace.memory` |
| `SessionStore`    | opens, folds, and persists a session                           | `eva.session.jsonl`          | —                                                           |
| `Sandbox`         | runs a command under a policy                                  | `eva.sandbox.none` (stage 2) | `eva.sandbox.local` (stage 4)                               |
| `FileSystem`      | reads and writes files under a root                            | `eva.fs`                     | —                                                           |
| `Shell`           | starts a process and streams its output                        | `eva.shell`                  | —                                                           |
| `CredentialStore` | stores and resolves credentials by mode                        | `eva.auth`                   | —                                                           |
| `Budget`          | accounts tokens, cost, wall time, and Steps                    | `eva.budget`                 | —                                                           |
| `Validator`       | judges a Candidate against a JSON Schema and names every Fault | `eva.validator`              | —                                                           |
| `DiffApplier`     | previews a structured edit, then applies it                    | `eva.diff`                   | —                                                           |

### The slot interfaces

```ts
// packages/core/src/contracts.ts — declared here, implemented by plugins
import type { Effect, Stream } from "effect"
import type {
  Claim,
  Event,
  Fault,
  Payload,
  RunID,
  SessionID,
  StopReason,
} from "@missingstudio/eva-schema"

/** The append-only store every Event lands in. A closed trace still parses. */
export interface TraceSink {
  /** Commits a group atomically and returns the events with trace positions. */
  readonly append: (group: readonly Event[]) => Effect.Effect<readonly Event[]>
  /** Replays a session's events in trace order. */
  readonly replay: (session: SessionID) => Stream.Stream<Event>
  /** Every session the trace holds, so a new process can list what is there. */
  readonly sessions: Effect.Effect<readonly SessionID[]>
  readonly close: Effect.Effect<void>
}

/** The one path to the trace. It owns the trace position and closes the Run. */
export interface Recorder {
  readonly open: (session: SessionID) => Effect.Effect<RunID>
  readonly commit: (payloads: readonly Payload[]) => Effect.Effect<void>
  /** Writes the closing `finished` record, so nothing else may. Idempotent. */
  readonly close: (claim: Claim, stopReason?: StopReason) => Effect.Effect<void>
}

/** The durable transcript. Resume, branch, and rewind act on this. */
export interface SessionStore {
  readonly open: (id: SessionID) => Effect.Effect<Session>
  readonly create: Effect.Effect<Session>
  readonly fold: (id: SessionID) => Effect.Effect<Transcript>
  readonly list: Effect.Effect<readonly SessionHeader[]>
}

/**
 * Runs a command under a policy. The policy decides, the Sandbox enforces,
 * and `capabilities` says how much of the policy this one holds.
 */
export interface Sandbox {
  readonly run: (
    command: Command,
    policy: SandboxPolicy,
  ) => Effect.Effect<Process, SandboxError, Scope.Scope>
  readonly capabilities: Effect.Effect<SandboxCapabilities>
}

/** Reads and writes files under one root. A path outside it is refused. */
export interface FileSystem {
  readonly read: (path: string) => Effect.Effect<string, FileSystemError>
  readonly write: (path: string, content: string) => Effect.Effect<void, FileSystemError>
  readonly glob: (pattern: string) => Effect.Effect<readonly string[], FileSystemError>
  readonly stat: (path: string) => Effect.Effect<FileStat | undefined, FileSystemError>
}

/** Starts a process and streams its output. A spawn that never started fails. */
export interface Shell {
  readonly spawn: (command: Command) => Effect.Effect<Process, ShellError, Scope.Scope>
}

export interface CredentialStore {
  readonly get: (id: string) => Effect.Effect<Credential | undefined>
  readonly set: (id: string, credential: Credential) => Effect.Effect<void>
  readonly remove: (id: string) => Effect.Effect<void>
  readonly list: Effect.Effect<readonly CredentialRef[]>
}

export interface Budget {
  readonly charge: (usage: Usage) => Effect.Effect<BudgetState>
  readonly state: Effect.Effect<BudgetState>
  /** Answers whether the next Provider Turn is affordable under the limits. */
  readonly check: Effect.Effect<BudgetDecision>
}

/**
 * What `check` answers about one Candidate. `value` is the parsed Output, so
 * the caller does not parse twice. A Validator never answers `unchecked`: an
 * empty Slot answers nothing, and the caller writes that word.
 */
export type Judged =
  | { readonly verdict: "valid"; readonly value: unknown }
  | { readonly verdict: "invalid"; readonly faults: readonly Fault[] }

/**
 * Judges one Candidate against a JSON Schema. It judges form, never truth,
 * and it never calls a model. The Repair is the caller's.
 */
export interface Validator {
  /** Fails only when the JSON Schema itself cannot be read. */
  readonly accepts: (schema: unknown) => Effect.Effect<void, ValidatorError>
  /** Extract, parse, and check are one judgement over the Candidate's text. */
  readonly check: (schema: unknown, candidate: string) => Effect.Effect<Judged, ValidatorError>
}

/** One replacement in one file. `find` must appear exactly once. */
export interface Hunk {
  readonly find: string
  readonly replace: string
}

/** A structured edit: one file, and the Hunks to land in it, in order. */
export interface Edit {
  readonly path: string
  readonly hunks: readonly Hunk[]
}

/**
 * A resolved Edit, and what a dry run answers. `after` is the whole content
 * an apply writes, and `base` fingerprints what the Preview was computed
 * against — opaque to everyone but the applier that made it.
 */
export interface Preview {
  readonly path: string
  readonly base: string
  readonly after: string
  readonly hunks: number
}

/** What one apply wrote, and what reverses it byte for byte. */
export interface Applied {
  readonly path: string
  readonly before: string
  readonly wrote: string
}

/** Why an applier would not write. Typed data a caller reports, never a throw. */
export class DiffRefused extends Data.TaggedError("DiffRefused")<{
  readonly reason: "hunk_missing" | "hunk_ambiguous" | "stale"
  readonly path: string
  readonly hunk?: number
  readonly found?: number
  readonly message: string
}> {}

/**
 * Previews a structured Edit, then applies it. The part of a `FileSystem` it
 * reads and writes through is handed in at each call, so an applier reads no
 * Slot and holds no filling. A `FileSystemError` stays in the error channel
 * beside `DiffRefused`: a path outside the root is a real outcome the caller
 * reports, and an applier that swallowed one would answer for a write it
 * never made.
 *
 * Atomicity is a property of the Preview and not of the write: every Hunk is
 * placed while the Preview is computed, so a Hunk that cannot land refuses
 * the Preview and an apply is one `write` of an already-complete content.
 * That is what lets the contract hold over a `FileSystem` that offers no
 * rename into place, no transaction, and no lock. An Edit names one file,
 * because one write per file is all the contract offers.
 */
export interface DiffApplier {
  readonly preview: (
    files: Pick<FileSystem, "read" | "write">,
    edit: Edit,
  ) => Effect.Effect<Preview, DiffRefused | FileSystemError>
  readonly apply: (
    files: Pick<FileSystem, "read" | "write">,
    preview: Preview,
  ) => Effect.Effect<Applied, DiffRefused | FileSystemError>
  /** Reverses one apply, and answers the apply that reverses the reverse. */
  readonly reverse: (
    files: Pick<FileSystem, "read" | "write">,
    applied: Applied,
  ) => Effect.Effect<Applied, DiffRefused | FileSystemError>
}
```

### Running a command, and reading a file

`Command` is a program and its arguments already split, and nothing in it
reaches a shell — so a caller that wants shell syntax names the shell itself,
and the gate that judges a command sees the words that will really run. A
`Process` is the live half: stdout and stderr merged in arrival order while
the process runs, the `Exited` code or signal once it ends, and a `kill`. The
Scope owns the process, so one still running when the scope closes is killed.

A `Sandbox` answers the same `Process` a `Shell` does, because containment is
how a process starts and not what it returns: one that wraps the argv spawns
through the `Shell` slot, one that needs its own spawn call makes it, and the
caller reads the output the same way either way. `SandboxCapabilities` names
the controls the filler really enforces, so a caller reports the containment
it has and never the containment it asked for — `eva.sandbox.none` enforces
nothing and answers an empty list.

Every `FileSystem` path is resolved against the root and refused with
`outside_root` when it lands outside, whatever way it was spelled. `glob`
answers paths relative to the root, files only, sorted, and the pattern rule
is `globMatcher` in `packages/core/src/glob.ts` — it lives beside the contract
because two fillers of one Slot must answer the same paths, and one walking a
disk and one walking a map cannot each spell the rule for itself.

### Writing a sink

`TraceSink` is what a consumer calls, and it is not what a sink author writes.
A sink author writes a `TraceStore`: where records live, where each session
got to, and how they come back — and the store owns the allocation. Each
record is numbered one past its session's high water inside the same act that
makes it durable, because a store that can allocate in a transaction — SQLite,
Postgres — is safe against a second writer only when it does, and a caller
that numbered before the write could not be.

```ts
// packages/core/src/sink.ts
export interface TraceStore {
  /** Numbers a group and stores it. Returns the stamped group once durable. */
  readonly append: (group: readonly Event[]) => Effect.Effect<readonly Event[]>
  readonly highWater: (session: SessionID) => Effect.Effect<number>
  readonly replay: (session: SessionID) => Stream.Stream<Event>
  readonly sessions: Effect.Effect<readonly SessionID[]>
  /** Headers, when the store can answer without a replay. In no order. */
  readonly headers?: Effect.Effect<readonly SessionHeader[]>
  readonly close: Effect.Effect<void>
}

/** A store that keeps stamped records and numbers nothing. */
export interface StampedStore {
  /* write, highWater, replay, sessions, headers?, close */
}

/** The one way a store becomes a sink. Either kind goes in. */
export const sinkOf: (store: AnyStore) => Effect.Effect<TraceSink>
```

A sink author answers one question: can the store number inside the act that
makes a group durable? A store that can writes `TraceStore`; one that cannot
writes `StampedStore`. Both go to `sinkOf`, which is the only composition any
caller — a plugin, a test — ever spells.

Behind it sit two internal seams with their own tests. `sequenced` holds what
every sink owes and no store repeats: text coalescing above the store,
followers, close-once, and a folded `headers` for a store that keeps none —
which is why `TraceSink.headers` is never optional even though the store's
is. `numbered` is the in-memory allocation a non-transactional store gets:
one process only, which is the trade `eva.trace.jsonl` and `eva.trace.memory`
accept and the SQL stores must not.

Two SQL stores share more than the seam. `packages/core/src/rows.ts` holds
the row-shaped store both of them keep — the column set, the codec both ways,
the head row, and the allocation arithmetic — so `eva.trace.sqlite` and
`eva.trace.postgres` differ in one thing only: the primitive that keeps a
second writer out of the allocation. A row means the same thing in either,
which is what lets a Trace move between them unchanged.

[trace-storage.md](trace-storage.md) owns the store decision itself.

## 6. Hooks

A hook runs at a live operation boundary. It can inspect the operation and it can
change it through purpose-built methods. It never receives an internal object.

Rules:

- Many plugins may register the same hook.
- Hooks run sequentially, in plugin order then registration order.
- A later hook sees what an earlier hook changed.
- A hook is not replayed during a domain rebuild.
- Disposal affects the next invocation. An in-flight invocation finishes.
- A boundary is **deciding** or **observing**. The boundary declares which,
  because only the caller of the hooks knows what they decide.
- A hook that dies fails toward its boundary's safe side. At an observing
  boundary the failure is published as `plugin.failed` and the next hook runs:
  a broken observer must never end a Run. At a deciding boundary the failure
  is a denial — the call the boundary was deciding never runs, and no later
  hook runs either, because a gate that fails open because a plugin threw is
  not a gate.

Stage 0's four provider hooks observe: each decorates a Run and none of them
decides whether it proceeds. `tool.execute.before` is the first deciding
boundary, and the only one today. The kinds are declared beside the hook spec
— `PROVIDER_BOUNDARIES` and `TOOL_BOUNDARIES` in `packages/sdk/src/hooks.ts` —
and the composition root hands them to `makeHooks`, so a hook the spec
declares and the boundary map misses is a compile error. A hook registration
carries the id of the plugin that made it, the way a domain transform does, so
a failure names whose hook threw.

`run` answers the denial a deciding boundary produced, or nothing, and the
caller of the hooks turns a denial into one: `toolDeps` in
`packages/boot/src/deps.ts` reads the answer at `tool.execute.before` and
hands the execution a `reject_once` naming the hook and the plugin. The kernel
cannot force that read, so a new deciding boundary owes it.

### The hook list

Every hook, and the roadmap stage that introduces it.
[roadmap.md](../roadmap.md#the-extension-points-by-stage) carries the same
table, split by stage; a hook missing from one of the two is a defect. The
four provider boundaries and the three tool boundaries exist today; every
other row is the plan of the stage beside it.

| Hook                      | Stage | Fires                                 | Can change                              |
| ------------------------- | ----- | ------------------------------------- | --------------------------------------- |
| `model.resolve`           | 0     | when a model reference resolves       | which client answers it                 |
| `provider.request.before` | 0     | before a provider call goes out       | the messages, the model, the parameters |
| `provider.response.after` | 0     | after a Provider Turn completes       | the payload stream                      |
| `provider.retry`          | 0     | when a call fails and may be retried  | whether to retry, and the delay         |
| `tool.resolve`            | 2     | when a tool name is looked up         | which tool definition answers           |
| `tool.execute.before`     | 2     | before a tool runs                    | the arguments; allow, deny, or ask      |
| `tool.execute.after`      | 2     | after a tool returns                  | the result and its disposition          |
| `session.prompt.before`   | 3     | before a prompt enters a run          | the prompt text and attachments         |
| `session.prompt.after`    | 3     | after a run answers a prompt          | nothing; observation only               |
| `session.compact`         | 3     | when the transcript needs compaction  | which entries survive                   |
| `run.retry.before`        | 5     | before a failed attempt is retried    | runs remediation; whether to proceed    |
| `trace.commit.before`     | 6     | before events reach the sink          | redaction of payload fields             |
| `harness.prompt.before`   | 7     | before a harness is given a prompt    | the prompt and the selected harness     |
| `harness.prompt.after`    | 7     | after a harness reports a stop reason | the outcome and its claim               |
| `harness.request`         | 9c    | when a harness calls the client half  | the answer; records that it was asked   |
| `harness.resume.rejected` | 9c    | when a resume is refused or unclear   | fresh-session fallback and its notice   |

The tool gate is the important one, so here it is in full. It is the seam that
carries the tool policy, and it is how a plugin denies an action.

```ts
// packages/core/src/tool.ts
/**
 * What a hook may decide. `ask` is not a final answer — the execution resolves
 * the `ask` the boundary settled on into one of the other four through
 * `ToolDeps.approving`, and a call that reaches the tool still holding an
 * `ask` is denied.
 */
export type ToolDecision =
  | { readonly kind: "allow_once" }
  | { readonly kind: "allow_always" }
  | { readonly kind: "reject_once"; readonly reason: string }
  | { readonly kind: "reject_always"; readonly reason: string }
  | { readonly kind: "ask"; readonly question: string }
```

```ts
// packages/sdk/src/hooks.ts
export interface ToolExecuteBefore {
  readonly name: string
  readonly session: SessionID
  readonly args: {
    get(): unknown
    update(next: (args: unknown) => unknown): void
  }
  /** The strictest decision wins. A non-interactive surface turns ask into reject_once. */
  decide(decision: ToolDecision): void
  /**
   * What happens when nothing decided. A baseline, read only when no hook at
   * this boundary decided at all, so specific standing authority — a rule a
   * person wrote — is never asked about again. A permission mode supervises
   * with this and refuses with `decide`.
   */
  otherwise(decision: ToolDecision): void
}

export interface ToolExecuteAfter {
  readonly name: string
  readonly session: SessionID
  readonly result: {
    get(): ToolResult
    update(next: (result: ToolResult) => ToolResult): void
  }
}

// The hook names are the boundary names, so a `plugin.failed` report and this
// table say the same word.
export interface ToolHookSpec {
  "tool.resolve": ToolResolve
  "tool.execute.before": ToolExecuteBefore
  "tool.execute.after": ToolExecuteAfter
}
```

The family is `ctx.toolHooks` and not `ctx.tool`, because `ctx.tool` is the
tool domain: a plugin registers a tool as a row and decorates a call with a
hook, and the two are different extension points. `ctx.providerHooks` is
spelled the same way, so one kind of field has one spelling.

```ts
export const toolPolicy = define({
  id: "eva.tool.policy",
  reads: POLICY_KEYS.shapes,
  effect: Effect.fn("eva.tool.policy")(function* (ctx) {
    const set = rulesOf(yield* ctx.config)
    yield* ctx.toolHooks["tool.execute.before"]((event) => {
      const decision = judge(set.rules, event.args.get())
      if (decision !== undefined) event.decide(decision)
    })
  }),
})
```

`judge` is a pure function of the rule set and the call's arguments — the whole
gate, with no model in it — so the same answer is reachable from CI through
`eva policy check`. A hook that decides nothing allows, which is why the gate
says nothing about a call no rule names: which calls need an answer at all is
the permission mode's question, and the mode answers it with `otherwise`.

**Where the `ask` is resolved, and why not in a hook.** `ToolDeps.approving`
takes the ACP `PermissionRequest` the execution builds — the call id is the
request id, and `PERMISSION_OPTIONS` is the option list, because Eva's gate
offers all four options every time and a request carrying them would carry the
same four words on every ask. It runs **after** `strictest` has chosen, so one
call asks one person once whichever hook asked, and no other hook's `ask` can
outrank the answer a person gave. `overSurface` in `packages/boot` fills it:
it asks the running surface through `Frontend.ask`, which already carries the
request id and the question, and races that against `Api.request` so a surface
at the end of a socket answers with `SessionAPI.answer`. Absent, or with a
surface whose row says `interactive: false`, an `ask` is `reject_once` — a
permission request with nobody to answer it is a denial.

## 7. Broadcasts

A broadcast is a process-local notification. `ctx.broadcast.subscribe(type)`
returns a `Stream`.

```ts
// packages/sdk/src/broadcast.ts
export interface BroadcastDomain {
  subscribe<Type extends keyof BroadcastMap>(type: Type): Stream.Stream<BroadcastMap[Type]>
  publish<Type extends keyof BroadcastMap>(
    type: Type,
    payload: BroadcastMap[Type],
  ): Effect.Effect<void>
}
```

A Broadcast is not an Event, and the two must never be confused.

**Events** — the trace payloads — are the sealed schema written into the trace.
They are the record of what a run did, and they are the contract the event
schema freezes.

**Broadcasts** are process-local notifications. They are never written to the
trace and they carry no schema guarantee across versions.

| Broadcast             | Published when                                    |
| --------------------- | ------------------------------------------------- |
| `plugin.added`        | a plugin finished loading                         |
| `plugin.removed`      | a plugin unloaded                                 |
| `plugin.failed`       | a plugin's load died, or its observing hook threw |
| `catalog.updated`     | the catalog committed new state                   |
| `harness.updated`     | the harness domain committed new state            |
| `surface.updated`     | the surface domain committed new state            |
| `agent.updated`       | the agent domain committed new state              |
| `command.updated`     | the command domain committed new state            |
| `theme.updated`       | the theme domain committed new state              |
| `keymap.updated`      | the keymap domain committed new state             |
| `integration.updated` | the integration domain committed new state        |
| `config.changed`      | a config file on disk changed                     |
| `session.started`     | a session opened                                  |
| `run.opened`          | a run opened inside a session                     |
| `run.finished`        | a run closed with a claim                         |
| `slot.filled`         | a slot received an implementation                 |
| `slot.emptied`        | a slot lost its implementation                    |

## 8. The kernel

The kernel is the one thing that is not a plugin. It holds six things and
nothing else.

| Part             | Module                    | Responsibility                                                  |
| ---------------- | ------------------------- | --------------------------------------------------------------- |
| Plugin runtime   | `kernel/src/plugin.ts`    | add, remove, wait, order, child scopes, cycle detection         |
| Domain machinery | `kernel/src/domain.ts`    | transform lists, rebuild, serialization, batching               |
| Slot table       | `kernel/src/slot.ts`      | late binding, single provider, degraded reporting               |
| Broadcast bus    | `kernel/src/broadcast.ts` | typed publish and subscribe                                     |
| Config source    | `kernel/src/config.ts`    | reads and watches config files; does not interpret them         |
| Location         | `kernel/src/location.ts`  | resolves the working directory, its trust, and its config chain |

**The event schema is not in this table, and that is deliberate.** It lives in
`@missingstudio/eva-schema`, which imports nothing internal, because a plugin
and an adapter both need the payload types without pulling the plugin runtime in
behind them. The kernel imports it like everything else does. An earlier version
of this table put the schema inside the kernel, and the two statements cannot
both be true — §9.1 has the layer rule that settles it.

The config split is deliberate. Reading `~/.eva/config.yaml` is a kernel job,
because the plugin list lives in it and the kernel needs it before any plugin
exists. **Interpreting** config — projecting it into the catalog, the tool
domain, the agent domain — is the `eva.config` plugin's job. The first
reference draws the same line, and it is why a kernel with every plugin
disabled still knows which plugins it was told to skip.

The exit test for the kernel: `plugins: [{ id: "*", disabled: true }]` starts,
prints a version, and exits 0.

## 9. Packages

One workspace glob level per directory. Three directories, named as the
workspace globs in the root `package.json`: `packages/` holds the core — the
contract and runtime packages that are not plugins; `plugins/` holds every
internal plugin, one level, flat; `apps/` holds what you launch, one package
per entry point. No document lists what exists on disk, because `ls` answers
that.

**`apps/` is what you launch; `packages/` is what it is built from.** `apps/cli`
carries the `bin`. Every interface that can be reached through that binary —
`eva.api` over HTTP, `eva.web` — arrives as a plugin registering a surface row
rather than as a second app. An app never imports another app. A shell that
cannot be reached through the binary, such as Electron or Expo, is the case that
earns one; `docs/adr/` carries that decision.

### 9.1 The core packages

| Package                             | Holds                                                                                                                                                                                          | Imports                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `@missingstudio/eva-schema`         | the sealed `Payload` union, `Event`, the zod codec, branded IDs, wire types                                                                                                                    | nothing internal                   |
| `@missingstudio/eva-acp`            | the Agent Client Protocol in Effect: schema, JSON-RPC, both halves. Version pinned.                                                                                                            | `schema`                           |
| `@missingstudio/eva-core`           | pure domain: `Spec`, `Outcome`, `Claim`, `Session`, `Transcript`, the `SessionAPI`, and every slot contract                                                                                    | `schema`, `acp`                    |
| `@missingstudio/eva-kernel`         | the plugin runtime, domain machinery including the row Draft, slot table, broadcast bus, config source, location                                                                               | `schema`, `core`                   |
| `@missingstudio/eva-sdk`            | `PluginContext`, `define`, every domain draft, every hook type, every slot key                                                                                                                 | `schema`, `core`, `client-runtime` |
| `@missingstudio/eva-boot`           | assembles the Kernel: every domain, every slot, every hook, the plugin context, the deps `submit` reads, and the `SessionAPI` a Surface calls                                                  | `kernel`, `sdk`                    |
| `@missingstudio/eva-client-runtime` | every non-visual client concern a surface would otherwise write itself: the `Client` a surface holds, the Run protocol it runs, the transport seam it calls through, and the reconnect over it | `schema`, `core`                   |
| `@missingstudio/eva-session-view`   | the one fold that decides what a Run did: a Transcript to Blocks — words, reasoning, a tool call, the result that answered it, a diff, an image, and `unknown`. No renderer.                   | `schema`, `core`                   |
| `@missingstudio/eva-tui-core`       | `Keymap`, `ThemeColors`, `Frame`, `Renderer` contracts and the helpers beside them. No rendering code.                                                                                         | `schema`                           |
| `@missingstudio/eva-tui`            | the terminal: the OpenTUI React renderer, and a stream renderer for everywhere else                                                                                                            | `tui-core`, `session-view`         |

The layer rule:

```
schema     imports nothing internal
acp        imports schema
core       imports schema, acp
kernel     imports schema, core
sdk        imports schema, core, client-runtime — the surface row names the Client
boot       imports schema, core, kernel, sdk — where the kernel and the sdk meet
tui-core   imports schema
client-runtime imports schema, core — no renderer, ever
session-view imports schema, core — no renderer, ever
testkit    imports boot and the contracts below it — test files only
conformance imports anything, plugins included — test files only, ships nothing
plugins/*  import schema, core, sdk, client-runtime, tui-core — never kernel,
           never each other
           a plugin's *.test.ts may also import testkit, to boot the plugin
tui        imports tui-core and session-view — the only package that may name
           OpenTUI, and it holds no fold over the record
apps/*     import everything — an app is the composition root
```

A plugin reaches the kernel only through the `PluginContext` the SDK types.

**This rule is enforced.** The root `vite.config.ts` carries it as Oxlint
`overrides`: one `no-restricted-imports` pattern group per layer, each naming
the packages that layer may import and refusing the rest. A violation fails
`vp check`, and therefore `verify`. The one widening the code required is that
a plugin may also import `tui-core`, because a surface plugin draws through it
and it is a contract package like `core` and `sdk`.

**On plugins importing each other.** The blanket ban we first wrote is wrong,
and the second reference shows why: its agent-loop package imports values from
its session, llm, tools, and agent packages. The line that actually holds is
different. A **contract** may be imported. An **implementation** may not. Every
contract lives in `core` or `sdk`; therefore no plugin ever imports another
plugin, and the rule stays enforceable as written.

### 9.2 The plugin packages

The plugin catalogue. The `id` is the runtime identity and the config key; the
package name is only the distribution channel. The `plugins/` directory holds
the ones that exist today; the rest are named here so the shape of the whole is
visible.
[roadmap.md](../roadmap.md) says which stage introduces each one, and lists the
many more that later stages add.

**Trace and session**

| Plugin id            | Package              | Contributes                                 |
| -------------------- | -------------------- | ------------------------------------------- |
| `eva.trace`          | `eva-trace`          | fills `Recorder` — the one commit path      |
| `eva.trace.sqlite`   | `eva-trace-sqlite`   | fills `TraceSink` (SQLite, the default)     |
| `eva.trace.jsonl`    | `eva-trace-jsonl`    | fills `TraceSink` (JSONL, file per Session) |
| `eva.trace.postgres` | `eva-trace-postgres` | fills `TraceSink` (Postgres, hosted)        |
| `eva.trace.memory`   | `eva-trace-memory`   | fills `TraceSink` (in-memory)               |
| `eva.session.jsonl`  | `eva-session-jsonl`  | fills `SessionStore`                        |
| `eva.compaction`     | `eva-compaction`     | hook `session.compact`                      |

**Configuration and identity**

| Plugin id    | Package      | Contributes                                                  |
| ------------ | ------------ | ------------------------------------------------------------ |
| `eva.config` | `eva-config` | transforms into catalog, tool, agent, command, theme, keymap |
| `eva.auth`   | `eva-auth`   | fills `CredentialStore`; transforms `integration`            |

**Catalog and providers**

| Plugin id                 | Package                   | Contributes                                                                    |
| ------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| `eva.catalog.models`      | `eva-catalog-models`      | base catalog data, refresh                                                     |
| `eva.provider.anthropic`  | `eva-provider-anthropic`  | catalog transform, `model.resolve` hook                                        |
| `eva.provider.openai`     | `eva-provider-openai`     | `model.resolve` hook                                                           |
| `eva.provider.compatible` | `eva-provider-compatible` | catalog transform, `model.resolve` hook — one Provider per configured endpoint |
| `eva.provider.retry`      | `eva-provider-retry`      | hook `provider.retry`: backoff and error class                                 |
| `eva.usage`               | `eva-usage`               | hook `provider.response.after`: normalizes usage                               |

**Tools**

| Plugin id         | Package           | Contributes                                        |
| ----------------- | ----------------- | -------------------------------------------------- |
| `eva.tool.read`   | `eva-tool-read`   | tool transform                                     |
| `eva.tool.edit`   | `eva-tool-edit`   | tool and command domains, emits `edit` payloads    |
| `eva.tool.grep`   | `eva-tool-grep`   | tool transform                                     |
| `eva.tool.glob`   | `eva-tool-glob`   | tool transform                                     |
| `eva.tool.bash`   | `eva-tool-bash`   | tool transform, reads `Sandbox`                    |
| `eva.tool.web`    | `eva-tool-web`    | tool transform                                     |
| `eva.tool.policy` | `eva-tool-policy` | hook `tool.execute.before`: the deterministic gate |

**Workflow, scheduling, and approval**

| Plugin id       | Package         | Contributes                                                    |
| --------------- | --------------- | -------------------------------------------------------------- |
| `eva.prompt`    | `eva-prompt`    | prompt domain: Templates, includes, Variables                  |
| `eva.validator` | `eva-validator` | fills `Validator`: judges a Candidate, names Faults            |
| `eva.workflow`  | `eva-workflow`  | harness domain: a declared list of Steps, no agency            |
| `eva.sched`     | `eva-sched`     | tool transform: the parallel-safety policy                     |
| `eva.approval`  | `eva-approval`  | agent, tool and command domains + hook: named permission modes |
| `eva.diff`      | `eva-diff`      | fills `DiffApplier`: dry-run preview, atomic apply             |

**Execution environment**

| Plugin id           | Package             | Contributes                |
| ------------------- | ------------------- | -------------------------- |
| `eva.fs`            | `eva-fs`            | fills `FileSystem`         |
| `eva.shell`         | `eva-shell`         | fills `Shell`              |
| `eva.sandbox.local` | `eva-sandbox-local` | fills `Sandbox`            |
| `eva.sandbox.none`  | `eva-sandbox-none`  | fills `Sandbox`, no limits |
| `eva.budget`        | `eva-budget`        | fills `Budget`             |

**Harnesses**

| Plugin id              | Package                | Contributes                                                               |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------- |
| `eva.harness.loop`     | `eva-harness-loop`     | harness domain: Eva's own loop, one Step per Run                          |
| `eva.harness.acp`      | `eva-harness-acp`      | the ACP runtime, for any ACP agent                                        |
| `eva.harness.<vendor>` | `eva-harness-<vendor>` | one vendor extension per driven harness: launch, auth, capability probing |

Hosted by `eva.harness.loop`, and reachable only through it:

| Plugin id                   | Fills                      |
| --------------------------- | -------------------------- |
| `eva.loop.context.default`  | host slot `context`        |
| `eva.loop.compaction.basic` | host slot `compaction`     |
| `eva.loop.prompt.base`      | host domain `systemPrompt` |
| `eva.loop.schedule.default` | host slot `schedule`       |
| `eva.loop.retry.backoff`    | host slot `retry`          |
| `eva.loop.inbox.default`    | host slot `inbox`          |

**Agents, commands, appearance**

| Plugin id      | Package        | Contributes                                                  |
| -------------- | -------------- | ------------------------------------------------------------ |
| `eva.agents`   | `eva-agents`   | built-in agent definitions                                   |
| `eva.commands` | `eva-commands` | `/model`, `/cost`, `/clear`, `/sessions`, `/help`, `/plugin` |
| `eva.themes`   | `eva-themes`   | built-in themes                                              |
| `eva.keymap`   | `eva-keymap`   | default key bindings                                         |

**Surfaces**

| Plugin id   | Package     | Contributes                               |
| ----------- | ----------- | ----------------------------------------- |
| `eva.api`   | `eva-api`   | the session API over HTTP and stdio       |
| `eva.tui`   | `eva-tui`   | calls the Session API, drives `Renderer`  |
| `eva.print` | `eva-print` | non-interactive output for `--print`      |
| `eva.web`   | `eva-web`   | the web interface, served from the binary |

### 9.3 Package naming

| Category        | Package name pattern               | Plugin id    |
| --------------- | ---------------------------------- | ------------ |
| Core            | `@missingstudio/eva-{name}`        | —            |
| Internal plugin | `@missingstudio/eva-{name}`        | `eva.{name}` |
| Third-party     | `@missingstudio/eva-plugin-{name}` | any string   |

`eva-plugin-*` marks a package written against the public SDK. Core packages and
internal plugins ship `"private": true` until the SDK is stable. The plugin id
in config is always the plain dotted form. The package name never appears in
user config.

## 10. Configuration

One file format, YAML. One entry shape for a plugin, whether it is internal or
external.

```yaml
# ~/.eva/config.yaml
model: anthropic/claude-sonnet-5

plugins:
  # A string enables a plugin with no options.
  - eva.tool.web

  # An object carries options. They arrive as ctx.options.
  - id: eva.trace.sqlite
    options: { path: "~/.eva/trace.sqlite" }

  # A package that is not built in. Resolved with bun, then loaded.
  - id: acme.reviewer
    package: "@acme/eva-plugin-reviewer"

  # disabled removes a plugin. It accepts a wildcard.
  - id: eva.provider.*
    disabled: true
  - id: eva.provider.anthropic
    disabled: false

profiles:
  default:
    harness: eva.harness.loop
    tools: [read, edit, grep, "bash:test/*"]
    budget: { usd: 2.0, minutes: 15, steps: 40 }
```

The list is walked left to right. A later entry for the same id wins: it sets
the fields it names and keeps the rest, so the entry above turns
`eva.provider.anthropic` back on without restating its package or options.
`{ id: "*", disabled: true }` boots the bare kernel.

Everywhere else the merge is per key: a mapping merges key by key, a scalar
replaces, and a list replaces whole. So a project file that names one agent
changes that agent and leaves the others alone, and one field of an agent can
be overridden without restating the rest. The plugin list is the one exception,
because the layers concatenate it instead of replacing it — a list that
replaced whole would drop every plugin a lower layer named. A field of an entry
still replaces as a unit: a later `options` is the whole options, never a deep
merge of two, because half of two entries is a plugin nobody wrote.

Every leaf remembers the file that set it. `eva config show` prints the
resolved config, the source beside each key, and the plugins that would load —
before the kernel boots, so a config naming a plugin nobody has still prints.

We previously wrote this as a string grammar (`"-eva.provider.*"`) and claimed
it came from the first reference. It does not. That harness has no such grammar
— and no disable flag on plugin entries at all: its `plugins` key is an ordered
list of `string | { package, options }` entries, and disabling means removing
the entry. The per-item `disabled` boolean comes from the second reference's
plugin framework — `EntryOptions.disabled`. The
string form also had no place to put per-plugin options, which both references
need and so do we. The object form above is one shape that carries id, options, package,
and disabled together.

Config resolution order, later wins:

1. built-in defaults
2. each bundle listed in the profile, in list order
3. the profile's own `eva.config.yaml`
4. `~/.eva`, then `~/.eva/config.yaml`
5. `EVA_CONFIG_DIR`, then its `config.yaml`
6. each trusted project `.eva`, then its `config.yaml`, nearest last
7. `--config <path>` overlays, in argv order
8. `EVA_CONFIG_CONTENT`, config carried in the environment
9. `--plugin`, `--without-plugin`, and `--model` flags

Every step is a layer, step 9 included: the flags merge as one mapping whose
origin is `the command line`, so a flag carries provenance like a file does and
`eva config show` no longer names the file a flag overrode. One module,
`resolveConfiguration`, holds the whole order and takes its directory and its
environment as arguments — nothing about the order reads the process.

Everything but steps 2 and 3 is what this tree resolves. Those two need bundles
and profiles, which do not exist yet; the order above is where they land when
they do, and there is one place to add them.

`EVA_CONFIG` replaces the path at step 4 rather than adding a layer over it — a
hermetic run depends on the replacement, because a bare kernel given a named
config must not inherit the machine's file, and `--config` is the flag that
overlays. A directory and its config file are two layers, and the file is
second: the file is the one place a person goes to override, so it wins over a
resource the same directory discovered.

A directory holds the resources beside its config file, because an agent prompt
wants to be a Markdown file rather than a YAML string:

```
.eva/
├── config.yaml
├── agents/review.md      YAML frontmatter, then the prompt
├── commands/deploy.md    the description, from frontmatter or the first line
└── themes/dusk.yaml      a name and its colours
```

Each file becomes a row keyed by its base name, and joins the same mapping the
config file produces — one merge law covers both, and the origin table names
either source. A directory that is not there holds nothing, which is not an
error. There is no directory for a concept the tree does not have yet, because
empty structure invites occupants.

A project `.eva` is read only after a grant, because it can name plugins to
load and naming a plugin is naming code. The walk goes up from the working
directory, nearest last, and stops at the repository boundary — a `.eva` above
a checkout is somebody else's. The boundary is checked after the directory's
own entry, so the repository root's own `.eva` is found rather than cut off by
the `.git` that marks the root.

The grant is `eva trust`, and it records the directory in a file beside the
person's own config — never inside the directory it trusts. A repository that
ships a file claiming to be trusted is a repository making a claim about
itself, which is the shape of the attack. A grant covers the directories below
the one it names, so one checkout is one grant; two clones are two grants. An
ungranted directory still runs, and the run says which files it did not read,
because a silently ignored file is not a valid outcome.

The kernel validates only the shape it owns — that `plugins` is a list, and
each entry a string or an object with an id — and carries every other key
through untouched, because interpreting config is `eva.config`'s job and a
strict whole-file decoder would make each new plugin option a kernel change.
What that costs is a typo reaching nothing in silence, so each plugin declares
the top-level keys it reads beside its id, and a run reports the rest against
the file that set them, with the key it most likely meant.

A declaration is data rather than a registration, so the sweep folds the
resolved plugin table and still answers before the kernel boots. The kernel
declares `plugins`, `eva.config` declares the keys it projects, and the TUI
surface declares `theme` — which is why disabling that surface makes `theme`
a key that reached nothing. What a run did not read is a `Finding`, so the
terminal, `eva config show`, and a surface across a socket report one answer.

A name is only half of that. `theme` names one theme and `themes` holds the
themes there are — one selects, one defines, and the two differ by a letter. A
key written in a shape nothing reads is named the same way, with the key that
would have taken the value as written, so `themes: dusk` is told to say
`theme`. An unrecognized flag is reported on the same rule.

## 11. Bundles and profiles

A **bundle** is an npm package that contributes plugins. A **profile** is a
directory describing one runnable composition. This is the second reference's
model, format included. Only `package.json` stays JSON, because npm owns it; its
`eva.bundle` field points at the YAML file.

```
hello-plugin/
├── package.json       declares eva.bundle
├── eva.config.yaml    the config layer applied when a profile lists this bundle
└── index.js
```

```json
{
  "name": "@missingstudio/eva-plugin-hello",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "eva.config.yaml"],
  "eva": { "bundle": { "config": "./eva.config.yaml" } }
}
```

```yaml
# eva.config.yaml
plugins:
  - id: eva.hello
    package: "@missingstudio/eva-plugin-hello"
```

```yaml
# ~/.eva/profiles/demo/eva.profile.yaml
name: demo
bundles: ["@missingstudio/eva-base", "@missingstudio/eva-plugin-hello"]
```

A profile directory holds `eva.profile.yaml` — the profile's name and its
bundles — and may hold its own `eva.config.yaml`, the overlay applied at step 3
of §10's resolution order. Stage 7's `fixer` profile is one such overlay.

```bash
eva plugin --profile demo add ./hello-plugin
```

```bash
eva --profile demo config show
```

A git install fetches sources and runs no lifecycle script. Bun does not run a
dependency's `postinstall` unless the package is listed in
`trustedDependencies`. `eva plugin add` installs untrusted and prints the
package whose build it skipped. Keep that default. Pin a commit SHA so a later
push cannot change what runs at install time.

## 12. The harness contract

A **harness** owns a tool-calling loop. Eva's own loop is one. Every surveyed
harness — the two references and the vendor CLIs alike — is another. One
contract covers every one of them, and that contract is the **Agent Client
Protocol (ACP)**.

Eva does not invent a harness interface. It adopts ACP, shapes it in Effect, and
implements **both halves**: the agent half in `eva.harness.loop`, and the client
half in the kernel and the slots.

### 12.1 Why we dropped the Go tree's contract

The Go tree defined a harness as one method:

```go
Answer(ctx context.Context, prompt Prompt) (core.Outcome, error)
```

That is too loose, in three ways, and the third is fatal.

**One-shot, but a harness owns sessions.** `Answer` starts, runs, returns. A
foreign CLI owns a long-lived session you attach to, list, fork, and resume. You
cannot model `eva branch <session>@12` on top of a function that only returns a
result.

**One-way, but a harness talks back.** A real harness asks for permission before
a tool runs, and asks the user questions mid-Run. `Answer` has one output
channel — the return value — and an `arriving` callback for text. There is
nowhere for a question to go and nowhere for an answer to come from.

**It gives a harness no way to report what it did, or to be told no.** This is
the one that breaks the product. `Answer` returns an Outcome; it carries no
permission request and no typed record of the work. Eva's policy gate and Eva's
trace would then apply to Eva's own loop and to nothing else. `eva task run
EVA-142 --race` across Eva's loop and two vendor harnesses would compare three
harnesses under three different sets of rules, with only one of them recording
anything. **The
comparison would be worthless**, and the comparison is the entire point of stage
9c.

Note what this argument does **not** claim. It does not claim that a protocol
can stop a harness from touching the disk on its own — §12.2a says why nothing
at this seam can, and where containment actually comes from.

### 12.2 The protocol is symmetric, and that is why we want it

ACP is not a one-way API. It has an **agent half** — what a harness implements —
and a **client half** — what the host provides to the harness. The agent does
not own the filesystem, the terminal, or the permission decision. It asks.

That maps onto Eva's extension points with no adapter layer at all:

| ACP client method                         | Eva implements it with          | What Eva gets                                       |
| ----------------------------------------- | ------------------------------- | --------------------------------------------------- |
| `requestPermission`                       | the `tool.execute.before` hook  | one deterministic policy gate for **every** harness |
| `elicit`                                  | `needs_human` and `resolved`    | one inbox for questions, whoever asked              |
| `readTextFile`, `writeTextFile`           | the `FileSystem` slot           | edits recorded **when the agent chooses to ask**    |
| `createTerminal` + the terminal lifecycle | the `Shell` and `Sandbox` slots | terminals recorded on the same condition            |
| `sessionUpdate`                           | the `Recorder` slot             | one trace, in one schema                            |

Implement the client half once and every harness reports into one trace and
answers to one policy gate. One code path, expressed as a protocol rather than
as a convention we would have to keep re-enforcing.

### 12.2a What the client half does not buy

The two middle rows of that table are weaker than the rest, and the difference
decides where containment lives.

**`fs/*` and `terminal/*` are capabilities an agent MAY use, not obligations.**
A client offers them at `initialize`; an agent with its own file and shell tools
is free to ignore them and usually does. This is not a v2 risk or one vendor's
quirk. Check the agent we plan to drive with no adapter at all — a leading
native ACP agent:

```
the surveyed harness's permission-mapping module, line 18
  Partial<Pick<AgentSideConnection, "requestPermission" | "writeTextFile">>
the surveyed harness's permission-mapping module, line 110
  void this.input.connection.writeTextFile({ … })   // renders a diff
```

That is everything this agent takes from the filesystem and terminal
half — both methods optional and runtime-guarded. No `readTextFile`, no
`createTerminal`, no terminal lifecycle. The one `writeTextFile` shows the user
a diff; it is not the write path. (`requestPermission` and `sessionUpdate` it
uses constantly — those are the rows that carry the comparison, and this section
is about the others.) It reads files and runs commands with its own tools,
in its own process, today, against ACP v1 (SDK 0.21.0, checked 2026-08-14).

One surveyed editor client's vendor adapter does the opposite — it replaces the
agent's `Read` and `Write` with client calls, so the host really does see every
access. Both are conformant. **Whether a harness routes through the client half is a property of
that harness, not of the protocol**, and a design that assumes otherwise is
assuming a promise nobody made.

**So containment is not a stage 9c property. It is a stage 4 one.** The
`Workspace` and `Sandbox` slots bound what a process can touch whether or not it
ever calls `fs/write_text_file`. That is how the field solves this: the field's
production orchestrators isolate by worktree, not by protocol. Eva already
builds that boundary at stage 4, and it is the boundary `--race` must rely on.

What the client half is still worth: **the permission gate and the trace**.
Every ACP agent implements `requestPermission` and `sessionUpdate`, because a
harness that does neither cannot be driven at all. Those two rows carry the
comparison. The filesystem rows carry fidelity, and fidelity varies per harness,
so `eva.harness.conform` measures it rather than assuming it.

### 12.3 The agent half — what a harness implements

This is the shape a harness implements when stage 9c registers the first one.
`packages/core/src/harness.ts` today holds the subset a native harness needs —
`id`, `capabilities`, `initialize`, `createSession`, `resumeSession`, `prompt`,
`cancel`, and `updates`. The rest lands with the row that needs it, and `Harness`
itself did not change when the harness domain gained a runnable row: what a
native harness is handed is §12.3b, not a second contract.

```ts
export interface Harness {
  readonly id: string
  readonly capabilities: AgentCapabilities

  /** Exchanges capabilities. Eva passes the client half it will honor. */
  readonly initialize: (client: HarnessClient) => Effect.Effect<InitializeResult, HarnessError>
  readonly authenticate: (method: AuthMethodID) => Effect.Effect<void, HarnessError>

  // Sessions. A session outlives a Run, and the scope owns its lifetime.
  readonly createSession: (
    input: CreateSession,
  ) => Effect.Effect<SessionID, HarnessError, Scope.Scope>
  readonly loadSession: (id: SessionID) => Effect.Effect<SessionInfo, HarnessError>
  readonly listSessions: Effect.Effect<readonly SessionInfo[], HarnessError>
  readonly forkSession: (id: SessionID, at?: Cursor) => Effect.Effect<SessionID, HarnessError>
  readonly resumeSession: (id: SessionID) => Effect.Effect<ResumeResult, HarnessError>
  readonly closeSession: (id: SessionID) => Effect.Effect<void, HarnessError>

  // Mid-session configuration. The model is one category of config option —
  // the protocol removed its dedicated set_model method.
  readonly setSessionConfigOption: (
    id: SessionID,
    option: ConfigOptionChange,
  ) => Effect.Effect<void, HarnessError>
  readonly setMode: (id: SessionID, mode: ModeID) => Effect.Effect<void, HarnessError>

  // The Run.
  readonly prompt: (id: SessionID, prompt: Prompt) => Effect.Effect<StopReason, HarnessError>
  readonly cancel: (id: SessionID, cause: CancelCause) => Effect.Effect<void>

  /** Everything the harness reports, as one stream. */
  readonly updates: Stream.Stream<SessionUpdate>
}

/** Why a Run stopped. A refusal is not an error, and neither is a cap. */
export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"
```

`eva.harness.loop` implements this in-process. `eva.harness.acp` implements it
over stdio JSON-RPC for every agent that speaks the protocol — some natively,
others through maintained bridges or a vendor's own ACP server. An
`eva.harness.<vendor>` entry is a launcher extension over such a bridge or
server, not a second contract.
The transport differs. **The contract does not**, and that is what the Go tree's
version could not give us.

Eva's own harness holds no privileged position. It is one row in the harness
domain, disabled by config like any other, and the `--race` command has no way
to tell it apart from the rest.

### 12.3a Eva's harness is a host plugin

`eva.harness.loop` is not a monolith. It is a **host plugin**: it loads plugins
of its own and exposes host-scoped extension points to them.

It will expose six. Five are slots — `context`, because context assembly is a
research area; `compaction`, because the strategy differs per model and per
task; `schedule`, because parallel-safety policy is swappable; `retry`, because
providers need different policies; and `inbox`, because steering semantics are a
choice. One is a domain — `systemPrompt`, because many plugins contribute
instructions to it and they have to compose in a defined order. The plugins that
fill them are in the package inventory above.

**None of the six exists yet, and that is deliberate.** The plugin as it stands
hosts nothing: what each point is for is a swap there is no second
implementation of, and five empty slots nobody fills is scaffolding a reader has
to guess about. Each of the six is a parameter of `LoopDeps` today — the tool
rows, the prompt rows, the Catalog, the Budget, and the two ceilings — read at
the point of use and never captured, so cutting one into a host slot is a change
inside the plugin and not a rewrite. The system prompt is already a **prompt
row** rather than a constant, under the id `loop.system`, so a person replaces it
by config before the host domain exists.

Two of the six have an owner outside the loop today, and the loop duplicates
neither: `schedule` is `eva.sched`'s policy over `executeToolGroup`'s ceiling,
and `retry` is `eva.provider.retry`'s hook. When the host points land, those
become per-instance rather than per-process.

This is the shape both references arrived at. The second reference's
`agent-loop` is one row among 78 in its base bundle, sitting beside
`compaction-basic`, `system-prompt`, and `session-title` — each of them
replaceable on its own. The first reference gives every plugin `ctx.plugin.add`
for the same reason.

The alternative is a loop you can only replace, never adjust: changing how Eva
compacts would mean forking the harness. Because these points are host-scoped
and isolated per instance, five live harnesses have five compaction strategies,
and swapping Eva's compaction touches no other harness.

**A foreign harness is a host too, when it wants to be.** A vendor extension
may wrap a system that has its own plugin ecosystem.
An adapter may expose those as host-scoped points, so that system's own plugins
keep working under Eva. Eva does not flatten another system's extensibility
into a single opaque row.

### 12.3b What Eva hands a native harness

A harness that runs in this process has no wire and no model access of its own,
so Eva hands it one contract of two members. This is the in-process transport of
§12.8, and it is the whole of it.

```ts
// packages/core/src/harness.ts
export interface HarnessHost {
  readonly run: (input: RunInput) => Effect.Effect<RunResult>
  readonly report: (payloads: readonly Payload[]) => Effect.Effect<void>
}
```

`run` is `submit` with the kernel's slots and hooks bound. It is the only thing
here that opens a Run and the only thing that closes one, so a native harness
gets the same Recorder open, block grouping, provider hooks, Budget charge and
close-on-interrupt every other caller gets.

**A harness that wants tools reaches them through `run`, and the contract stays
two members.** A Step is one model request plus the tool executions its response
causes, and that is one Run: the harness names its tools on `RunInput.tools`,
the Run runs the calls that response proposed, and `RunResult.calls` answers
each proposal beside what the tool said. So the three records of a call commit
inside the Run that proposed them rather than after it closed, and a third
member handing a harness the execution would be a second thing here that writes
into a Run.

`report` commits one group through the same Recorder, outside any Run. The
second member is there for one reason: a `verdict` is known only after the Run
that produced the Candidate has closed, and it has to be on the Trace before a
Repair is paid for. Without it an interrupt loses the first-pass record, and a
rate measured from the Trace then counts fewer Candidates than ran.

`HarnessInfo.open` is what a plugin fills to receive it, and a row without
`open` names a harness the build knows of and cannot run. `SessionAPI.submit`
refuses an unknown id at selection with a failed Claim and a near miss, and
resolves no model. The Claim is classed `other`, the way a cancelled Run is: the
eight Error Classes name provider faults, and this Run reached no provider.

**A native harness's `updates` is `Stream.empty`, because it has no wire.** The
field's own comment ties it to the wire format, and `payloads` in the acp
package is what reads it. Synthesizing ACP updates so that reader could run
would renumber block indices a Provider Turn already assigned, and it would give
the seam a second record path. Empty is the truthful value, not a gap. The
client half goes unused for the same reason: the tool execution's own gate is
what reaches a person, so a native harness never calls `requestPermission` even
when it does have tools, and one with no wire never calls `sessionUpdate`.

A refusal is itself a Run, so `SessionAPI.submit` opens and closes one without
taking a Provider Turn. That is the only Run boot opens outside `submit`, and no
harness reaches it — it runs before a harness exists.

### 12.4 The client half — what Eva provides

```ts
export interface HarnessClient {
  readonly capabilities: ClientCapabilities

  /** The harness wants to run a tool. Eva's policy gate answers. */
  readonly requestPermission: (request: PermissionRequest) => Effect.Effect<PermissionOutcome>
  /** The harness wants to ask the user. Eva records needs_human and routes it. */
  readonly elicit: (request: ElicitRequest) => Effect.Effect<ElicitOutcome>

  readonly readTextFile: (request: ReadTextFile) => Effect.Effect<string, ClientError>
  readonly writeTextFile: (request: WriteTextFile) => Effect.Effect<void, ClientError>
  readonly createTerminal: (
    request: CreateTerminal,
  ) => Effect.Effect<Terminal, ClientError, Scope.Scope>

  /** Everything the harness reports lands here, and the Recorder commits it. */
  readonly sessionUpdate: (update: SessionUpdate) => Effect.Effect<void>
}

/** ACP's four options. The "always" axis is persistence, not strictness. */
export type PermissionOutcome =
  | { readonly kind: "allow_once" }
  | { readonly kind: "allow_always" }
  | { readonly kind: "reject_once"; readonly reason: string }
  | { readonly kind: "reject_always"; readonly reason: string }
```

Note that ACP's permission vocabulary is richer than the `allow | deny | ask` we
had. The `_once` and `_always` variants separate **the decision** from **how
long it persists**, which is what a per-session approval needs. Eva's
deterministic gate returns the decision; the persistence axis is what a
`allow_always` writes into the profile. The gate stays deterministic and
testable in CI: it is an ordinary hook, and the strictest decision wins.

### 12.5 Capability negotiation

ACP negotiates in both directions at `initialize`, with optional booleans. A
capability that is absent is a capability that is missing, and both sides
degrade rather than fail.

```ts
export interface AgentCapabilities {
  readonly loadSession?: boolean
  readonly auth?: { logout?: LogoutCapabilities }
  readonly promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean }
  readonly sessionCapabilities?: {
    /** Without this, `eva resume` can promise nothing. */
    resume?: SessionResumeCapabilities
    fork?: SessionForkCapabilities
    list?: SessionListCapabilities
    close?: SessionCloseCapabilities
  }
  readonly mcpCapabilities?: { http?: boolean; sse?: boolean }
}

export interface ClientCapabilities {
  readonly fs?: { readTextFile?: boolean; writeTextFile?: boolean }
  readonly terminal?: boolean
  readonly auth?: { terminal?: boolean }
  readonly elicitation?: ElicitationCapabilities
}
```

### Which parts of the protocol are settled

Eva targets **ACP v1** — what every shipped implementation speaks today. The
protocol version is still 1; v2 exists as a draft and is labelled unstable. This
table tracks a moving line, so it carries the version it was checked against:
**`@agentclientprotocol/sdk` 1.3.0**, the release `packages/acp` pins and a test
holds. The field runs behind it — 0.21.0 in one surveyed harness, 0.25.1 in
another, both checked 2026-08-14.

| Settled                                         | Marked unstable                 |
| ----------------------------------------------- | ------------------------------- |
| `session/new`, `session/load`, `session/list`   | `session/fork`                  |
| `session/prompt`, `session/cancel`              | `usage_update` and session cost |
| `session/request_permission`                    | `auth.logout`, `auth.terminal`  |
| `fs/*` and `terminal/*`                         |                                 |
| `session/set_mode`, `session/set_config_option` |                                 |
| `session/resume`, `session/close`               |                                 |
| elicitation, both form and URL                  |                                 |

Three of these moved in our favour since we first wrote this down. `session/list`
stabilized at 0.11.1, `session/resume` and `session/close` at 0.12.2, and
`session/set_config_option` at 0.10.8. Elicitation is not marked unstable
either. **`session/fork` is the only thing Eva leans on that is still a draft.**

One moved against us: **`session/set_model` was removed, not stabilized.** The
dedicated session model API is gone, and the model is now one category inside
`session/set_config_option`. Anything reaching for `setModel` targets a method
that no longer exists.

**This bounds what stage 7 may promise, and the roadmap says so.** `eva branch`
rests on `session/fork` and is the one session verb still standing on a draft.
`eva resume` and `/mode` now rest on settled ground, and `/model` mid-session is
a config option rather than a method of its own.

**v2 is drafted and it moves things Eva depends on.** It removes `session/load`
in favour of `session/resume` with a `replayFrom` cursor; it removes the session
modes API entirely — `modes`, `session/set_mode`, `current_mode_update` — in
favour of config options; it collapses `tool_call` and `tool_call_update` into
one upsert keyed by `toolCallId`; it replaces `Diff` old/new text with git patch
format plus structured file operations; it makes resume, list and close required
rather than negotiated; and it adds a `state_update` notification carrying the
stop reason and usage, so `session/prompt` acknowledges immediately rather than
returning a result.

**And it removes `fs/*` and `terminal/*`, making the terminal agent-owned** —
the client sees display-only output behind a `terminalId`. Read that carefully:
it is not a transport change, and an earlier draft of this document was wrong to
call it one. v2 does not move Eva's filesystem behind MCP; it hands the
filesystem to the agent. Since §12.2a already establishes that the client half
never guaranteed containment in the first place, v2 removes something Eva was
not entitled to rely on. What Eva does rely on — `requestPermission` and
`sessionUpdate` — v2 keeps, and `state_update` improves.

So the v2 migration is bounded, and the bound is in the sealed union rather than
in the client half. §13 says which payload kinds are exposed and what we do
about it.

This capability negotiation is also the mechanism behind the honesty rule. A
harness that cannot fork a session says so, and `eva branch` reports `degraded`
naming `sessionCapabilities.fork` instead of failing or, worse, silently doing
nothing. The survey's widest orchestrator reports that the silent case is the
common one: across its 21 supported backends, reasoning effort is honored by
exactly six, and the rest "ignore the field rather than fail". Negotiated
capabilities turn that silence
into a recorded fact.

### 12.6 What ACP does not carry

ACP covers the harness boundary. It does not cover everything Eva needs, and the
gaps are filled in two ways.

**Through `_meta` and `ext`.** Every ACP message carries an optional `_meta`
map, and the protocol has `extRequest` and `extNotification` for whole methods.
Eva's own concepts — `Spec`, `Claim`, budget state, verifier evidence — ride
there under an `eva.` namespace. They travel with the session and a harness that
does not understand them ignores them.

**Through Eva's own additions to the live handle.** ACP's `prompt` is one Run
in, one stop reason out. The second reference's `Agent` shows what a
long-running agent also needs, and Eva adopts these on top of the protocol —
renaming its `next-turn` inbox target to `next-run`, because the bare word
is retired:

```ts
export interface HarnessInstance {
  readonly harness: Harness
  readonly status: "idle" | "running"

  /** Steering. Routes input to a boundary instead of starting a Run. */
  readonly send: (
    message: UserMessage,
    target: "next-run" | "next-step",
    wakeup: boolean,
  ) => Effect.Effect<void>
  /** Resolves when no Run and no maintenance task remains. */
  readonly whenIdle: Effect.Effect<void>
  /** Runs non-Run work — compaction, titling — from the true idle phase. */
  readonly runMaintenance: <A>(task: Effect.Effect<A>) => Effect.Effect<A>
}
```

`send(message, "next-step", …)` is the primitive under stage 2's steering rule:
mid-Run input lands after the current provider response and tool group complete
structurally, and nothing is orphaned. It is an inbox boundary, not an interrupt.

**Resume honesty is Eva's, not ACP's.** ACP has `resumeSession`; it does not say
what happens when the resume is refused. The survey's widest orchestrator gives
the answer to copy:

```ts
export type ResumeResult =
  | { readonly kind: "resumed"; readonly session: SessionInfo }
  | { readonly kind: "rejected"; readonly reason: string }
  /** The adapter genuinely cannot tell. This is not the same as "resumed". */
  | { readonly kind: "undetectable" }
```

`undetectable` is the field that keeps the system honest. When an adapter cannot
tell whether a resume took, it says so, and the decision to start fresh moves up
to the layer that knows whether this run was a resume at all. Encode that
judgment in one provider-agnostic place. Do not encode it in each adapter.

### 12.7 An adapter is a record, not a slot

Eva needs many live instances of the same harness kind — five sessions of one
vendor harness in five worktrees. A slot holds one implementation, so a harness cannot
be a slot.

The `harness` domain holds **factories**. A registry owns the `Map<InstanceID,
HarnessInstance>`. An instance is torn down by closing the scope it was created
in. A third surveyed harness reached the same conclusion for the same reason
and says so in its driver SPI: service keys are singleton-per-runtime, and
drivers are not.

### 12.8 Three transports, one contract

| Transport      | Used by                             | How                                                  |
| -------------- | ----------------------------------- | ---------------------------------------------------- |
| In-process     | `eva.harness.loop`                  | direct calls; no serialization                       |
| Stdio JSON-RPC | `eva.harness.acp`, and every vendor | the ACP wire format                                  |
| Eva as agent   | external ACP clients                | `eva serve --acp` exposes Eva's loop as an ACP agent |

The third row is the one that is easy to miss and cheap to get. Because
`eva.harness.loop` implements the agent half, Eva can **be** a harness for
someone else's client. Adopting the protocol makes Eva adoptable, not only
adopting.

**Vendor extensions do not disappear, but full adapters mostly have.** Some
vendor harnesses do not speak ACP from their own CLIs, but each has a bridge
maintained under the protocol's organisation, over the vendor's own agent SDK
or app server. Eva drives those, so an `eva.harness.<vendor>` entry carries
launch arguments, auth, and capability probing rather than an output parser.

That is the shape the third surveyed harness arrived at: a first-class ACP
runtime with vendor extensions beside it, plus env-gated CLI probes.
**Do not plan for one adapter that covers everything.** Plan for one runtime and
several small extensions, and keep the extension free of protocol logic — the
day a vendor's differences vanish, deleting the extension should change nothing
above it.

**Pin the protocol version.** ACP is a moving standard. Treat the version the
way the event schema treats `schemaVersion`: pinned, negotiated at `initialize`, and changed
deliberately.

## 13. The event schema

The payload set is a closed discriminated union.
It is exhaustive at the type level, and it is the contract the harness seam holds every
harness to.

**The union must carry an ACP session with no loss.** This is a hard
requirement, not a nice-to-have. If a payload kind is missing, every adapter
emits `unknown` for it, the trace stops being a faithful record, and the
cross-harness comparison at roadmap stage 9c compares incomplete traces. The Go
tree's union predates ACP and does not meet this bar. Here is the gap and the
fix:

ACP v1 defines eleven `sessionUpdate` kinds. Every one of them maps, and a kind
we did not map is a kind every adapter would silently drop:

| ACP session update          | Payload kind                             |
| --------------------------- | ---------------------------------------- |
| `agent_message_chunk`       | `text`, with content blocks              |
| `agent_thought_chunk`       | `thought`                                |
| `user_message_chunk`        | `message` — carries mid-Run steering     |
| `tool_call`                 | `tool_call`, with `id`, `kind`, `status` |
| `tool_call_update`          | `tool_update` — the status transitions   |
| `plan`                      | `plan`                                   |
| `current_mode_update`       | `mode`                                   |
| `available_commands_update` | `commands` — what the harness advertises |
| `config_option_update`      | `config` — the mode and model options    |
| `session_info_update`       | `info` — the title and the last activity |
| `usage_update`              | `info` — the cost so far, when USD       |
| stop reason on Run end      | `finished.stopReason`                    |

```ts
// packages/schema/src/payload.ts

/** ACP content. Text is the common case; the rest must survive the trace. */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string; uri?: string }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "resource_link"; uri: string; name: string; mimeType?: string; size?: number }
  | { type: "resource"; resource: EmbeddedResource }

export type ToolStatus = "pending" | "in_progress" | "completed" | "failed"
export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other"

export type Payload =
  | { kind: "started"; intent: string }
  | { kind: "text"; block: number; content: ContentBlock }
  /** Reasoning. Separate from text: it is shown differently and priced differently. */
  | { kind: "thought"; block: number; content: ContentBlock }
  /** A user message inside a run — the steering path, not the opening prompt. */
  | { kind: "message"; content: ContentBlock; target: "next-run" | "next-step" }
  | {
      kind: "tool_call"
      id: string
      name: string
      tool: ToolKind
      args: unknown
      status: ToolStatus
      redacted: boolean
    }
  /** A tool call is a lifecycle, not two events. This carries the transitions. */
  | { kind: "tool_update"; id: string; status: ToolStatus; content?: readonly ContentBlock[] }
  | { kind: "tool_result"; id: string; name: string; disposition: Disposition; bytes: number }
  | { kind: "plan"; entries: readonly PlanEntry[] }
  | { kind: "mode"; mode: string; reason?: string }
  /** The harness advertised its slash commands. */
  | { kind: "commands"; commands: readonly HarnessCommand[] }
  /** A session config option changed — the mode or model select. */
  | { kind: "config"; options: readonly ConfigOption[] }
  /** Session metadata: title, last activity, and running cost. */
  | { kind: "info"; title?: string; updatedAt?: string; costTicks?: number }
  | {
      kind: "usage"
      /** Keyed by model: one Run can span several. */
      model: string
      inputTokens: number
      outputTokens: number
      cacheWriteTokens: number
      cacheReadTokens: number
      reasoningTokens?: number
      serverToolTokens?: number
      /** The provider's own figure, in ticks of 1e-10 USD. Never computed. */
      costTicks?: number
    }
  | { kind: "retry"; attempt: number; max: number; delayMs: number; errorClass: ErrorClass }
  | { kind: "edit"; path: string; hunks: number }
  | { kind: "needs_human"; question: string; resume: Cursor }
  /** Answers the `needs_human` it names. The pair is what an inbox folds. */
  | { kind: "resolved"; question: EventID; resolution: Resolution; content?: ContentBlock }
  | { kind: "finished"; claim: Claim; stopReason: StopReason }
  | { kind: "degraded"; missing: string[] }
  | { kind: "unknown"; originalKind: string; raw: unknown }
```

Rules the record holds:

- The union is closed. A `switch` over `kind` with no `default` is exhaustive.
- `unknown` preserves what we could not parse. We never drop an event.
- Usage counters are nullable. Silence is not zero.
- A tool result carries a disposition, not a boolean.
- A Question and its answer are both records, so an inbox is a fold.
- `seq` is the only sequence, and the sink assigns it at commit.
- Every projection of the record is a fold, and they live together in
  `packages/schema/src/fold.ts` — the transcript, the cost, the Header, the
  verdict summary, what a Harness answered, and the coalescing rule the Trace
  and the transcript both use. One golden reviews them all.

Three rules the harness contract adds:

**Cost comes from the provider, and it is an integer.** `costTicks` holds what
the provider said, in ticks of 1e-10 USD. Token count times rate cannot
reproduce request-level pricing: a provider that bills at 2x once a prompt
passes 200K tokens is invisible to a per-token estimate, because a usage record
aggregates every model call in a Run. A float loses sub-cent precision on the
way to storage. Absent means not reported — not zero, and not "estimate it".

**A stop reason is not an error class.** `end_turn`, `max_tokens`,
`max_turn_requests`, `refusal`, and `cancelled` say why a Run ended. A refusal
is a legitimate outcome and a token cap is a budget fact. Neither is a failure,
and `Claim` already carries the failure question separately.

**`_meta` is not in the union.** ACP carries an open `_meta` map on every
message, and Eva's own concepts ride there under an `eva.` namespace. It does
not enter the sealed union, because a sealed union with an open map in it is not
sealed. An adapter that finds `_meta` it does not understand preserves it on the
envelope, not in the payload.

### 13.1 Three kinds are shaped by a v1 concept that v2 removes

The union above maps ACP v1 exactly, which is the right target. It also means
three kinds encode a v1 shape the draft deletes, and stage 6 freezes this schema
as a public contract. Name the exposure now rather than discover it then:

| Kind                      | v1 shape it mirrors            | What v2 does                                        |
| ------------------------- | ------------------------------ | --------------------------------------------------- |
| `mode`                    | `current_mode_update`          | removes the modes API; mode becomes a config option |
| `tool_call`/`tool_update` | the two-notification split     | one upsert keyed by `toolCallId`                    |
| `edit`                    | `Diff` with old text, new text | git patch format plus structured file operations    |

None of the three needs a different union today, and guessing at a draft is
worse than tracking a spec. What they need is a shape that survives the change:

- **`mode` stays a payload, and stops being protocol-shaped.** A mode is an Eva
  concept — stage 2 names four of them — that v1 happened to have a message for.
  Record the mode Eva applied, not the notification ACP sent. It then survives
  the modes API going away, and a v2 config option folds into the same kind.
- **`tool_update` is already an upsert.** It carries `id` and a status
  transition, so collapsing two notifications into one changes what an adapter
  emits and not what the trace holds.
- **`edit` records `path` and `hunks`, not the diff.** That is the one to hold
  the line on. The moment a diff body enters the union, the union owns a
  representation the protocol is actively changing.

The rule underneath all three: **a payload kind records what Eva observed, never
the wire shape it arrived in.** An adapter translates; the union does not
mirror. Hold that and a protocol revision is an adapter change, which is exactly
where change belongs.

The codec is zod, and the union above is the contract it decodes to. The two
are held together at compile time: each body is compared field for field
against its union member, so a body that drops a field, gives one the wrong
type, or carries one the union does not have fails to compile and names the
kind that drifted. Without that tie the only join between them was a cast, and
a cast to a twenty-member union accepts a supertype — which is what a body with
a missing field produces. Optional fields use `exactOptional`, so what the
reader returns matches what the union declares under
`exactOptionalPropertyTypes`.

Three round-trip tests gate the rest: **every committed fixture must decode,
re-encode stably at the current version, and fold to its reviewed golden**,
**every sample payload must come back field for field**, and **every ACP
session update must map to exactly one payload kind, with `unknown` reserved
for genuinely unmapped input.** The last is what stops the union from drifting
away from the protocol. Pin the SDK version it runs against, and treat a bump
as a reviewed change.

Nothing has shipped, so the reader carries no migration path and a record that
is not the current version is refused. It gains one the day a stored record
outlives a schema change — and that day it changes one module, because the
version is not on the in-memory `Event`. A record in memory is always the
current one, the reader refuses anything else on the way in, and the writer
stamps the version on the way out. The wire is the only place a version is a
fact.

## 14. Surfaces

A **surface** is a plugin that ships an interface: the terminal, `--print`, an
HTTP server, a web page. "Every user interface is a plugin" is only true if a
user interface has somewhere to plug in and something to plug into, so this
section says what both are.

This section says how a surface is built. What each one can do, and the test
that proves each of those, is [parity.md](parity.md).

Two contracts cross this seam, and they run in opposite directions. Keeping them
apart is the whole of the section.

| Contract        | Who implements it | Who calls it | Carries                                       |
| --------------- | ----------------- | ------------ | --------------------------------------------- |
| **Session API** | Eva               | the surface  | everything a surface does to Eva              |
| **Frontend**    | the surface       | Eva          | everything Eva needs from the person using it |

A single interface holding both directions cannot be implemented. It was written
that way once here, and the mistake is worth naming: an object that a surface
implements cannot also be the object that hands the surface its transcript.

### 14.1 Registering a surface

A surface is a plugin, so it registers like one. The `surface` domain holds one
entry per surface, and each entry is a factory — the same shape the `harness`
domain uses, and for the same reason: a surface is started, stopped, and
possibly run several times over, so it cannot be a slot.

```ts
// packages/sdk/src/domains/surface.ts
export interface SurfaceDraft {
  list(): readonly SurfaceInfo[]
  get(id: string): SurfaceInfo | undefined
  set(surface: SurfaceInfo): void
  update(id: string, update: (surface: SurfaceInfo) => void): void
  remove(id: string): void
}

export interface SurfaceInfo {
  id: string
  interactive: boolean
  streaming: boolean
  images: boolean
  /**
   * Starts the surface against the client runtime: the whole Session API,
   * plus the Run protocol over it. The scope owns its lifetime. A row
   * without it names a surface the build knows of but cannot run.
   */
  start?: (client: Client) => Effect.Effect<Frontend, never, Scope.Scope>
}
```

The composition root starts the surfaces the config selects and stops them by
closing their scopes. It picks the first row that is interactive and knows how
to start, so registration order decides. A build where no row qualifies says so
and exits non-zero, rather than exiting as though it had run.

Disabling `eva.tui` in config removes a row from a domain; nothing else in the
tree knows the difference.

A surface plugin declares the row; the terminal itself comes from
`packages/tui`, which the plugin layer may not import. The composition root
binds the two, and the binding is lazy: a `--print` run never opens a terminal,
and never loads a renderer this runtime may not support.

### 14.2 The Session API — what a surface calls

This is the whole of what a surface may do to Eva. It is the contract `eva.api`
exposes over a socket, and the contract `eva.tui` calls in the same process.
There is one of it.

```ts
// packages/core/src/session-api.ts
export interface SessionAPI {
  readonly create: (location: LocationID) => Effect.Effect<SessionID>
  readonly list: Effect.Effect<readonly SessionHeader[]>
  readonly retire: (session: SessionID) => Effect.Effect<void>

  readonly attach: (session: SessionID) => Effect.Effect<Transcript, never, Scope.Scope>
  readonly watch: (session: SessionID, from?: Cursor) => Stream.Stream<Payload>

  readonly submit: (session: SessionID, input: SubmitInput) => Effect.Effect<void>
  readonly cancel: (session: SessionID, cause: CancelCause) => Effect.Effect<void>

  readonly model: {
    readonly get: (session: SessionID) => Effect.Effect<ModelRef>
    readonly set: (session: SessionID, model: ModelRef) => Effect.Effect<void>
  }

  readonly answer: (request: RequestID, answer: FrontendAnswer) => Effect.Effect<void>
}
```

A surface reads **two** sources and never confuses them: `watch` while a Run is
open, `attach` for everything committed. The stream is never the record.

**All ten are on the socket, both halves.** `list`, `attach`, `watch` and
`model.get` are `GET`s; `create` is a `POST` on the listing, and `submit` and
`cancel` are `POST`s on the Session they act in; `model.set` and `answer` are
`PUT`s, because asking twice sets the same value, and `retire` is a `DELETE`
on the Session for the same reason. `create` is the one write that answers a
value, and its `location` is optional: a browser holds no honest path, so a
caller that names none opens the Session where the serving process is.

`retire` is what a person reaches for as deleting, and it cuts nothing. It
records that the Session was put away, and every listing honours that fact —
so the Session leaves the rail while `attach` still folds the whole record and
`watch` still follows it. A method that cut the Trace would be the one write
Eva could not explain afterwards, which is the rule "what a trace cannot
rebuild is a bug" read from the other end.

What travels is the contract's own shapes, with no envelope: a `SubmitInput`
body _is_ the Prompt, and a write answers a status and nothing else. A body the
wire cannot read is refused whole and never applied in part.

**Two routes on the socket are no `SessionAPI` call.** `GET /api/models`
answers what the serving process's Catalog knows, as the `PickRow`s
`modelRows` builds — the rows `/model` picks from in a terminal. A model is a
fact of the build and not of a Session, and a surface that holds no Catalog
has to be told the rows before it can offer them. `eva.api` reads the Catalog
from its own plugin context, so the wire reaches a Domain without importing the
plugin that fills it. A model is picked and never typed: `model.set` carries a
`ModelRef` and refuses a name, and `PUT /api/sessions/:id/model` refuses a
reference the Catalog does not hold. That refusal is the route's and not the
contract's — at a terminal an unlisted reference still runs, because a Provider
answers anything in its namespace, and `/model` reaches the Domains through the
command route below.

`POST /api/sessions/:id/command` is the other. It runs a line where the
Domains are, because that is where the rows and the Run both are: a door that
ran `/mode` for itself would change the approval state of its own process and
leave the Run under the mode it already had. The rows come from the same
plugin context the Catalog does.

**A write carries a client-minted key**, in an `Idempotency-Key` header rather
than in a body the no-envelope rule keeps clear. A write has no error channel,
so a call that cannot reach the far side waits and asks again — and a `submit`
whose answer was lost would otherwise open a second Run. The far side answers a
repeated key from the write it already made. It is also why a write runs on a
fiber of its own rather than inside the request: a dropped connection then
costs a repaint and not a Run, and the record is where the Run's outcome is.

### 14.3 The Frontend — what a surface implements

Everything Eva needs back from a surface fits here, and it is small on purpose.

```ts
// packages/sdk/src/frontend.ts
export interface Frontend {
  readonly id: string
  /** Eva needs a person: a permission decision or a question. */
  readonly ask: (request: FrontendRequest) => Effect.Effect<FrontendAnswer>
  /** Completes when the surface has stopped. The process waits on this. */
  readonly done: Effect.Effect<void>
}
```

What a surface can do is not here. It is declared once, on the `SurfaceInfo`
row in §14.1 — which is what picks a surface to start, and what decides whether
Eva may ask this surface anything. The same three booleans were once spelled on
the row and again on the `Frontend`, by hand, with nothing holding the two to
each other, and only the row was ever read.

One thing falls out. A surface that cannot ask a person declares
`interactive: false`, and the tool gate turns every `ask` into `reject_once`
rather than hanging — that is the same rule the harness seam uses, pointed at
the other side.

**A row that says `interactive: true` owes a way of knowing somebody is
there.** The flag is a claim about a person and not about a build: a surface
that declared it and then held every ask would stop a Run on a reader who left,
which is worse than one that declined. So the claim is answered by whatever
that surface uses to reach its person. `eva.tui` has a terminal, and a closed
input ends the surface. `eva.web` has a page that may be open or shut, so it
streams the questions that stand on the port it serves the page from and reads
that stream as presence: with no page reading, and again the moment the last
one goes, the ask is cancelled. **How a surface reaches its own person is the
surface's own business** — that channel is not a Session API method, because a
question nobody has answered has no position on the Trace. The answer comes
back through `SessionAPI.answer`, which is the door every surface writes
through.

**A permission request carries an id and a question, and no option list.** The
options are `PERMISSION_OPTIONS` in `packages/core`: Eva's gate offers all four
of ACP's options every time, so a request that carried them would carry the
same four words on every ask and a surface would have two places to read the
labels from. `FrontendRequest.permission`'s `id` is the `RequestID`, so a
surface answers either by returning a `{ kind: "permission", optionId }` from
`ask` or by calling `SessionAPI.answer` with that id — and the id is the tool
call's, which the `tool_call` record named first.

`eva.tui`, `eva.print`, `eva.api`, and `eva.web` each register a surface and
implement this. So does a third party, which is the point.

### 14.4 What makes a surface remote-capable

Nothing above needs a transport concept, and the word does not appear in this
seam — it belongs to the harness seam, where a harness really is reached two
ways. A surface is a plugin; a surface that runs somewhere else is a plugin that
speaks HTTP. `eva.api` is not a second way of reaching Eva — it is a surface
that re-exposes the Session API on a socket, so a remote surface calls the same
methods `eva.tui` calls in-process. The Go tree needed a transport layer because
it was one program with a wire bolted on; plugin-first dissolves that.

What remains are three constraints on the two contracts above. They are cheap
now and expensive to retrofit.

**Everything in `SessionAPI` and `Frontend` must survive serialization.** No
callbacks that close over process state, no handles that only mean something in
this address space. This is the same property out-of-process plugins need, so it
is one rule, not two.

**Local facts stay out.** Which editor is installed, what the working directory
is, whether a suggested remedy can run here — a remote client answering those on
the server's behalf would be lying. The membership test: if the answer depends
on which machine asks, it does not belong in the contract.

**Reconnect is by `Cursor`.** A surface that drops and returns resumes from the
last position it durably committed, so a dropped connection costs a repaint
rather than a Run. A `Cursor` is a trace position, and the trace position is the
only one there is. The client runtime holds this once, so no surface writes it:
on a restore it folds with `attach`, says the record replaced the stream, and
watches from that fold's own `at`.

Hold those three and remote-ready is a property Eva has rather than a feature it
adds. Break any one and every surface built meanwhile needs revisiting.

### 14.5 The terminal

`@missingstudio/eva-tui-core` holds contracts with no rendering code.
`packages/tui` renders them. `Renderer` is terminal-specific and sits below
`Frontend` — it is how one surface draws, not what a surface is.

```ts
// packages/tui-core/src/frame.ts
export interface Frame {
  readonly banner: Banner
  readonly session: readonly TranscriptMessage[]
  readonly live: string
  readonly input: string
  readonly took: string
  readonly work: Work
  readonly status: StatusLine
}

export interface Renderer {
  readonly draw: (frame: Frame) => void
  readonly onKey: (handler: (key: KeyPress) => void) => () => void
  readonly stop: () => void
}
```

`session` and `live` are the conversation; the rest is chrome. The contract
states `live`'s sequencing invariants — append-only within a Run, emptied
exactly when the fold replaces the stream — because the pipe renderer appends
and leans on both. A pipe carries the conversation only; the chrome is for a
screen.

A renderer owns the terminal, so it owns the keyboard too: splitting output
and input across two objects would give a rich renderer no way to claim the
keys it already handles. The input line is the renderer's to draw but the
surface's to hold — it goes down in the `Frame` and comes back as key
presses, so a redraw never loses a half-written line.

`eva.tui` — the plugin — registers a surface, calls the Session API, and draws
through `Renderer`. It imports `eva-tui-core` and never OpenTUI; the plugin
layer has no import for `eva-tui` at all, so a surface can never pull FFI in.
A future web surface implements `Frontend` and calls the same Session API;
only `Renderer` is terminal-specific.

```
packages/tui/
├── src/
│   ├── index.ts               picks a renderer for this runtime, and says why
│   ├── renderer.tsx           createCliRenderer() + createRoot().render(<App />)
│   ├── app.tsx                SessionPane, LiveArea, Notes, StatusBar, InputBar
│   ├── frame.ts               a Frame as drawable lines
│   ├── keys.ts                one press shape for both renderers
│   ├── palette.ts             how a theme paints the transcript
│   └── stream.ts              the renderer for everywhere OpenTUI cannot run
```

The files holding JSX are `.tsx`, and each carries
`/** @jsxImportSource @opentui/react */` rather than the root tsconfig naming
one import source for the whole program.

**Two renderers, one contract.** OpenTUI draws where there is Bun's FFI and a
real screen. Everywhere else — Node, or piped output — the stream renderer
draws the same `Frame`. A screen is repainted whole because the cursor can go
back; a pipe cannot, so there it appends only what is new, and the fold that
replaces a stream is marked as shown rather than printed twice.

The composition root reaches the terminal through a dynamic import, so a
`--print` run and every run on Node never load the native chunk. CI asserts
both halves: the renderer starts under Bun, and `opentui` appears nowhere in
the packed entry.

OpenTUI's core is written in Zig with TypeScript bindings. `@opentui/core`
powers the first reference in production, pinned there at 0.4.5 alongside
`@opentui/solid`; we pin `@opentui/react` at 0.5.3, a different binding on a
later minor line. **Nothing about that production use vouches for either
of those differences.** Both bindings ship from one repository at the same
version, published seconds apart, so the binding choice carries no maintenance
penalty either way — and `Renderer` is the seam that makes swapping cheap if
that stops being true.

## 15. What we borrowed, and from where

Eva's mechanisms are not all original. The plugin-as-Effect shape, the
transform/hook split, the domain rebuild engine, the boot batching, and the
draft/branded-type split come from the first reference. The
everything-is-a-plugin rule, the contract package beside swappable
implementations, the bundle and profile format, the per-entry `disabled`
boolean, and the inbox steering verbs (`whenIdle`, `runMaintenance`) come from
the second. The adapter-is-a-record rule comes from a third surveyed harness,
and the `undetectable` resume outcome and provider-reported cost in integer
ticks come from the survey's widest orchestrator. The harness contract itself —
both halves, the capability booleans, and `_meta`/`ext` — is the Agent Client
Protocol. A few rules are Eva's own: same-id replace keeps its order position,
slot consumers read late instead of reloading on provider change, and Eva is an
ACP agent as well as a client.

### Borrowing that is copying needs a licence notice

Some of that borrowing is ideas, and crediting the source in prose is enough.
Some is source: `Plugin`, `define`, and `PluginDomain` in §2 are an upstream
file with the path comment changed, and the domain rebuild engine in §4.1
follows its upstream closely. A permissive licence permits the copy and
requires the copyright notice and permission text to travel with it — a
sentence in a design document does not satisfy that.

The authoritative attribution list — which upstream projects, what was taken
from each, and under which licence — is the repository's `NOTICE` file, not
this document. Before any copied source ships, each file that carries it needs
its upstream notice, and the `NOTICE` file must accompany the distribution.
One upstream is under its own Apache-derived licence rather than MIT; read
that licence before taking a shape from its source — what Eva credits to it
are field observations rather than code.

## 16. References

In this repository:

- [roadmap.md](../roadmap.md) — the stage each package, domain, slot, and hook arrives in
- [writing-plugins.md](writing-plugins.md) — the authoring walkthrough
- [toolchain.md](toolchain.md) — Vite+, Bun, TypeScript, and CI

Protocol:

- Agent Client Protocol: https://agentclientprotocol.com
- ACP prompt turn and stop reasons: https://agentclientprotocol.com/protocol/prompt-turn

External:

- Effect v4 migration: https://github.com/Effect-TS/effect/blob/main/MIGRATION.md
- Vite+: https://viteplus.dev
- Vite+ docs, offline: `node_modules/vite-plus/docs/guide/`
- Bun workspaces and catalogs: https://bun.com/docs/pm/cli/install
- Bun trusted dependencies: https://bun.com/docs/guides/install/trusted
- OpenTUI: https://opentui.com/docs/getting-started
