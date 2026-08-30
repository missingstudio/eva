import { Buffer } from "node:buffer"
import { posix } from "node:path"
import {
  globMatcher,
  type FileStat,
  type FileSystem,
  FileSystemError,
} from "@missingstudio/eva-core"
import { define, type Plugin } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

export const VIRTUAL_FS = "test.fs.virtual"

// Where the files sit. A test names paths relative to it and never sees it.
export const VIRTUAL_ROOT = "/workspace"

export interface Virtual {
  readonly plugin: Plugin
  // The filler itself, for a suite that holds it to the contract directly.
  readonly fs: FileSystem
  readonly root: string
  // Every file it holds, path to content, so a test reads what a tool wrote.
  readonly files: () => Readonly<Record<string, string>>
}

/**
 * A `FileSystem` with no disk: the files are a map and the paths are the
 * keys. It answers the same contract `eva.fs` answers — the same refusal
 * outside the root, the same glob rule out of `globMatcher` — so a tool test
 * runs with nothing to clean up and nothing to leak.
 *
 * The shape is OpenHarness's `provider-vfs`.
 */
export const virtualFileSystem = (
  seed: Readonly<Record<string, string>> = {},
  root: string = VIRTUAL_ROOT,
): Virtual => {
  const base = posix.resolve(root)
  const held = new Map(Object.entries(seed))

  // The path relative to the root, or undefined when it is outside.
  const within = (path: string): string | undefined => {
    const full = posix.resolve(base, path)
    if (full !== base && !full.startsWith(`${base}/`)) return undefined
    return posix.relative(base, full)
  }

  /**
   * What is at the key. A directory is a key that other keys sit under, and
   * the root is always one, so a disk walk and this map answer alike.
   */
  const kindOf = (key: string): "file" | "directory" | undefined => {
    if (held.has(key)) return "file"
    if (key === "" || [...held.keys()].some((one) => one.startsWith(`${key}/`))) return "directory"
    return undefined
  }

  const fault = (path: string, reason: "outside_root" | "not_found" | "io", message: string) =>
    Effect.fail(new FileSystemError({ path, reason, message }))

  const at = <A>(
    path: string,
    read: (key: string) => Effect.Effect<A, FileSystemError>,
  ): Effect.Effect<A, FileSystemError> =>
    Effect.suspend(() => {
      const key = within(path)
      return key === undefined
        ? fault(path, "outside_root", `the path is outside ${base}`)
        : read(key)
    })

  const fs: FileSystem = {
    read: (path) =>
      at(path, (key) => {
        const found = held.get(key)
        if (found !== undefined) return Effect.succeed(found)
        return kindOf(key) === "directory"
          ? fault(path, "io", "the path is a directory")
          : fault(path, "not_found", "nothing is at the path")
      }),

    write: (path, content) => at(path, (key) => Effect.sync(() => void held.set(key, content))),

    stat: (path) =>
      at(path, (key) => {
        const kind = kindOf(key)
        if (kind === undefined) return Effect.succeed(undefined)
        const found: FileStat =
          kind === "file"
            ? { kind, bytes: Buffer.byteLength(held.get(key) ?? "") }
            : { kind, bytes: 0 }
        return Effect.succeed(found)
      }),

    glob: (pattern) =>
      at(pattern, () => {
        const matches = globMatcher(pattern)
        return Effect.succeed([...held.keys()].filter(matches).sort())
      }),
  }

  return {
    plugin: define({
      id: VIRTUAL_FS,
      effect: Effect.fn(VIRTUAL_FS)(function* (ctx) {
        yield* ctx.slot.fileSystem.provide(ctx.id, fs)
      }),
    }),
    fs,
    root: base,
    files: () => Object.fromEntries(held),
  }
}
