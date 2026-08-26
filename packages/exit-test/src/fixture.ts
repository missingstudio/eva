import { writeFileSync } from "node:fs"
import { join } from "node:path"

export const FIXTURE = join(new URL(".", import.meta.url).pathname, "..", "fixture")

// The five canned Workflows, in fixture order. The measurement, the golden
// and its test all read this list, so a sixth Workflow is added in one place.
export const WORKFLOWS = ["commit-msg", "review", "release-notes", "classify", "extract"] as const

/**
 * The endpoint the measurement is pinned to. The model is pinned in the
 * fixture's config.yaml, but the endpoint cannot be: the provider SDK reads
 * it from the environment, so a shell with `ANTHROPIC_BASE_URL` set sends
 * the Runs somewhere else and the same fixture then scores differently on
 * two machines.
 */
export const ENDPOINT = "https://api.anthropic.com"

/**
 * Whether the environment points the Runs somewhere other than the pinned
 * endpoint. A rate measured against another endpoint is a rate about that
 * endpoint, so the runner says which one it used and refuses an accidental
 * one rather than recording it silently.
 */
export const wrongEndpoint = (ambient: string | undefined, pinned: string): boolean =>
  ambient !== undefined && ambient !== pinned

// The one plugin whose options say where a Run's Trace lands.
const TRACE_JSONL = "eva.trace.jsonl"

/**
 * The inline config layer that points one Run's Trace at one directory —
 * the JSONL sink keeps one file per Session inside it. It is a layer and
 * not an edit of the resolved list, so the in-process Run and the child the
 * fan-out spawns say it the same way and the deterministic gate proves the
 * words the measurement sends. The path is written as JSON, so a path that
 * holds a quote or a backslash stays one scalar.
 */
const tracedAt = (dir: string): string =>
  `plugins:\n  - { id: ${TRACE_JSONL}, options: { dir: ${JSON.stringify(dir)} } }\n`

/**
 * The environment one hermetic Run gets: an empty user config in the given
 * scratch directory, so the run reads the fixture and nothing of the
 * operator's — and the trust record beside the operator's config is never
 * touched.
 *
 * The endpoint is written in rather than inherited, so the Runs go where the
 * measurement says they go whatever the operator's shell holds. The
 * credential is the one thing that must come from the environment, and it
 * passes through untouched.
 */
export const hermeticEnv = (
  scratch: string,
  traceDir: string,
  endpoint: string = ENDPOINT,
): NodeJS.ProcessEnv => {
  const userConfig = join(scratch, "user-config.yaml")
  writeFileSync(userConfig, "")
  return {
    ...process.env,
    EVA_CONFIG: userConfig,
    EVA_CONFIG_DIR: FIXTURE,
    EVA_CONFIG_CONTENT: tracedAt(traceDir),
    ANTHROPIC_BASE_URL: endpoint,
  }
}

// Which vendored input each Workflow reads. The measurement never reads the
// live repository, so the same fixture scores identically on two machines.
export const INPUTS = {
  "commit-msg": "staged.diff",
  review: "source.ts",
  "release-notes": "CHANGELOG.md",
  classify: "transcript.txt",
  extract: "document.md",
} as const satisfies Record<(typeof WORKFLOWS)[number], string>

export const inputOf = (name: keyof typeof INPUTS): string => join(FIXTURE, "inputs", INPUTS[name])
