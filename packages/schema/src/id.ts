declare const brand: unique symbol

type Brand<T, B extends string> = T & { readonly [brand]: B }

export type EventID = Brand<string, "EventID">
export type TenantID = Brand<string, "TenantID">
export type RunID = Brand<string, "RunID">
export type SessionID = Brand<string, "SessionID">

export const eventID = (value: string): EventID => value as EventID
export const tenantID = (value: string): TenantID => value as TenantID
export const runID = (value: string): RunID => value as RunID
export const sessionID = (value: string): SessionID => value as SessionID

export type ActorKind = "human" | "agent" | "system"

export interface Identity {
  readonly id: string
  readonly kind: ActorKind
}

// A committed trace position inside one session.
export interface Cursor {
  readonly session: SessionID
  readonly seq: number
}

// When a record was made. `seq` is what orders a trace; this is what a
// reader sees. A duration is measured by whatever measures it, not stored.
export interface Timestamp {
  readonly wall: string
}
