import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { Effect } from "effect"
import { configPath, directoryLayer, fileLayer, type Layer } from "./config.js"
import { RESOURCE_DIRECTORIES } from "./resources.js"

/**
 * Where Eva is running, whether that directory is trusted, and the layers
 * that apply to it. A project directory is read only after a grant, because
 * it can name plugins to load, and naming a plugin is naming code.
 */
export interface Location {
  readonly directory: string
  readonly trusted: boolean
  // Lowest precedence first: the user directory and file, then the project.
  readonly chain: readonly Layer[]
  // Project config files and resource directories that are there and were
  // not read, so a run can say so.
  readonly ignored: readonly string[]
}

export const EVA_DIRECTORY = ".eva"
export const CONFIG_FILE = "config.yaml"

/**
 * One spelling per directory. A checkout reached over a symlink, or typed
 * in another case on a case-insensitive disk, is the same directory, and a
 * grant a person gave must still match when they return by the other name.
 * A path that is not there yet keeps the spelling it was given.
 */
const canonical = (directory: string): string => {
  try {
    return realpathSync.native(resolve(directory))
  } catch {
    return resolve(directory)
  }
}

/**
 * The grant lives beside the person's own config, never inside the directory
 * it trusts. A repository that ships a file claiming to be trusted is a
 * repository making a claim about itself, which is the shape of the attack.
 */
export const trustPath = (env: NodeJS.ProcessEnv = process.env): string =>
  join(dirname(configPath(env)), "trusted")

/**
 * One absolute path per line. A file that cannot be read grants nothing,
 * which is the safe direction for a gate.
 */
export const trustedDirectories = (env: NodeJS.ProcessEnv = process.env): readonly string[] => {
  try {
    return readFileSync(trustPath(env), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => canonical(line))
  } catch {
    return []
  }
}

/**
 * A grant covers the directory it names and everything below it. One
 * checkout is one grant, and a directory inside that checkout is the same
 * checkout — two clones are still two grants, which is the point.
 */
const covers = (granted: string, directory: string): boolean => {
  const away = relative(granted, directory)
  return away === "" || (!away.startsWith("..") && !isAbsolute(away))
}

export const isTrusted = (directory: string, env: NodeJS.ProcessEnv = process.env): boolean =>
  trustedDirectories(env).some((granted) => covers(granted, canonical(directory)))

// Granting twice adds nothing, so a person may run it without checking.
export const grantTrust = (
  directory: string,
  env: NodeJS.ProcessEnv = process.env,
): Effect.Effect<string> =>
  Effect.sync(() => {
    const target = canonical(directory)
    if (!isTrusted(target, env)) {
      const path = trustPath(env)
      mkdirSync(dirname(path), { recursive: true })
      appendFileSync(path, `${target}\n`)
    }
    return target
  })

/**
 * Removes the grant naming this directory. A directory still covered by a
 * grant above it stays trusted, and the caller asks again to find out.
 */
export const revokeTrust = (
  directory: string,
  env: NodeJS.ProcessEnv = process.env,
): Effect.Effect<string> =>
  Effect.sync(() => {
    const target = canonical(directory)
    const kept = trustedDirectories(env).filter((granted) => granted !== target)
    const path = trustPath(env)
    if (existsSync(path)) writeFileSync(path, kept.map((one) => `${one}\n`).join(""))
    return target
  })

/**
 * Up from the directory, nearest last, stopping at the repository boundary:
 * a `.eva` above a checkout is somebody else's. The boundary is checked
 * after the directory's own entry, so the repository root's `.eva` is found
 * rather than cut off by the `.git` that marks the root.
 */
export const projectDirectories = (directory: string): readonly string[] => {
  const found: string[] = []
  let current = resolve(directory)
  for (;;) {
    const candidate = join(current, EVA_DIRECTORY)
    if (existsSync(candidate)) found.unshift(candidate)
    if (existsSync(join(current, ".git"))) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return found
}

export const projectConfigs = (directory: string): readonly string[] =>
  projectDirectories(directory)
    .map((one) => join(one, CONFIG_FILE))
    .filter((one) => existsSync(one))

/**
 * A directory contributes two layers: its resources, then its config file.
 * The file is where a person goes to override, so it wins over a resource
 * the same directory discovered.
 */
const layersFor = (directory: string): readonly Layer[] => [
  directoryLayer(directory),
  fileLayer(join(directory, CONFIG_FILE)),
]

/**
 * What an untrusted directory holds and was not read: the config file, and
 * every resource directory that is there. A person with prompts and no
 * config.yaml is told what a grant would have opened.
 */
const skipped = (directory: string): readonly string[] =>
  [CONFIG_FILE, ...RESOURCE_DIRECTORIES]
    .map((name) => join(directory, name))
    .filter((path) => existsSync(path))

export const resolveLocation = (
  directory: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Effect.Effect<Location> =>
  Effect.sync(() => {
    const here = canonical(directory)
    const trusted = isTrusted(here, env)
    const user = dirname(configPath(env))
    const custom = env["EVA_CONFIG_DIR"]
    const project = projectDirectories(here)

    return {
      directory: here,
      trusted,
      chain: [
        directoryLayer(user),
        fileLayer(configPath(env)),
        ...(custom === undefined ? [] : layersFor(custom)),
        ...(trusted ? project.flatMap(layersFor) : []),
      ],
      ignored: trusted ? [] : project.flatMap(skipped),
    }
  })
