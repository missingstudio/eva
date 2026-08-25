import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { connect, createServer, type AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Exit, Scope } from "effect"
import { describe, expect, it } from "vitest"
import type { Bind } from "./bind.js"
import { serveWeb } from "./serve.js"

const PAGE =
  '<!doctype html><title>Eva</title><div id="page">build 0.0.0 · 2026-08-26T00:00:00</div>'
const SCRIPT = "export const page = 1\n"

// A tree in the shape `vp build` leaves in `apps/web/dist`.
const built = (): string => {
  const root = mkdtempSync(join(tmpdir(), "eva-web-built-"))
  mkdirSync(join(root, "assets"))
  writeFileSync(join(root, "index.html"), PAGE)
  writeFileSync(join(root, "assets", "index-abc123.js"), SCRIPT)
  return root
}

const empty = (): string => mkdtempSync(join(tmpdir(), "eva-web-unbuilt-"))

const LOOPBACK: Bind = { host: "127.0.0.1", port: 0 }

/**
 * A port nothing holds, taken from the kernel and given straight back. A
 * refusal is asked for a real address, so "nothing is listening there" is a
 * fact about the refusal and not about a port that could never be bound.
 */
const freePort = (): Promise<number> =>
  new Promise((settle) => {
    const probe = createServer()
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => settle(port))
    })
  })

/**
 * One surface, bound for real on an ephemeral loopback port. The address is
 * read back out of what the surface printed, so "it prints the URL it bound
 * to" and "a browser loads the page there" are one claim and not two.
 */
