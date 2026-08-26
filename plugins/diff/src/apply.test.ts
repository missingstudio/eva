import type { DiffRefused, Edit, FileSystemError } from "@missingstudio/eva-core"
import { virtualFileSystem } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { applier, fingerprint } from "./apply.js"

/**
 * The testkit's virtual `FileSystem`, with its writes counted: "a dry run
 * touches nothing" is a claim about calls and not only about bytes.
 *
 * The shared filler and not a double of this package's own, so the applier is
 * held to the same refusals `eva.fs` answers — a path outside the root
 * included.
 */
const countedFiles = (seed: Readonly<Record<string, string>>) => {
  const virtual = virtualFileSystem(seed)
  let writes = 0

  return {
    read: virtual.fs.read,
    write: (path: string, content: string) =>
      Effect.gen(function* () {
        yield* virtual.fs.write(path, content)
        writes += 1
      }),
    at: (path: string) => virtual.files()[path],
    writes: () => writes,
  }
}

type Fault = DiffRefused | FileSystemError

const run = <A>(effect: Effect.Effect<A, Fault>): Promise<A> => Effect.runPromise(effect)
const failure = (effect: Effect.Effect<unknown, Fault>): Promise<Fault> =>
  Effect.runPromise(Effect.flip(effect))

const refusal = async (effect: Effect.Effect<unknown, Fault>): Promise<DiffRefused> => {
  const found = await failure(effect)
  if (found._tag !== "DiffRefused") throw found
  return found
}

const edit = (path: string, ...hunks: readonly [string, string][]): Edit => ({
  path,
  hunks: hunks.map(([find, replace]) => ({ find, replace })),
})

describe("a dry run", () => {
  it("produces the exact change and writes nothing", async () => {
    const files = countedFiles({ "a.ts": "one\ntwo\nthree\n" })

    const preview = await run(applier.preview(files, edit("a.ts", ["two", "TWO"])))

    expect(preview.after).toBe("one\nTWO\nthree\n")
    expect(preview.hunks).toBe(1)
    expect(files.at("a.ts")).toBe("one\ntwo\nthree\n")
    expect(files.writes()).toBe(0)
  })

  it("lands every hunk in order, each counted against what the last produced", async () => {
    const files = countedFiles({ "a.ts": "alpha beta gamma" })

    const preview = await run(
      applier.preview(files, edit("a.ts", ["alpha", "beta"], ["beta beta", "one"])),
    )

    expect(preview.after).toBe("one gamma")
    expect(preview.hunks).toBe(2)
    expect(files.writes()).toBe(0)
  })

  /**
   * `String.replace` reads `$&` and `$'` in its replacement as substitutions,
   * so a replacement carrying either would land as text nobody wrote.
   */
  it("lands a replacement holding $& as those two characters", async () => {
    const files = countedFiles({ "a.ts": "cost = 1" })

    const preview = await run(applier.preview(files, edit("a.ts", ["1", "$& $' $`"])))

    expect(preview.after).toBe("cost = $& $' $`")
  })
})

describe("an apply", () => {
  it("writes the previewed content once", async () => {
    const files = countedFiles({ "a.ts": "one\n" })

    const preview = await run(applier.preview(files, edit("a.ts", ["one", "two"])))
    const applied = await run(applier.apply(files, preview))

    expect(files.at("a.ts")).toBe("two\n")
    expect(files.writes()).toBe(1)
    expect(applied.before).toBe("one\n")
    expect(applied.wrote).toBe(fingerprint("two\n"))
  })

  it("lands nothing when a later hunk is not there", async () => {
    const files = countedFiles({ "a.ts": "one\ntwo\n" })

    const refused = await refusal(
      applier.preview(files, edit("a.ts", ["one", "ONE"], ["four", "FOUR"])),
    )

    expect(refused.reason).toBe("hunk_missing")
    expect(refused.hunk).toBe(1)
    expect(files.at("a.ts")).toBe("one\ntwo\n")
    expect(files.writes()).toBe(0)
  })

  it("lands nothing when a hunk is there more than once", async () => {
    const files = countedFiles({ "a.ts": "two two\n" })

    const refused = await refusal(applier.preview(files, edit("a.ts", ["two", "TWO"])))

    expect(refused.reason).toBe("hunk_ambiguous")
    expect(refused.found).toBe(2)
    expect(files.at("a.ts")).toBe("two two\n")
    expect(files.writes()).toBe(0)
  })

  it("lands nothing when an earlier hunk made a later one ambiguous", async () => {
    const files = countedFiles({ "a.ts": "alpha beta\n" })

    const refused = await refusal(
      applier.preview(files, edit("a.ts", ["alpha", "beta"], ["beta", "gamma"])),
    )

    expect(refused.reason).toBe("hunk_ambiguous")
    expect(refused.hunk).toBe(1)
    expect(files.at("a.ts")).toBe("alpha beta\n")
    expect(files.writes()).toBe(0)
  })
})

