import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  CredentialError,
  type Credential,
  type CredentialRef,
  type CredentialStore,
  type StoredCredential,
} from "@missingstudio/eva-core"
import { Cause, Effect, Exit } from "effect"

// A token this close to expiry is renewed rather than sent. A request that
// crosses the boundary in flight fails for a reason nothing can retry.
const SKEW_MS = 60_000

export interface Refresher {
  // Exchanges a refresh token for a new one. Absent for a provider whose
  // login has no refresh flow; its credential simply expires.
  readonly refresh: (
    id: string,
    token: string,
  ) => Effect.Effect<
    { readonly access: string; readonly refresh?: string; readonly expiresAt?: number },
    Error
  >
}

export interface FileStoreOptions {
  readonly path: string
  readonly now?: () => number
  readonly refresher?: Refresher
}

type Record_ = Readonly<Record<string, StoredCredential>>

const read = (path: string): Record_ => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    return typeof parsed === "object" && parsed !== null ? (parsed as Record_) : {}
  } catch {
    // A missing or unreadable store is an empty one. A turn then fails with
    // `missing`, which names the fix, rather than with a parse error.
    return {}
  }
}

/**
 * Writes through a temporary file and a rename, so a crash mid-write leaves
 * the previous store rather than half of the new one. The file is `0600` in
 * a `0700` directory: a credential is readable by its owner and nobody else.
 */
const write = (path: string, records: Record_): void => {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}

export const defaultStorePath = (home: string): string => join(home, ".eva", "auth.json")

const expired = (record: StoredCredential, now: number): boolean =>
  record.mode === "oauth" && record.expiresAt !== undefined && record.expiresAt - SKEW_MS <= now

/**
 * The durable half of the credential store. An api key is kept verbatim; an
 * oauth credential is renewed when it is close to expiry, and the renewed
 * token is written back before it is used, so the next process starts from
 * the token the server currently honors.
 */
export const makeFileStore = (options: FileStoreOptions): Effect.Effect<CredentialStore> =>
  Effect.sync(() => {
    const now = options.now ?? (() => Date.now())
    // Single-flight per id: two turns starting together renew once.
    const inFlight = new Map<string, Effect.Effect<StoredCredential, CredentialError>>()

    const load = (id: string): StoredCredential | undefined => read(options.path)[id]

    const persist = (id: string, record: StoredCredential): void => {
      const all = { ...read(options.path), [id]: record }
      write(options.path, all)
    }

    const renew = (id: string, record: StoredCredential) =>
      Effect.suspend(() => {
        const running = inFlight.get(id)
        if (running !== undefined) return running

        const attempt = Effect.gen(function* () {
          if (record.mode !== "oauth" || record.refresh === undefined) {
            return yield* new CredentialError({
              id,
              reason: "expired",
              message: `the ${id} login expired and has no refresh token — log in again`,
            })
          }
          if (options.refresher === undefined) {
            return yield* new CredentialError({
              id,
              reason: "refresh_failed",
              message: `the ${id} login expired and nothing can renew it`,
            })
          }
          const outcome = yield* Effect.exit(options.refresher.refresh(id, record.refresh))

          if (Exit.isFailure(outcome)) {
            // A refresh token is single-use. Another process sharing this
            // store may have rotated it between our read and our attempt, so
            // the file can already hold a newer credential than the one that
            // failed. Re-read before declaring the login dead: the two demand
            // opposite reactions, and only one of them costs a person a login.
            const latest = load(id)
            if (
              latest !== undefined &&
              latest.mode === "oauth" &&
              latest.refresh !== record.refresh &&
              !expired(latest, now())
            ) {
              return latest
            }
            const cause: unknown = Cause.squash(outcome.cause)
            return yield* new CredentialError({
              id,
              reason: "refresh_failed",
              message: `renewing the ${id} login failed: ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
            })
          }

          const renewed = outcome.value
          const next: StoredCredential = {
            mode: "oauth",
            access: renewed.access,
            ...(renewed.refresh === undefined ? {} : { refresh: renewed.refresh }),
            ...(renewed.expiresAt === undefined ? {} : { expiresAt: renewed.expiresAt }),
          }
          // Persisted before it is returned: a token handed out and then lost
          // to a crash is one the next process cannot renew from.
          yield* Effect.sync(() => persist(id, next))
          return next
        }).pipe(Effect.ensuring(Effect.sync(() => void inFlight.delete(id))))

        const shared = Effect.cached(attempt).pipe(Effect.flatten)
        inFlight.set(id, shared)
        return shared
      })

    const resolve = (id: string): Effect.Effect<string, CredentialError> =>
      Effect.suspend(() => {
        const record = load(id)
        if (record === undefined) {
          return new CredentialError({
            id,
            reason: "missing",
            message: `no credential for ${id}`,
          })
        }
        if (record.mode === "api_key") return Effect.succeed(record.key)
        if (!expired(record, now())) return Effect.succeed(record.access)
        return Effect.map(renew(id, record), (next) =>
          next.mode === "oauth" ? next.access : next.key,
        )
      })

    return {
      get: (id) =>
        Effect.sync(() => {
          const record = load(id)
          if (record === undefined) return undefined
          return { mode: record.mode, secret: () => resolve(id) } satisfies Credential
        }),

      set: (id, credential) => Effect.sync(() => persist(id, credential)),

      remove: (id) =>
        Effect.sync(() => {
          const all = { ...read(options.path) }
          delete all[id]
          write(options.path, all)
        }),

      list: Effect.sync(() => {
        const all = read(options.path)
        const at = now()
        return Object.entries(all).map(
          ([id, record]) =>
            ({
              id,
              mode: record.mode,
              // Reported, not repaired: `list` never renews, so asking what
              // is there cannot spend a refresh token.
              ...(record.mode === "oauth" && expired(record, at) && record.refresh === undefined
                ? { expired: true }
                : {}),
            }) satisfies CredentialRef,
        )
      }),
    }
  })
