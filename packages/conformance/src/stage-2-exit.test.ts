import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The stage 2 exit test, as a gate rather than a claim.
 *
 * Every clause the roadmap states is already proven by the ticket that built
 * the thing it is about, over a live kernel with no model in the room. So this
 * suite proves none of them a second time. It holds the ledger: the roadmap's
 * own sentences, and the test that answers each one.
 *
 * Two rules make it a gate. A clause the roadmap adds or rewords and this
 * ledger does not carry fails here, because the clauses are compared against
 * the roadmap's own words. And a proof that is renamed or deleted fails here,
 * because each row names a test that has to exist. `plans/` is working state
 * and goes when the stage ends; the roadmap and this ledger are what is left.
 *
 * `packages/exit-test` is the other shape, and stage 1 needed it: a rate has
 * to be measured against a fixture, so that stage exits on a package that
 * re-runs the machinery over vendored cassettes. Stage 2's clauses are
 * behavioural. Re-proving thirteen tickets' behaviour in one place would be
 * thirteen copies to keep in step, and a copy that drifts is worse than a
 * citation that cannot.
 */

const ROOT = join(new URL(".", import.meta.url).pathname, "..", "..", "..")

// One test that answers a clause: the file it lives in, and its own words.
interface Proof {
  readonly file: string
  readonly test: string
}

interface Clause {
  // The roadmap's sentence, verbatim.
  readonly says: string
  readonly proofs: readonly Proof[]
}

const CLAUSES: readonly Clause[] = [
  {
    says: "the agent completes a three-file refactor end to end.",
    proofs: [
      {
        file: "packages/conformance/src/harness-loop.test.ts",
        test: "changes all three files and ends when the model stops asking",
      },
      {
        file: "packages/conformance/src/harness-loop.test.ts",
        test: "records each call inside the Run that proposed it",
      },
    ],
  },
  {
    says: "You can preview and undo every write.",
    proofs: [
      {
        file: "packages/conformance/src/tool-edit.test.ts",
        test: "is previewed, and the preview writes nothing",
      },
      {
        file: "packages/conformance/src/tool-edit.test.ts",
        test: "lands exactly what the dry run answered",
      },
      { file: "packages/conformance/src/tool-edit.test.ts", test: "is undone byte for byte" },
    ],
  },
  {
    says: "Policy refuses `rm -rf /`; luck does not.",
    proofs: [
      {
        file: "packages/conformance/src/tool-policy.test.ts",
        test: "refuses rm -rf /, and the command never reaches the Sandbox",
      },
      {
        file: "packages/conformance/src/tool-policy.test.ts",
        test: "refuses rm -rf / written as a shell line",
      },
      {
        file: "packages/conformance/src/tool-policy.test.ts",
        test: "refuses a whole chain for one denied part",
      },
    ],
  },
  {
    says: "A write to `.mcp.json` is refused even when an allow rule in a repo profile would allow it.",
    proofs: [
      {
        file: "packages/conformance/src/tool-policy.test.ts",
        test: "refuses a write to .mcp.json, and the file is unchanged",
      },
      {
        file: "packages/conformance/src/tool-policy.test.ts",
        test: "refuses a command that names a protected path",
      },
    ],
  },
  {
    says: "`echo x > $VAR` is one opaque invocation and fails closed.",
    proofs: [
      {
        file: "packages/conformance/src/tool-policy.test.ts",
        test: "fails closed on an opaque invocation",
      },
    ],
  },
  {
    says: "`eva policy check` rejects a malformed rule set in CI.",
    proofs: [
      {
        file: "apps/cli/src/main.test.ts",
        test: "exits nonzero on a malformed rule set, and names the fault",
      },
      {
        file: "apps/cli/src/main.test.ts",
        test: "names every fault, so a person fixes the file once",
      },
    ],
  },
  {
    says: "Changing a live session from `autonomous` to `read-only` takes effect before the next tool call.",
    proofs: [
      {
        file: "packages/conformance/src/approval.test.ts",
        test: "takes effect before the next tool call",
      },
      {
        file: "packages/conformance/src/approval.test.ts",
        test: "lands a mode payload on the Trace",
      },
    ],
  },
  {
    says: "Two parallel-safe reads overlap and you can show it.",
    proofs: [
      {
        file: "packages/conformance/src/tool-execution.test.ts",
        test: "overlap, because the tool claims they may",
      },
      { file: "packages/core/src/tool.test.ts", test: "overlap" },
    ],
  },
  {
    says: "A write between them is a barrier.",
    proofs: [
      {
        file: "packages/conformance/src/tool-execution.test.ts",
        test: "is a barrier: nothing after it starts until it has committed",
      },
      {
        file: "packages/core/src/tool.test.ts",
        test: "is a barrier: nothing after it starts until it has committed",
      },
    ],
  },
  {
    says: "Results land in source order.",
    proofs: [
      {
        file: "packages/conformance/src/tool-execution.test.ts",
        test: "lands its results and its records in source order",
      },
      {
        file: "packages/core/src/tool.test.ts",
        test: "commit in source order whichever call finished first",
      },
    ],
  },
  {
    says: "A policy hook that throws denies its tool call; an observing hook that throws is reported and the Run continues.",
    proofs: [
      {
        file: "packages/conformance/src/tool-execution.test.ts",
        test: "denies its tool call, and the tool never reads the file",
      },
      {
        file: "packages/conformance/src/tool-execution.test.ts",
        test: "is reported as its plugin's failure, and the calls go on",
      },
      {
        file: "packages/kernel/src/hook.test.ts",
        test: "denies the call a hook threw at, and the call never runs",
      },
      {
        file: "packages/boot/src/boot.test.ts",
        test: "is published as its plugin's failure, and the payloads survive",
      },
    ],
  },
]

