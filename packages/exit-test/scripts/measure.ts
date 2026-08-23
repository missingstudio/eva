// The runner: N Runs of each canned Workflow against the pinned model,
// fanned out across OS processes. Each process is one `eva run` with its own
// trace file — one Recorder holds one open Run, so the fan-out is by process
// and never by fiber. Everything after the fan-out — the read-back, the
// no-Candidate rule, the refusal share, and the threshold verdict — is
// src/gate.ts, which the test suite asserts; this script only spawns the
// children, prints the report, and exits on it.
//
//   ANTHROPIC_API_KEY=... bun packages/exit-test/scripts/measure.ts \
//     [--each 100] [--jobs 4] [--out DIR]
//
// At the tree's own vendored rates, 100 Runs each over the five Workflows is
// roughly $12 on a Sonnet-class model and $20 on an Opus-class one — about
// 100 minutes serially, under half an hour with the fan-out. Cost is not why
// this is not a per-push job: nondeterminism, wall clock, and a stored
// provider secret are.
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ENDPOINT, hermeticEnv, inputOf, INPUTS, WORKFLOWS, wrongEndpoint } from "../src/fixture.js"
import { gate } from "../src/gate.js"

const flag = (name: string, fallback: number): number => {
  const at = process.argv.indexOf(name)
  return at === -1 ? fallback : Number(process.argv[at + 1])
}

const each = flag("--each", 100)
const jobs = flag("--jobs", 4)
const outAt = process.argv.indexOf("--out")
const out = outAt === -1 ? mkdtempSync(join(tmpdir(), "eva-measure-")) : process.argv[outAt + 1]!
mkdirSync(join(out, "traces"), { recursive: true })

// `--endpoint` records a number against an endpoint on purpose. Without it a
// shell that points somewhere else is refused rather than measured, because
// the rate would name the pinned model and mean another service.
const endpointAt = process.argv.indexOf("--endpoint")
const endpoint = endpointAt === -1 ? ENDPOINT : process.argv[endpointAt + 1]!
const ambient = process.env["ANTHROPIC_BASE_URL"]
if (endpointAt === -1 && wrongEndpoint(ambient, endpoint)) {
  console.error(
    `ANTHROPIC_BASE_URL is ${String(ambient)}, and the measurement is pinned to ${endpoint}.`,
  )
  console.error("Unset it, or pass --endpoint to record a number against that endpoint on purpose.")
  process.exit(1)
}

const repo = join(new URL(".", import.meta.url).pathname, "..", "..", "..")
const eva = join(repo, "apps", "cli", "src", "eva.ts")

interface Task {
  readonly workflow: (typeof WORKFLOWS)[number]
  readonly tracePath: string
}

const tasks: Task[] = WORKFLOWS.flatMap((workflow) =>
  Array.from({ length: each }, (_, index) => ({
    workflow,
    tracePath: join(out, "traces", `${workflow}.${index + 1}.jsonl`),
  })),
)

const run = (task: Task): Promise<void> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [eva, "run", task.workflow], {
      cwd: out,
      // The hermetic world, and where this child's Trace lands. The
      // in-process half says it the same way, so the gate proves it.
      env: hermeticEnv(out, task.tracePath, endpoint),
      stdio: ["pipe", "ignore", "pipe"],
    })
    let heard = ""
    child.stderr.on("data", (chunk: Buffer) => {
      heard += chunk.toString()
    })
    child.stdin.end(readFileSync(inputOf(task.workflow)))
    child.on("close", (code) => {
      if (code !== 0) {
        const line = heard.split("\n").find(Boolean) ?? `exit ${code}`
        console.error(`${task.workflow}: ${line}`)
      }
      resolve()
    })
  })

// A simple pool: `jobs` children at a time until the list is done.
let next = 0
const worker = async (): Promise<void> => {
  for (;;) {
    const task = tasks[next]
    next += 1
    if (task === undefined) return
    await run(task)
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, worker))

const report = gate(tasks.map((task) => ({ workflow: task.workflow, path: task.tracePath })))

// The refusal: no rate is reported at all, so nothing else is printed.
if (report.said.length === 0) {
  for (const line of report.failed) console.error(line)
  process.exit(1)
}

// What was measured, so the commit that records the number names the model,
// the endpoint, the date and the inputs without anybody reconstructing them.
console.log("measured")
console.log(`  date      ${new Date().toISOString().slice(0, 10)}`)
console.log(`  endpoint  ${endpoint}`)
console.log(`  models    ${report.models.join(", ") || "none reported"}`)
console.log(`  runs      ${each} of each of ${WORKFLOWS.length}, ${tasks.length} together`)
for (const [workflow, file] of Object.entries(INPUTS))
  console.log(`  input     ${workflow}: ${file}`)
console.log("")

for (const line of report.said) console.log(line)

if (report.failed.length > 0) {
  console.error(report.failed.join("; "))
  process.exit(1)
}