const serving = async (root: string, posture = "local", bind: Bind = LOOPBACK) => {
  const said: string[] = []
  const scope = await Effect.runPromise(Scope.make())
  const frontend = await Effect.runPromise(
    Effect.provideService(
      serveWeb({
        root,
        bind,
        posture,
        write: (text) => void said.push(text),
      }),
      Scope.Scope,
      scope,
    ),
  )
  const printed = said.join("")
  return {
    frontend,
    printed,
    url: printed.split(" ")[0] ?? "",
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}

// Whether anything is listening. A closed port is the proof a finalizer ran.
const reachable = (url: string): Promise<boolean> =>
  new Promise((settle) => {
    const { hostname, port } = new URL(url)
    const socket = connect({ host: hostname, port: Number(port) })
    socket.once("connect", () => {
      socket.destroy()
      settle(true)
    })
    socket.once("error", () => settle(false))
  })

describe("the page a browser loads", () => {
  it("prints the address it bound to, and the page is there", async () => {
    const served = await serving(built())
    const response = await fetch(served.url)

    expect(served.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
    expect(await response.text()).toBe(PAGE)
    await served.close()
  })

  // `port: 0` is what a test binds, and printing the port that was asked for
  // rather than the one that was granted would print `:0`.
  it("prints the port it really got, not the one it asked for", async () => {
    const served = await serving(built())
    expect(served.url).not.toContain(":0")
    await served.close()
  })

  it("serves the asset the page names, as a script", async () => {
    const served = await serving(built())
    const response = await fetch(`${served.url}/assets/index-abc123.js`)

    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8")
    expect(await response.text()).toBe(SCRIPT)
    await served.close()
  })

  // The router owns the path, so a reload of a deep link is a repaint.
  it("answers a deep link with the page", async () => {
    const served = await serving(built())
    const response = await fetch(`${served.url}/sessions/019a`)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(PAGE)
    await served.close()
  })

  it("misses a script that is not in the build", async () => {
    const served = await serving(built())
    expect((await fetch(`${served.url}/assets/index-gone.js`)).status).toBe(404)
    await served.close()
  })

  // The page names the build it came from, and that is worth nothing if a
  // browser may show the bundle from before the last build.
  it("lets nothing cache what it serves", async () => {
    const served = await serving(built())
    expect((await fetch(served.url)).headers.get("cache-control")).toBe("no-store")
    await served.close()
  })
})

describe("a page nobody built", () => {
  it("says so, and names the command that fixes it", async () => {
    const root = empty()
    const served = await serving(root)

    expect(served.printed).toContain(root)
    expect(served.printed).toContain("vp run -r build")
    await served.close()
  })

  // A surface that answers every request with 404 reads as broken. This one
  // reads as unbuilt, which is what it is.
  it("answers a request with the same sentence rather than a 404", async () => {
    const root = empty()
    const served = await serving(root)
    const response = await fetch(served.url)

    expect(response.status).toBe(503)
    expect(await response.text()).toContain("vp run -r build")
    await served.close()
  })
})

/**
 * Single-tenant and multi-tenant are the same `apps/web` build. The posture
 * is read when the surface starts, so what changes between the two is the
 * line the surface prints and no byte of what it serves.
 */
describe("one artifact, both postures", () => {
  it("serves the same bytes under either posture, and says which is active", async () => {
    const root = built()
    const local = await serving(root, "local")
    const hosted = await serving(root, "hosted")

    expect(await (await fetch(local.url)).text()).toBe(await (await fetch(hosted.url)).text())
    expect(local.printed).toContain("in the local posture")
    expect(hosted.printed).toContain("in the hosted posture")

    await local.close()
    await hosted.close()
  })
})

describe("holding until the process stops", () => {
  it("does not finish on its own", async () => {
    const served = await serving(built())
    const held = await Promise.race([
      Effect.runPromise(served.frontend.done).then(() => "finished"),
      new Promise((settle) => setTimeout(() => settle("held"), 50)),
    ])

    expect(held).toBe("held")
    await served.close()
  })

  // The Scope is what stops it: `main` closes it after a signal, and the
  // finalizer closes the socket rather than leaving the port bound.
  it("finishes when the scope closes, and leaves nothing listening", async () => {
    const served = await serving(built())
    expect(await reachable(served.url)).toBe(true)

    await served.close()

    await Effect.runPromise(served.frontend.done)
    expect(await reachable(served.url)).toBe(false)
  })
})

describe("what the surface answers Eva", () => {
  // The row says `interactive: false`, so nothing asks. An ask that arrived
  // anyway is refused rather than left waiting for a page with no input.
  it("cancels an ask rather than holding it", async () => {
    const served = await serving(built())
    const answer = await Effect.runPromise(
      served.frontend.ask({ kind: "question", id: "one", question: "which?" }),
    )

    expect(answer).toEqual({ kind: "cancelled" })
    await served.close()
  })
})

describe("a bind that did not happen", () => {
  // `start` cannot fail, so the surface says what went wrong and ends. A
  // process that waits on a server nobody listens to never exits.
  it("says why, and finishes at once", async () => {
    const first = await serving(built())
    const port = Number(new URL(first.url).port)
    const said: string[] = []

    const scope = await Effect.runPromise(Scope.make())
    const frontend = await Effect.runPromise(
      Effect.provideService(
        serveWeb({
          root: built(),
          bind: { host: "127.0.0.1", port },
          posture: "local",
          write: (text) => void said.push(text),
        }),
        Scope.Scope,
        scope,
      ),
    )

    expect(said.join("")).toContain("did not bind")
    await Effect.runPromise(frontend.done)
    await Effect.runPromise(Scope.close(scope, Exit.void))
    await first.close()
  })
})

/**
 * A non-local bind needs a token and stage 9b is what issues one, so until 9b
 * exists this bind is refused. The refusal is the surface's own, because this
 * is the one place a socket is opened: `apps/cli` refuses the same bind before
 * it boots, and every other caller of `serveWeb` is refused here.
 */
describe("a bind that needs a token", () => {
  const refused = async (bind: Bind, posture = "local") => serving(built(), posture, bind)

  /**
   * The proof is a socket that will not connect. A server bound to 0.0.0.0
   * answers on loopback too, so a loopback connect would have reached one had
   * the surface bound anything at all.
   */
  it("opens no port", async () => {
    const port = await freePort()
    const served = await refused({ host: "0.0.0.0", port })

    expect(await reachable(`http://127.0.0.1:${port}`)).toBe(false)
    await served.close()
  })

  // Not a warning above a served page: there is no page, and there is no
  // address. A warning above a running server is an unauthenticated server
  // with a note on it.
  it("says why, and says no address", async () => {
    const served = await refused({ host: "0.0.0.0", port: await freePort() })

    expect(served.printed).toContain("a non-local bind needs a token")
    expect(served.printed).toContain("9b")
    expect(served.printed).not.toContain("http://")
    expect(served.printed).not.toContain("posture")
    await served.close()
  })

  // The surface that serves holds until the process stops. This one served
  // nothing, so it ends at once and the process is free to exit non-zero.
  it("finishes at once rather than holding the process open", async () => {
    const served = await refused({ host: "0.0.0.0", port: await freePort() })
    const ended = await Promise.race([
      Effect.runPromise(served.frontend.done).then(() => "finished"),
      new Promise((settle) => setTimeout(() => settle("held"), 50)),
    ])

    expect(ended).toBe("finished")
    await served.close()
  })

  // The posture is a tenancy and not a token. `hosted` opens no door in W1:
  // what each posture permits arrives with the token at 9b.
  it("is refused under the hosted posture too", async () => {
    const port = await freePort()
    const served = await refused({ host: "0.0.0.0", port }, "hosted")

    expect(served.printed).toContain("tokens arrive at 9b")
    expect(served.printed).not.toContain("hosted posture")
    expect(await reachable(`http://127.0.0.1:${port}`)).toBe(false)
    await served.close()
  })

  // Every interface is every interface, in either family.
  it("refuses the IPv6 form of every interface as well", async () => {
    const served = await refused({ host: "::", port: await freePort() })
    expect(served.printed).toContain("tokens arrive at 9b")
    await served.close()
  })
})