/**
 * The one clause the stage plan added to the roadmap's list. It is an exercise
 * of an existing claim and not a new promise: the write half of the Session
 * API arrived with this stage, so every gate it opens is reached through two
 * doors from the day it ships.
 */
const SOCKET: Clause = {
  says: "and every clause above, exercised through the socket as well.",
  proofs: [
    {
      file: "packages/conformance/src/session-api-contract.test.ts",
      test: "the Session API, filled by $name",
    },
    {
      file: "packages/conformance/src/session-api-write.test.ts",
      test: "leaves the same record whichever door it came through",
    },
    {
      file: "packages/conformance/src/session-api-write.test.ts",
      test: "leaves the same record whichever door drove the tools",
    },
    {
      file: "packages/conformance/src/session-api-write.test.ts",
      test: "is the same decision from either door",
    },
    {
      file: "packages/conformance/src/both-doors.test.ts",
      test: "reaches the page, and the page's answer is the one the gate reads",
    },
  ],
}

/**
 * The stage's exit test, out of the design authority itself. The paragraph is
 * wrapped in the file, so the lines are joined the way a reader reads them.
 */
const exitTestOf = (heading: string): string => {
  const doc = readFileSync(join(ROOT, "docs", "roadmap.md"), "utf8")
  const section = doc.split("\n### ").find((one) => one.startsWith(heading))
  const paragraph = section?.split("\n\n").find((one) => one.startsWith("**Exit test:**"))
  return (paragraph ?? "").replace("**Exit test:** ", "").split("\n").join(" ")
}

const proofs = [...CLAUSES, SOCKET].flatMap((clause) =>
  clause.proofs.map((proof) => ({ ...proof, says: clause.says })),
)

describe("the stage 2 exit test", () => {
  /**
   * The ledger against the design authority. A clause the roadmap gains, loses
   * or rewords fails here until this table says where it is proven, so the
   * exit test cannot quietly grow a promise nothing answers.
   */
  it("holds every clause the roadmap states, in the roadmap's words", () => {
    expect(CLAUSES.map((clause) => clause.says).join(" ")).toBe(
      exitTestOf("Stage 2: Tools and the loop"),
    )
  })

  // Each row names a test that exists. A proof renamed is a row to update.
  it.each(proofs)("$file answers $says with $test", ({ file, test }) => {
    expect(readFileSync(join(ROOT, file), "utf8")).toContain(`"${test}"`)
  })
})
