import { readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

/**
 * Where git keeps this directory's HEAD. A worktree marks itself with a file
 * that names the real directory, so following it is what stops a worktree
 * reporting the branch its parent is on.
 */
const gitDirectory = (directory: string): string | undefined => {
  let current = resolve(directory)
  for (;;) {
    const marker = join(current, ".git")
    const found = statSync(marker, { throwIfNoEntry: false })
    if (found?.isDirectory() === true) return marker
    if (found?.isFile() === true) {
      const named = /^gitdir:\s*(.+)$/m.exec(readFileSync(marker, "utf8"))?.[1]
      if (named !== undefined) return resolve(current, named.trim())
    }
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/**
 * The branch this directory is on. A detached head is on none, so it is
 * named by the commit instead, and a directory outside a repository has
 * nothing to name.
 */
export const branchOf = (directory: string): string => {
  const found = gitDirectory(directory)
  if (found === undefined) return ""
  try {
    const head = readFileSync(join(found, "HEAD"), "utf8").trim()
    return /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1] ?? head.slice(0, 7)
  } catch {
    return ""
  }
}

// The home directory is where the reader already is, so it is written as ~.
export const shortPath = (directory: string, home: string = homedir()): string => {
  if (home === "") return directory
  if (directory === home) return "~"
  return directory.startsWith(`${home}/`) ? `~${directory.slice(home.length)}` : directory
}
