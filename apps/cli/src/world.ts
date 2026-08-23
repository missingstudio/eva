import { readFileSync } from "node:fs"

/**
 * Everything a run reads from outside itself: what it was asked to do, where
 * it is, and where its words go. The process fills it in production and a
 * test fills it with a scratch directory, so every branch of `main` is
 * reachable without touching the person's own home directory.
 */
export interface World {
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly cwd: string
  readonly out: (text: string) => void
  readonly err: (text: string) => void
  /**
   * Piped input, read to the end, or undefined when standard input is a
   * terminal. A call rather than a value: `eva --version` must not block on
   * a terminal that will never close. A test hands over a string, so
   * `git diff | eva run` has a branch that is reachable without a pipe.
   */
  readonly stdin: () => string | undefined
}

// The one place the process is read. Every other module is handed a World.
export const fromProcess = (args: readonly string[] = process.argv.slice(2)): World => ({
  args,
  env: process.env,
  cwd: process.cwd(),
  out: (text) => void process.stdout.write(text),
  err: (text) => void process.stderr.write(text),
  stdin: () => (process.stdin.isTTY ? undefined : readFileSync(0, "utf8")),
})
