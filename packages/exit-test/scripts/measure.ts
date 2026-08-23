// The runner: N Runs of each canned Workflow against the pinned model,
// fanned out across OS processes. Each process is one `eva run` with its own
// trace file — one Recorder holds one open Run, so the fan-out is by process
// and never by fiber. The ratios are printed from the one fold, and the
// process exits non-zero when the aggregate falls below the line.
//
// A Run that produced no Candidate is counted and reported, never dropped,
// and past the stated share of the Runs the measurement refuses to report a
// rate at all.
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
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readTrace, type Event } from "@missingstudio/eva-schema"
import { hermeticEnv, inputOf, INPUTS } from "./fixture.js"
import {
  ENDPOINT,
  readingOf,
  refuses,
  said,
  wrongEndpoint,
  NO_CANDIDATE_SHARE,
  WORKFLOWS,
} from "../src/score.js"

// The line, as plan 001 writes it into the roadmap: first-pass validity at
// or above 95% aggregate, repair yield at or above 90%.
const FIRST_PASS_LINE = 0.95
const REPAIR_YIELD_LINE = 0.9

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

const hermit = hermeticEnv(out, endpoint)

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
      env: {
        ...hermit,
        EVA_CONFIG_CONTENT: `plugins:\n  - { id: eva.trace.jsonl, options: { path: "${task.tracePath}" } }\n`,
      },
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

// One trace file per process, read back whole. A file a killed child left
// unreadable is a Run that produced nothing to judge.
const byWorkflow = new Map<string, Event[]>()
const unproduced = new Map<string, number>()
for (const name of WORKFLOWS) {
  byWorkflow.set(name, [])
  unproduced.set(name, 0)
}
for (const task of tasks) {
  let events: readonly Event[] = []
  try {
    events = existsSync(task.tracePath) ? readTrace(task.tracePath) : []
  } catch {
    events = []
  }
  if (!events.some((event) => event.payload.kind === "verdict")) {
    unproduced.set(task.workflow, (unproduced.get(task.workflow) ?? 0) + 1)
  }
  byWorkflow.get(task.workflow)?.push(...events)
}

const unproducedTotal = [...unproduced.values()].reduce((sum, one) => sum + one, 0)
if (refuses(unproducedTotal, tasks.length)) {
  console.error(
    `${unproducedTotal} of ${tasks.length} Runs produced no Candidate, which is past the ${NO_CANDIDATE_SHARE * 100}% share — no rate is reported`,
  )
  process.exit(1)
}

// What was measured, so the commit that records the number names the model,
// the endpoint, the date and the inputs without anybody reconstructing them.
// The models are the ones the Runs actually reported, not the ones config
// asked for, so a per-Step override shows up here.
const models = new Set<string>()
for (const events of byWorkflow.values()) {
  for (const event of events) {
    if (event.payload.kind === "usage" && event.payload.model !== undefined) {
      models.add(event.payload.model)
    }
  }
}
console.log("measured")
console.log(`  date      ${new Date().toISOString().slice(0, 10)}`)
console.log(`  endpoint  ${endpoint}`)
console.log(`  models    ${[...models].sort().join(", ") || "none reported"}`)
console.log(`  runs      ${each} of each of ${WORKFLOWS.length}, ${tasks.length} together`)
for (const [workflow, file] of Object.entries(INPUTS))
  console.log(`  input     ${workflow}: ${file}`)
console.log("")

for (const name of WORKFLOWS) {
  for (const line of said(name, readingOf(byWorkflow.get(name) ?? []), unproduced.get(name))) {
    console.log(line)
  }
}

const aggregate = readingOf([...byWorkflow.values()].flat())
for (const line of said("aggregate", aggregate, unproducedTotal)) console.log(line)

if (aggregate.validity.kind === "none") {
  console.error("nothing was judged on a first pass — no rate, and that is a failure")
  process.exit(1)
}

const { summary } = aggregate
const failed = summary.firstPass - summary.firstPassValid
const repaired = summary.settledValid - summary.firstPassValid
const below: string[] = []
if (aggregate.validity.valid < aggregate.validity.of * FIRST_PASS_LINE) {
  below.push(`first-pass validity is below ${FIRST_PASS_LINE * 100}%`)
}
if (failed > 0 && repaired < failed * REPAIR_YIELD_LINE) {
  below.push(`repair yield is below ${REPAIR_YIELD_LINE * 100}%`)
}
if (below.length > 0) {
  console.error(below.join("; "))
  process.exit(1)
}
