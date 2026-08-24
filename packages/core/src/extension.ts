import type { Effect, Scope, Stream } from "effect"

/**
 * The four extension points, as shapes both the kernel and the SDK need.
 * They live in core because the kernel may not import the SDK and the SDK
 * may not import the kernel; the contract has to sit under both.
 */

export interface Registration {
  // Removes this registration early. Calling it twice is safe.
  readonly dispose: Effect.Effect<void>
}

/**
 * A transform is a synchronous draft edit, because a rebuild replays every
 * transform on every plugin load, unload, and replace. Work that runs once —
 * a fetch, a file read — belongs in the plugin's effect; the transform
 * closes over the result and registers the fact.
 */
export type TransformCallback<Draft> = (draft: Draft) => void

/**
 * What a transform may return: anything but an Effect. `void` alone is not
 * the rule — TypeScript accepts any return where void is expected — so the
 * refusal has to name what it refuses.
 */
export type Synchronous<Result> =
  Result extends Effect.Effect<infer _A, infer _E, infer _R> ? never : Result

export interface Domain<State, Draft> {
  readonly get: Effect.Effect<State>
  readonly transform: <Result>(
    callback: (draft: Draft) => Synchronous<Result>,
  ) => Effect.Effect<Registration, never, Scope.Scope>
  readonly reload: Effect.Effect<void>
}

/**
 * The editor a Transform receives for a domain of plain rows. Every domain
 * but the catalog has this shape, so the rules below are one implementation
 * rather than one per domain: the kernel builds it and the SDK names it.
 */
export interface Row<Info> {
  list(): readonly Info[]
  get(id: string): Info | undefined
  /**
   * Registers the row whole. A row already holding this id is replaced and
   * keeps its position, so replay order still decides which transform wins.
   * The Info is copied in, so a plugin may hand over a constant it holds.
   */
  set(info: Info): void
  /**
   * Edits a row that exists, and leaves alone one that does not. `update` used
   * to mint `{ id }` for an unknown id and type it as a whole Info, so a row
   * reached its readers with every other field undefined — which is how a
   * surface with no `interactive` read as one that is not interactive.
   */
  update(id: string, update: (info: Info) => void): void
  remove(id: string): void
}

export interface Slot<T> {
  /**
   * Reads the current implementation, or undefined when nothing fills it.
   * This is the read a plugin and a surface use: a capability nobody filled
   * is Degraded, and each reader answers for its own capability — the
   * credential store falls back to reporting `auth_failed`, the Recorder
   * marks the Run, and the session store folds the Trace instead.
   */
  readonly peek: Effect.Effect<T | undefined>
  /**
   * The same value, dying as a defect when the slot is empty. For a caller
   * that filled the slot and wants the value back — which in this tree means
   * a test. Nothing in a Run reads it, because a Run degrades and says so.
   */
  readonly get: Effect.Effect<T>
  // Fills the slot. The Registration is bound to the caller's scope.
  readonly provide: (
    id: string,
    implementation: T,
  ) => Effect.Effect<Registration, never, Scope.Scope>
}

// Every domain exposes its runtime hooks through this shape.
export type Hooks<Spec> = {
  readonly [Name in keyof Spec]: (
    callback: (event: Spec[Name]) => Effect.Effect<void> | void,
  ) => Effect.Effect<Registration, never, Scope.Scope>
}

export interface Broadcast<Map> {
  readonly subscribe: <Type extends keyof Map>(type: Type) => Stream.Stream<Map[Type]>
  readonly publish: <Type extends keyof Map>(type: Type, payload: Map[Type]) => Effect.Effect<void>
}

export class EmptySlotError extends Error {
  override readonly name = "EmptySlotError"
  readonly slot: string
  constructor(slot: string) {
    super(`the ${slot} slot is empty`)
    this.slot = slot
  }
}

export class PluginCycleError extends Error {
  override readonly name = "PluginCycleError"
  readonly cycle: readonly string[]
  constructor(cycle: readonly string[]) {
    super(`plugin load cycle: ${cycle.join(" → ")}`)
    this.cycle = cycle
  }
}
