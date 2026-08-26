/**
 * The protected paths, and the one predicate that answers for them.
 *
 * These files bootstrap the toolchain. A write to one of them is a
 * delayed-action shell command: the next install, the next hook, the next CI
 * job runs what it says, long after the call that wrote it was answered. So no
 * rule approves them, and this list is not config — a profile reaches the
 * rules, and the rules are checked beside this and never over it.
 */

// Every path below a directory of this name is protected.
const TREES: readonly string[] = [".git", ".eva", ".circleci", ".husky"]

// The second name below the first. `.github` also holds documents nobody runs.
const PAIRS: readonly (readonly [string, string])[] = [[".github", "workflows"]]

// The registries, the servers, and the tool config a toolchain reads first.
const TOOLCHAIN: readonly string[] = [
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".mcp.json",
  "bunfig.toml",
]

// CI configuration that lives in a file rather than a directory.
const CI: readonly string[] = [
  ".gitlab-ci.yml",
  ".travis.yml",
  "azure-pipelines.yml",
  "Jenkinsfile",
]

// Dependency manifests and their locks. An install runs the scripts they name.
const MANIFESTS: readonly string[] = [
  "package.json",
  "package-lock.json",
  "bun.lock",
  "bun.lockb",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "pyproject.toml",
  "requirements.txt",
  "Pipfile",
  "Pipfile.lock",
  "poetry.lock",
  "uv.lock",
  "Gemfile",
  "Gemfile.lock",
  "composer.json",
  "composer.lock",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
]

// A shell reads these when it starts, and direnv reads `.envrc` on a cd.
const SHELL_RC: readonly string[] = [
  ".bashrc",
  ".bash_profile",
  ".profile",
  ".zshrc",
  ".zshenv",
  ".zprofile",
  ".envrc",
]

// Protected by base name, wherever the file is.
export const PROTECTED_FILES: readonly string[] = [...TOOLCHAIN, ...CI, ...MANIFESTS, ...SHELL_RC]

export const PROTECTED_TREES: readonly string[] = TREES

const segmentsOf = (path: string): readonly string[] =>
  path.split(/[/\\]+/).filter((segment) => segment !== "" && segment !== ".")

/**
 * Whether a path names a protected file, or anything below a protected
 * directory.
 *
 * One predicate, and both doors read it. A tool that names a file names it in
 * a `path` argument; a command names it as one of its words. Neither can reach
 * a different answer, because there is only this one.
 */
export const protects = (path: string): boolean => {
  const segments = segmentsOf(path)
  const last = segments.at(-1)
  if (last === undefined) return false

  if (segments.some((segment) => TREES.includes(segment))) return true
  if (
    segments.some((segment, index) =>
      PAIRS.some(([first, second]) => segment === first && segments[index + 1] === second),
    )
  )
    return true
  return PROTECTED_FILES.includes(last)
}

// The first protected path a call names, or nothing. One is enough: one path
// is what a person is asked about, and one is what stops the call.
export const protectedIn = (words: readonly string[]): string | undefined =>
  words.find((word) => protects(word))
