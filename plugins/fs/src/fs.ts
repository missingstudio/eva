import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join, resolve, sep } from "node:path"
import {
  globMatcher,
  type FileStat,
  type FileSystem,
  FileSystemError,
} from "@missingstudio/eva-core"
import { Effect } from "effect"

/**
 * The real path of the deepest part of `path` that exists, with the rest of
 * the path put back on the end. A symlink inside the root that points out of
 * it resolves here, so the containment check reads where a write would land
 * and not where it was spelled.
 */
const settled = (path: string): string => {
  const tail: string[] = []
  let head = path
  for (;;) {
    if (existsSync(head)) return join(realpathSync(head), ...tail.reverse())
    const parent = dirname(head)
    if (parent === head) return path
    tail.push(basename(head))
    head = parent
  }
}

const faultOf = (path: string, cause: unknown): FileSystemError => {
  const code = (cause as { code?: string }).code
  return new FileSystemError({
    path,
    reason: code === "ENOENT" ? "not_found" : "io",
    message: cause instanceof Error ? cause.message : String(cause),
  })
}

const walk = (directory: string, prefix: string, found: string[]): void => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    // A symlinked directory is not walked: a walk that followed one could
    // leave the root, and could go round for ever.
    if (entry.isDirectory()) walk(join(directory, entry.name), path, found)
    else if (entry.isFile()) found.push(path)
  }
}

/**
 * The `FileSystem` slot over the disk, under one root. Every path is
 * resolved against the root and refused when it lands outside, so a tool
 * reaches the workspace and nothing above it.
 */
export const makeFileSystem = (root: string): FileSystem => {
  const base = settled(resolve(root))

  // The absolute path this one names, or undefined when it is outside.
  const within = (path: string): string | undefined => {
    const full = settled(resolve(base, path))
    return full === base || full.startsWith(base + sep) ? full : undefined
  }

  const outside = (path: string) =>
    Effect.fail(
      new FileSystemError({
        path,
        reason: "outside_root",
        message: `the path is outside ${base}`,
      }),
    )

  const at = <A>(path: string, read: (full: string) => A): Effect.Effect<A, FileSystemError> =>
    Effect.suspend(() => {
      const full = within(path)
      if (full === undefined) return outside(path)
      try {
        return Effect.succeed(read(full))
      } catch (cause) {
        return Effect.fail(faultOf(path, cause))
      }
    })

  return {
    read: (path) => at(path, (full) => readFileSync(full, "utf8")),

    write: (path, content) =>
      at(path, (full) => {
        mkdirSync(dirname(full), { recursive: true })
        writeFileSync(full, content)
      }),

    stat: (path) =>
      at(path, (full): FileStat | undefined => {
        const found = statSync(full, { throwIfNoEntry: false })
        if (found === undefined) return undefined
        return found.isDirectory()
          ? { kind: "directory", bytes: 0 }
          : { kind: "file", bytes: found.size }
      }),

    // The pattern is a path too: one that reaches above the root is refused
    // rather than answering the empty list it would otherwise match.
    glob: (pattern) =>
      at(pattern, () => {
        const matches = globMatcher(pattern)
        const found: string[] = []
        walk(base, "", found)
        return found.filter(matches).sort()
      }),
  }
}
