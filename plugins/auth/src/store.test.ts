import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { makeFileStore, type Refresher } from "./store.js"

const temp = () => join(mkdtempSync(join(tmpdir(), "eva-store-")), "auth.json")

const HOUR = 3_600_000
const NOW = 1_760_000_000_000

const counting = (
  answer: (attempt: number) => ReturnType<Refresher["refresh"]>,
): Refresher & { calls: () => number } => {
  let calls = 0
  return {
    calls: () => calls,
    refresh: () =>
      Effect.suspend(() => {
        calls += 1
        return answer(calls)
      }),
  }
}

const ok = (access: string) => Effect.succeed({ access, refresh: "r2", expiresAt: NOW + HOUR })

describe("an api key", () => {
  it("resolves verbatim and never expires", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* makeFileStore({ path: temp(), now: () => NOW })
        yield* store.set("anthropic", { mode: "api_key", key: "sk-live" })
        const credential = yield* store.get("anthropic")
        return yield* credential!.secret()
      }),
    )
    expect(found).toBe("sk-live")
  })
})

describe("an oauth credential", () => {
  it("resolves without renewing while it is still valid", async () => {
    const refresher = counting(() => ok("never-used"))
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* makeFileStore({ path: temp(), now: () => NOW, refresher })
        yield* store.set("x", {
          mode: "oauth",
          access: "live",
          refresh: "r1",
          expiresAt: NOW + HOUR,
        })
        const credential = yield* store.get("x")
        return yield* credential!.secret()
      }),
    )
    expect(found).toBe("live")
    expect(refresher.calls()).toBe(0)
  })

  it("renews before expiry rather than sending a token that dies in flight", async () => {
    const refresher = counting(() => ok("renewed"))
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* makeFileStore({ path: temp(), now: () => NOW, refresher })
        // Inside the skew window: still valid, but not for long enough.
        yield* store.set("x", {
          mode: "oauth",
          access: "old",
          refresh: "r1",
          expiresAt: NOW + 1000,
        })
        const credential = yield* store.get("x")
        return yield* credential!.secret()
      }),
    )
    expect(found).toBe("renewed")
    expect(refresher.calls()).toBe(1)
  })

  // A token handed out and then lost to a crash is one the next process
  // cannot renew from, so the write happens before the return.
  it("persists the renewed token before it answers with it", async () => {
    const path = temp()
    const refresher = counting(() => ok("renewed"))
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* makeFileStore({ path, now: () => NOW, refresher })
        yield* store.set("x", { mode: "oauth", access: "old", refresh: "r1", expiresAt: NOW - 1 })
        const credential = yield* store.get("x")
        return yield* credential!.secret()
      }),
    )
    const onDisk = JSON.parse(readFileSync(path, "utf8")) as Record<string, { access: string }>
    expect(onDisk["x"]?.access).toBe("renewed")
  })

  it("renews once when two turns start together", async () => {
    const refresher = counting(() => ok("renewed"))
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* makeFileStore({ path: temp(), now: () => NOW, refresher })
        yield* store.set("x", { mode: "oauth", access: "old", refresh: "r1", expiresAt: NOW - 1 })
        const credential = yield* store.get("x")
        return yield* Effect.all([credential!.secret(), credential!.secret()], {
          concurrency: "unbounded",
        })
      }),
    )
    expect(found).toEqual(["renewed", "renewed"])
    expect(refresher.calls()).toBe(1)
  })

  it.each([
    [
      "there is no refresh token",
      { mode: "oauth" as const, access: "old", expiresAt: NOW - 1 },
      /expired/,
    ],
    [
      "nothing was configured to renew it",
      { mode: "oauth" as const, access: "old", refresh: "r1", expiresAt: NOW - 1 },
      /nothing can renew it/,
    ],
  ])("fails with a reason when %s", async (_which, record, message) => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const store = yield* makeFileStore({ path: temp(), now: () => NOW })
        yield* store.set("x", record)
        const credential = yield* store.get("x")
        return yield* credential!.secret()
      }),
    )
    expect(String(exit)).toMatch(message)
  })

  it("reports a refresh that the server refused", async () => {
    const refresher: Refresher = { refresh: () => Effect.fail(new Error("invalid_grant")) }
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const store = yield* makeFileStore({ path: temp(), now: () => NOW, refresher })
        yield* store.set("x", { mode: "oauth", access: "old", refresh: "r1", expiresAt: NOW - 1 })
        const credential = yield* store.get("x")
        return yield* credential!.secret()
      }),
    )
    expect(String(exit)).toMatch(/invalid_grant/)
  })
})

describe("the store itself", () => {
  it("says a credential is missing rather than throwing a parse error", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const store = yield* makeFileStore({ path: temp() })
        const credential = yield* store.get("absent")
        return credential
      }),
    )
    expect(String(exit)).toContain("Success")
  })

  // A credential is readable by its owner and nobody else.
  it("writes the file 0600", async () => {
    const path = temp()
    await Effect.runPromise(
      Effect.flatMap(makeFileStore({ path }), (store) =>
        store.set("x", { mode: "api_key", key: "sk" }),
      ),
    )
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it("forgets a credential it removed", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* makeFileStore({ path: temp() })
        yield* store.set("x", { mode: "api_key", key: "sk" })
        yield* store.remove("x")
        return yield* store.get("x")
      }),
    )
    expect(found).toBeUndefined()
  })

  // Asking what is there must not spend a refresh token.
  it("reports an expired login without renewing it", async () => {
    const refresher = counting(() => ok("renewed"))
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* makeFileStore({ path: temp(), now: () => NOW, refresher })
        yield* store.set("x", { mode: "oauth", access: "old", expiresAt: NOW - 1 })
        return yield* store.list
      }),
    )
    expect(found).toEqual([{ id: "x", mode: "oauth", expired: true }])
    expect(refresher.calls()).toBe(0)
  })
})

// A refresh token is single-use. Two Eva processes share one store, so the
// one that loses the race must not report the login dead.
describe("a refresh token another process already rotated", () => {
  it("re-reads the store rather than declaring the login dead", async () => {
    const path = temp()
    const refresher: Refresher = {
      refresh: () =>
        Effect.suspend(() => {
          // Stand in for the other process: it rotated and wrote first.
          const store = Effect.runSync(makeFileStore({ path, now: () => NOW }))
          Effect.runSync(
            store.set("x", {
              mode: "oauth",
              access: "written-by-the-winner",
              refresh: "r2",
              expiresAt: NOW + HOUR,
            }),
          )
          return Effect.fail(new Error("refresh_token_reused"))
        }),
    }
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* makeFileStore({ path, now: () => NOW, refresher })
        yield* store.set("x", { mode: "oauth", access: "old", refresh: "r1", expiresAt: NOW - 1 })
        const credential = yield* store.get("x")
        return yield* credential!.secret()
      }),
    )
    expect(found).toBe("written-by-the-winner")
  })

  it("still fails when the store holds the same dead token", async () => {
    const refresher: Refresher = { refresh: () => Effect.fail(new Error("refresh_token_expired")) }
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const store = yield* makeFileStore({ path: temp(), now: () => NOW, refresher })
        yield* store.set("x", { mode: "oauth", access: "old", refresh: "r1", expiresAt: NOW - 1 })
        const credential = yield* store.get("x")
        return yield* credential!.secret()
      }),
    )
    expect(String(exit)).toMatch(/refresh_token_expired/)
  })
})
