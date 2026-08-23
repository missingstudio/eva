import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { ENDPOINT, type WORKFLOWS } from "../src/score.js"

export const FIXTURE = join(new URL(".", import.meta.url).pathname, "..", "fixture")

/**
 * The environment a hermetic run gets: an empty user config in the given
 * scratch directory, so the run reads the fixture and nothing of the
 * operator's — and the trust record beside the operator's config is never
 * touched.
 *
 * The endpoint is written in rather than inherited, so the Runs go where the
 * measurement says they go whatever the operator's shell holds. The
 * credential is the one thing that must come from the environment, and it
 * passes through untouched.
 */
export const hermeticEnv = (scratch: string, endpoint: string = ENDPOINT): NodeJS.ProcessEnv => {
  const userConfig = join(scratch, "user-config.yaml")
  writeFileSync(userConfig, "")
  return {
    ...process.env,
    EVA_CONFIG: userConfig,
    EVA_CONFIG_DIR: FIXTURE,
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
