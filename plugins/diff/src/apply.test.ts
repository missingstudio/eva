import type { DiffFiles, DiffRefused, Edit } from "@missingstudio/eva-core"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { applier, fingerprint } from "./apply.js"

/**
 * A `FileSystem` with no disk under it, in one place.
 *
 * The stage's shared virtual filler lands with the `FileSystem` slot itself;
 * this double is what that filler replaces, and it is the only one in this
 * package. It counts writes as well as holding content, because "a dry run
 * touches nothing" is a claim about calls and not only about bytes.
 */
interface MemoryFiles extends DiffFiles {
  readonly at: (path: string) => string | undefined
  readonly writes: () => number
}

const memoryFiles = (seed: Record<string, string>): MemoryFiles => {
  const held = new Map(Object.entries(seed))
  let writes = 0

  return {
    read: (path) =>
      Effect.suspend(() => {
        const found = held.get(path)
        return found === undefined
          ? Effect.die(new Error(`${path} is not there`))
          : Effect.succeed(found)
      }),
    write: (path, content) =>
      Effect.sync(() => {
        writes += 1
        held.set(path, content)
      }),
    at: (path) => held.get(path),
    writes: () => writes,
  }
}

const run = <A>(effect: Effect.Effect<A, DiffRefused>): Promise<A> => Effect.runPromise(effect)
const refusal = (effect: Effect.Effect<unknown, DiffRefused>): Promise<DiffRefused> =>
  Effect.runPromise(Effect.flip(effect))

const edit = (path: string, ...hunks: readonly [string, string][]): Edit => ({
  path,
  hunks: hunks.map(([find, replace]) => ({ find, replace })),
})

describe("a dry run", () => {
  it("produces the exact change and writes nothing", async () => {
    const files = memoryFiles({ "a.ts": "one\ntwo\nthree\n" })

    const preview = await run(applier.preview(files, edit("a.ts", ["two", "TWO"])))

    expect(preview.after).toBe("one\nTWO\nthree\n")
    expect(preview.hunks).toBe(1)
    expect(files.at("a.ts")).toBe("one\ntwo\nthree\n")
    expect(files.writes()).toBe(0)
  })

  it("lands every hunk in order, each counted against what the last produced", async () => {
    const files = memoryFiles({ "a.ts": "alpha beta gamma" })

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
    const files = memoryFiles({ "a.ts": "cost = 1" })

    const preview = await run(applier.preview(files, edit("a.ts", ["1", "$& $' $`"])))

    expect(preview.after).toBe("cost = $& $' $`")
  })
})

describe("an apply", () => {
  it("writes the previewed content once", async () => {
    const files = memoryFiles({ "a.ts": "one\n" })

    const preview = await run(applier.preview(files, edit("a.ts", ["one", "two"])))
    const applied = await run(applier.apply(files, preview))

    expect(files.at("a.ts")).toBe("two\n")
    expect(files.writes()).toBe(1)
    expect(applied.before).toBe("one\n")
    expect(applied.wrote).toBe(fingerprint("two\n"))
  })

  it("lands nothing when a later hunk is not there", async () => {
    const files = memoryFiles({ "a.ts": "one\ntwo\n" })

    const refused = await refusal(
      applier.preview(files, edit("a.ts", ["one", "ONE"], ["four", "FOUR"])),
    )

    expect(refused.reason).toBe("hunk_missing")
    expect(refused.hunk).toBe(1)
    expect(files.at("a.ts")).toBe("one\ntwo\n")
    expect(files.writes()).toBe(0)
  })

  it("lands nothing when a hunk is there more than once", async () => {
    const files = memoryFiles({ "a.ts": "two two\n" })

    const refused = await refusal(applier.preview(files, edit("a.ts", ["two", "TWO"])))

    expect(refused.reason).toBe("hunk_ambiguous")
    expect(refused.found).toBe(2)
    expect(files.at("a.ts")).toBe("two two\n")
    expect(files.writes()).toBe(0)
  })

  it("lands nothing when an earlier hunk made a later one ambiguous", async () => {
    const files = memoryFiles({ "a.ts": "alpha beta\n" })

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
    const files = memoryFiles({ "a.ts": AWKWARD })

    const preview = await run(applier.preview(files, edit("a.ts", ["zwei", "two"])))
    const applied = await run(applier.apply(files, preview))
    await run(applier.reverse(files, applied))

    expect(files.at("a.ts")).toBe(AWKWARD)
  })

  it("answers the apply that reverses the reverse", async () => {
    const files = memoryFiles({ "a.ts": "one\n" })

    const preview = await run(applier.preview(files, edit("a.ts", ["one", "two"])))
    const applied = await run(applier.apply(files, preview))
    const undone = await run(applier.reverse(files, applied))
    await run(applier.reverse(files, undone))

    expect(files.at("a.ts")).toBe("two\n")
  })
})

describe("a stale record", () => {
  it("refuses an apply whose file moved under the preview", async () => {
    const files = memoryFiles({ "a.ts": "one\n" })
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
    const files = memoryFiles({ "a.ts": "one\n" })
    const preview = await run(applier.preview(files, edit("a.ts", ["one", "two"])))
    await Effect.runPromise(files.write("a.ts", "elsewhere\n"))
    await Effect.runPromise(files.write("a.ts", "one\n"))

    await run(applier.apply(files, preview))

    expect(files.at("a.ts")).toBe("two\n")
  })

  it("refuses a reverse whose file moved after the apply", async () => {
    const files = memoryFiles({ "a.ts": "one\n" })
    const preview = await run(applier.preview(files, edit("a.ts", ["one", "two"])))
    const applied = await run(applier.apply(files, preview))
    await Effect.runPromise(files.write("a.ts", "somebody else\n"))

    const refused = await refusal(applier.reverse(files, applied))

    expect(refused.reason).toBe("stale")
    expect(files.at("a.ts")).toBe("somebody else\n")
  })

  it("is a typed value rather than a throw", async () => {
    const files = memoryFiles({ "a.ts": "one\n" })
    const preview = await run(applier.preview(files, edit("a.ts", ["one", "two"])))
    await Effect.runPromise(files.write("a.ts", "moved\n"))

    const refused = await refusal(applier.apply(files, preview))

    expect(refused._tag).toBe("DiffRefused")
    expect(refused.message).toContain("a.ts")
  })
})
