import { homedir } from "node:os"
import { resolve } from "node:path"

/**
 * What a module needs from the machine it runs on. The kernel and a plugin
 * both need it and a plugin may not import the kernel, so each had written
 * its own copy — character for character, and free to drift the moment
 * either changed.
 *
 * It reads the home directory, so it is Node only and stays out of the
 * barrel. A browser has no such machine to ask.
 */

/**
 * A path as written, made absolute. `~/` is the home directory, because a
 * person writes a config path that way and `resolve` does not expand it.
 */
export const expand = (path: string): string =>
  path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : resolve(path)
