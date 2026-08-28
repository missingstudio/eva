import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The W2 exit test, as a gate rather than a claim.
 *
 * It is `stage-2-exit.test.ts`'s shape and for its reasons. Every clause the
 * roadmap states is proven by the ticket that built the thing it is about,
 * over a live kernel with no model in the room, so this suite proves none of
 * them a second time. It holds the ledger: the roadmap's own sentences, and
 * the test that answers each one.
 *
 * Two rules make it a gate. A clause the roadmap adds or rewords and this
 * ledger does not carry fails here, because the clauses are compared against
 * the roadmap's own words. And a proof that is renamed or deleted fails here,
 * because each row names a test that has to exist. `plans/` is working state
 * and goes when the surface stage ends; the roadmap and this ledger are what
 * is left.
 *
 * Where W2 sits in the roadmap is the one thing that differs. A stage is a
 * `###` heading of its own; every surface stage is a bold paragraph under one
 * heading, so the extractor takes the W2 slice before it looks for the
 * paragraph.
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
    says: "start a Session in the terminal, answer its permission request in the browser, finish it in the terminal — the Trace shows one Session and nothing says two surfaces were involved.",
    proofs: [
      {
        file: "packages/conformance/src/two-surfaces.test.ts",
        test: "starts in the terminal, is answered in the browser, and finishes in the terminal",
      },
      {
        file: "packages/conformance/src/two-surfaces.test.ts",
        test: "leaves one Session on the Trace, and no record that names a surface",
      },
      /**
       * The seam the other way round: a line the page ran reaches the Domains
       * of the process the Run is in, so what the terminal writes next is
       * judged by what the browser said. A door that ran the line for itself
       * would leave the Run under the mode it already had.
       */
      {
        file: "packages/conformance/src/two-surfaces.test.ts",
        test: "changes the mode the terminal's next write is judged by",
      },
      {
        file: "packages/conformance/src/two-surfaces.test.ts",
        test: "reverses a write the terminal's Run made",
      },
      // And the record itself: below the Session API nothing knows which
      // surface asked, so the two doors are driven in turn and compared.
      {
        file: "packages/conformance/src/session-api-write.test.ts",
        test: "leaves the same record whichever door it came through",
      },
    ],
  },
  {
    says: "Answer the same request from both at once and exactly one Resolution is recorded.",
    proofs: [
      {
        file: "packages/conformance/src/two-surfaces.test.ts",
        test: "records one decision for a request both doors answered",
      },
      {
        file: "packages/conformance/src/two-surfaces.test.ts",
        test: "takes the answer the browser gave, and retires the prompt in the terminal",
      },
      {
        file: "packages/conformance/src/two-surfaces.test.ts",
        test: "takes the answer the terminal gave, and withdraws the question from the page",
      },
      // The race itself, at the gate every door composes, with each door
      // winning in turn.
      {
        file: "apps/cli/src/surface.test.ts",
        test: "reads the answer from $answers, and retires the prompt at $waits",
      },
      // The other half of "the first answer wins": the second one lands on
      // nothing, and cannot reach the next request that carries the same id.
      {
        file: "packages/conformance/src/both-doors.test.ts",
        test: "drops a second answer, and it cannot reach the next request of that id",
      },
    ],
  },
]

/**
 * The two clauses the stage plan added. Both are exercises of claims the
 * roadmap's W2 paragraph already makes rather than new promises — "Sends carry
 * a client-minted id, so a retried send after a flaky reconnect is one Run",
 * and the write half a page reaches a Session through at all.
 *
 * They are held outside the verbatim comparison for the reason stage 2's
 * `SOCKET` clause is: the comparison is against the roadmap's own words, and a
 * plan's sentence is not one of them.
 */
const ADDED: readonly Clause[] = [
  {
    says: "and a retried submit under one idempotency key lands once.",
    proofs: [
      {
        file: "packages/conformance/src/session-api-write.test.ts",
        test: "opens one Run on the Trace, however often the caller asks again",
      },
      {
        file: "plugins/api/src/client/transport.test.ts",
        test: "opens one Run when a write lands and its answer is lost",
      },
      {
        file: "plugins/api/src/client/transport.test.ts",
        test: "opens one Session when a create lands and its answer is lost",
      },
    ],
  },
  {
    says: "and a Session opened over the wire is listed, attached and finished.",
    proofs: [
      {
        file: "packages/conformance/src/session-api-write.test.ts",
        test: "is listed, attached and finished through the door that opened it",
      },
      // Every method of the contract, over the socket beside two fillers, so
      // the reads this round trip leans on are held to the kernel's answers.
      {
        file: "packages/conformance/src/session-api-contract.test.ts",
        test: "the Session API, filled by $name",
      },
    ],
  },
  /**
   * The parity goal, made falsifiable. The clauses above are one scene between
   * two doors; this one is every basic interaction at every door, and it is a
   * clause rather than a claim because `docs/reference/parity.md` names a proof
   * or a refusal in each cell and a suite resolves them.
   */
  {
    says: "and every row of the basic interaction set has, for every door, a proof or a refusal that names itself.",
    proofs: [
      {
        file: "packages/conformance/src/parity.test.ts",
        test: "carries the eight interactions, in the set's own words",
      },
      {
        file: "packages/conformance/src/parity.test.ts",
        test: "$file holds $needle",
      },
    ],
  },
]

/**
 * W2's exit test, out of the design authority itself.
 *
 * A stage has a `###` heading and its exit test is the paragraph under it. The
 * surface stages share one heading — W0 through W5 are bold paragraphs inside
 * it — so the slice from this surface's paragraph to the next one is taken
 * first, and the exit test is found inside that. The paragraph is wrapped in
 * the file, so the lines are joined the way a reader reads them.
 */
const exitTestOf = (heading: string, surface: string): string => {
  const doc = readFileSync(join(ROOT, "docs", "roadmap.md"), "utf8")
  const section = doc.split("\n### ").find((one) => one.startsWith(heading))
  const paragraphs = (section ?? "").split("\n\n")

  const from = paragraphs.findIndex((one) => one.startsWith(`**${surface} —`))
  const next = paragraphs.findIndex((one, at) => at > from && /^\*\*W\d+ —/.test(one))
  const held = from === -1 ? [] : paragraphs.slice(from, next === -1 ? undefined : next)

  const paragraph = held.find((one) => one.startsWith("**Exit test:**"))
  return (paragraph ?? "").replace("**Exit test:** ", "").split("\n").join(" ")
}

const proofs = [...CLAUSES, ...ADDED].flatMap((clause) =>
  clause.proofs.map((proof) => ({ ...proof, says: clause.says })),
)

describe("the W2 exit test", () => {
  /**
   * The ledger against the design authority. A clause the roadmap gains, loses
   * or rewords fails here until this table says where it is proven, so the
   * exit test cannot quietly grow a promise nothing answers.
   */
  it("holds every clause the roadmap states, in the roadmap's words", () => {
    expect(CLAUSES.map((clause) => clause.says).join(" ")).toBe(
      exitTestOf("The web page — W0 through W5", "W2"),
    )
  })

  // Each row names a test that exists. A proof renamed is a row to update.
  it.each(proofs)("$file answers $says with $test", ({ file, test }) => {
    expect(readFileSync(join(ROOT, file), "utf8")).toContain(`"${test}"`)
  })
})