describe("a reverse", () => {
  // Bytes an editor is careless with: a byte-order mark, a CRLF line ending,
  // a tab, a combining accent, text outside the basic plane, and no trailing
  // newline.
  const AWKWARD = "\uFEFFone\r\n\tzwei e\u0301 \u{1F600}\nthree"

  it("restores the prior content byte for byte", async () => {
    const files = countedFiles({ "a.ts": AWKWARD })

    const preview = await run(applier.preview(files, edit("a.ts", ["zwei", "two"])))
    const applied = await run(applier.apply(files, preview))
    await run(applier.reverse(files, applied))

    expect(files.at("a.ts")).toBe(AWKWARD)
  })

  it("answers the apply that reverses the reverse", async () => {
    const files = countedFiles({ "a.ts": "one\n" })

    const preview = await run(applier.preview(files, edit("a.ts", ["one", "two"])))
    const applied = await run(applier.apply(files, preview))
    const undone = await run(applier.reverse(files, applied))
    await run(applier.reverse(files, undone))

    expect(files.at("a.ts")).toBe("two\n")
  })
})

describe("a stale record", () => {
  it("refuses an apply whose file moved under the preview", async () => {
    const files = countedFiles({ "a.ts": "one\n" })
    const preview = await run(applier.preview(files, edit("a.ts", ["one", "two"])))
    await Effect.runPromise(files.write("a.ts", "somebody else\n"))

    const refused = await refusal(applier.apply(files, preview))

    expect(refused.reason).toBe("stale")
    expect(refused.path).toBe("a.ts")
    expect(files.at("a.ts")).toBe("somebody else\n")
  })

  /**
   * The same bytes are not a moved file. A change and a change back leaves
   * the Preview honest, which is the case a modification time gets wrong.
   */
  it("applies when the file changed and changed back", async () => {
    const files = countedFiles({ "a.ts": "one\n" })
    const preview = await run(applier.preview(files, edit("a.ts", ["one", "two"])))
    await Effect.runPromise(files.write("a.ts", "elsewhere\n"))
    await Effect.runPromise(files.write("a.ts", "one\n"))

    await run(applier.apply(files, preview))

    expect(files.at("a.ts")).toBe("two\n")
  })

  it("refuses a reverse whose file moved after the apply", async () => {
    const files = countedFiles({ "a.ts": "one\n" })
    const preview = await run(applier.preview(files, edit("a.ts", ["one", "two"])))
    const applied = await run(applier.apply(files, preview))
    await Effect.runPromise(files.write("a.ts", "somebody else\n"))

    const refused = await refusal(applier.reverse(files, applied))

    expect(refused.reason).toBe("stale")
    expect(files.at("a.ts")).toBe("somebody else\n")
  })

  it("is a typed value rather than a throw", async () => {
    const files = countedFiles({ "a.ts": "one\n" })
    const preview = await run(applier.preview(files, edit("a.ts", ["one", "two"])))
    await Effect.runPromise(files.write("a.ts", "moved\n"))

    const refused = await refusal(applier.apply(files, preview))

    expect(refused._tag).toBe("DiffRefused")
    expect(refused.message).toContain("a.ts")
  })
})

/**
 * What the applier does not hide. Both are `FileSystemError` and not
 * `DiffRefused`: the refusal is the file system's, so the caller reports the
 * boundary that refused rather than a hunk that never was looked for.
 */
describe("a path the file system refuses", () => {
  it("carries the outside_root refusal out of a preview", async () => {
    const files = countedFiles({ "a.ts": "one\n" })

    const found = await failure(applier.preview(files, edit("../secrets.txt", ["one", "two"])))

    expect(found._tag).toBe("FileSystemError")
    expect(files.writes()).toBe(0)
  })

  it("carries the not_found refusal out of a preview", async () => {
    const files = countedFiles({ "a.ts": "one\n" })

    const found = await failure(applier.preview(files, edit("b.ts", ["one", "two"])))

    expect(found._tag).toBe("FileSystemError")
    expect(files.writes()).toBe(0)
  })
})
