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
}

// The one place the process is read. Every other module is handed a World.
export const fromProcess = (args: readonly string[] = process.argv.slice(2)): World => ({
  args,
  env: process.env,
  cwd: process.cwd(),
  out: (text) => void process.stdout.write(text),
  err: (text) => void process.stderr.write(text),
})
