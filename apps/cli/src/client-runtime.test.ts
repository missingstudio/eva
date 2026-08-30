import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const REPO = join(new URL(".", import.meta.url).pathname, "..", "..", "..")

/**
 * Deliberately crude: it greps. The number this stage owes W1 is a count of
 * Session API calls made outside `client-runtime`, and a grep is how a
 * reviewer checks that count by hand. A rule a person cannot repeat is a
 * rule nobody keeps.
 *
 * What ships, only. A test stands its own API up to test against, which is
 * what a fake is for and is not a call the product makes.
 */
const shipped = (directory: string): readonly string[] =>
  readdirSync(join(REPO, directory), { recursive: true, withFileTypes: true })
    // `.tsx` as well as `.ts`, because `apps/web` is React: a sweep that saw
    // only one of the two would pass over most of the page and prove nothing.
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !/\.test\.tsx?$/.test(path))
    .map((path) => relative(REPO, path))
    .sort()

// Every plugin's own source, and nothing a package manager put beside it.
// The sweep names source directories rather than trees, because a tree here
// holds a node_modules and walking one is how this test stopped finishing.
const pluginSources = (): readonly string[] =>
  readdirSync(join(REPO, "plugins"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join("plugins", entry.name, "src"))
    .filter((path) => existsSync(join(REPO, path)))
    .sort()

const naming = (word: string, directories: readonly string[]): readonly string[] =>
  directories
    .flatMap(shipped)
    .filter((path) => readFileSync(join(REPO, path), "utf8").includes(word))

describe("what reads the Session API", () => {
  it("the terminal surface names none of it: it is handed a client and nothing else", () => {
    expect(naming("SessionAPI", ["plugins/tui/src"])).toEqual([])
  })

  /**
   * One site, for four doors. The terminal, `eva serve`, `eva run` and
   * `--print` all open a Session through `openClient`, so the gate is wired
   * once — while each door built its own, two of the four built one with no
   * gate at all, and an `ask` under those was denied for a different reason
   * than at the others.
   */
  it("the command line builds one, at one site, and hands on the client", () => {
    expect(naming("makeSessionAPI", ["plugins/tui/src", "apps/cli/src"])).toEqual([
      "apps/cli/src/surface.ts",
    ])
  })

  /**
   * The same count, one layer down. A caller that reaches a kernel Slot has
   * gone around the Client rather than through it — the print path folded
   * its own Answer that way, out of the trace sink, while the Session API
   * had no method that gave one.
   *
   * `boot` is where the Slots are read, because that is what answers a
   * Surface; `testkit` builds kernels for suites to drive. Nothing else.
   */
  it("nothing a person drives Eva through reaches a kernel Slot", () => {
    expect(naming("kernel.slot", ["apps/cli/src", ...pluginSources()])).toEqual([])
  })
})

/**
 * The one number that proves W0: the count of Session API calls in `apps/web`
 * that do not go through `client-runtime`. It is zero, and it is a check that
 * fails rather than a habit.
 *
 * A page that went around the Client would have to reach the wire itself, so
 * the wire's own names are what this counts — every way a browser opens one,
 * and `SessionAPI` with them, because a page that named one would be
 * answering the contract rather than calling it. `plugins/tui` holds to the
 * same rule one directory over.
 */
describe("what the page reaches Eva through", () => {
  it.each(["fetch(", "EventSource", "XMLHttpRequest", "WebSocket", "SessionAPI"])(
    "names no %s of its own",
    (word) => {
      expect(naming(word, ["apps/web/src"])).toEqual([])
    },
  )

  /**
   * One Client, built at one site, and every other file on the page is handed
   * it. `client-runtime` holds what a reconnect costs, so a second Client
   * would be a second answer to where the runtime is.
   *
   * The transport and the Client are what is counted, and not the module they
   * ship in: the ask channel's reader lives beside the wire too, and the page
   * reads the questions that stand where it draws them.
   */
  it("builds one Client, at one site", () => {
    expect(naming("httpTransport", ["apps/web/src"])).toEqual(["apps/web/src/eva.ts"])
    expect(naming("makeClient", ["apps/web/src"])).toEqual(["apps/web/src/eva.ts"])
  })
})

describe("what the print surface carries", () => {
  /**
   * The print path is imported by name, not lazily, so what it names is what
   * a pipe loads. The terminal is reached by dynamic import for exactly this
   * reason: its renderer is native code over Bun's FFI.
   */
  it("names no terminal, so a pipe never loads the native chunk", () => {
    expect(naming("eva-tui", ["plugins/print/src"])).toEqual([])
    expect(naming("opentui", ["plugins/print/src"])).toEqual([])
  })

  // The body sits beside the row that declares the surface, so the next
  // non-terminal surface copies a plugin rather than the composition root.
  it("holds the Run it prints, rather than leaving it in the command line", () => {
    expect(naming("runPrint", ["apps/cli/src"])).toEqual(["apps/cli/src/index.ts"])
  })
})
