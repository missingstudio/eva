import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The parity matrix, as a gate rather than a claim.
 *
 * [docs/reference/parity.md] says what each of the four doors can do and names
 * the test that proves each cell. A page cannot fail, so a proof that is
 * renamed or deleted used to rot there in silence. This suite carries the same
 * matrix as TypeScript — every row, every door, every verdict, every
 * citation — and each row names a test that has to exist.
 *
 * It reads no document. A suite that parses prose makes a page a build gate,
 * and a page that cannot be reworded is a page nobody improves. So the two are
 * kept by hand and kept together: **a cell edited on the page is edited here,
 * and a citation added here is added there.** The page's section 5 says the
 * same thing from the other side.
 *
 * It proves no behaviour of its own. Every cell is already proven by the
 * ticket that built the thing it is about, and re-proving forty-eight cells in
 * one place would be forty-eight copies to keep in step.
 * `stage-2-exit.test.ts` and `w2-exit.test.ts` are the same shape against the
 * roadmap's exit tests.
 */

const ROOT = join(new URL(".", import.meta.url).pathname, "..", "..", "..")

// What a cell names: a test the file holds, or a token its source declares.
type Citation =
  | { readonly file: string; readonly test: string }
  | { readonly file: string; readonly token: string }

type Door = "Terminal" | "Pipe" | "Page" | "Wire"

/**
 * `proven` — a test names the behaviour. `refused` — the door declares it
 * cannot, and a test holds it to the refusal. `none` — neither, which is the
 * defect the matrix exists to find.
 */
type Verdict = "proven" | "refused" | "none"

interface Cell {
  readonly door: Door
  readonly verdict: Verdict
  // What the page cites as the proof of the verdict.
  readonly proofs: readonly Citation[]
  // What it cites while saying what the cell leaves uncovered.
  readonly limits: readonly Citation[]
}

interface Row {
  // The interaction, in the words the matrix uses.
  readonly says: string
  readonly cells: readonly Cell[]
}

const MATRIX: readonly Row[] = [
  {
    says: "Open a Session, and see the Sessions that exist",
    cells: [
      {
        door: "Terminal",
        verdict: "proven",
        proofs: [
          {
            file: "plugins/commands/src/index.test.ts",
            test: "offers every Session Eva holds, and follows the one that is taken",
          },
          {
            file: "plugins/commands/src/index.test.ts",
            test: "says Eva holds no Session rather than drawing an empty panel",
          },
          { file: "plugins/tui/src/surface.test.ts", test: "shows the Session a command selected" },
        ],
        limits: [
          {
            file: "plugins/tui/src/surface.test.ts",
            test: "hands the row back on enter, and closes",
          },
        ],
      },
      {
        door: "Pipe",
        verdict: "none",
        proofs: [
          {
            file: "apps/cli/src/conversation.test.ts",
            test: "keeps every Run in one session's fold, in order",
          },
        ],
        limits: [],
      },
      {
        door: "Page",
        verdict: "proven",
        proofs: [
          {
            file: "apps/web/src/shell.test.tsx",
            test: "offers a new Session, and takes no press when it was drawn with nowhere to send one",
          },
          {
            file: "apps/web/src/shell.test.tsx",
            test: "names every Session Eva holds, with its Header",
          },
        ],
        limits: [],
      },
      {
        door: "Wire",
        verdict: "proven",
        proofs: [
          {
            file: "plugins/api/src/routes.test.ts",
            test: "opens a Session, and the listing then holds it",
          },
          {
            file: "plugins/api/src/client/transport.test.ts",
            test: "opens a Session, and the listing after it holds the one it handed back",
          },
        ],
        limits: [],
      },
    ],
  },
  {
    says: "Prompt, and watch the Run live",
    cells: [
      {
        door: "Terminal",
        verdict: "proven",
        proofs: [
          {
            file: "plugins/tui/src/surface.test.ts",
            test: "becomes a prompt when it is not a command",
          },
          {
            file: "plugins/tui/src/surface.test.ts",
            test: "shows streamed text in the live area while the Run is open",
          },
        ],
        limits: [],
      },
      {
        door: "Pipe",
        verdict: "proven",
        proofs: [
          { file: "apps/cli/src/argv.test.ts", test: "reads a prompt behind --print" },
          {
            file: "apps/cli/src/conversation.test.ts",
            test: "streams the output as it arrives rather than after the Run",
          },
        ],
        limits: [],
      },
      {
        door: "Page",
        verdict: "proven",
        proofs: [
          {
            file: "packages/client-runtime/src/loop.test.ts",
            test: "dispatches a line and opens the Run it turned out to mean",
          },
          {
            file: "apps/web/src/session.test.tsx",
            test: "draws what the open Run has streamed, and nothing around it",
          },
        ],
        limits: [],
      },
      {
        door: "Wire",
        verdict: "proven",
        proofs: [
          {
            file: "plugins/api/src/routes.test.ts",
            test: "opens a Run from a Prompt, and answers nothing back",
          },
          {
            file: "packages/conformance/src/session-api-contract.test.ts",
            test: "streams the Run live to a watch that carries no cursor",
          },
        ],
        limits: [],
      },
    ],
  },
  {
    says: "Queue a line behind an open Run; steer into one deliberately",
    cells: [
      {
        door: "Terminal",
        verdict: "proven",
        proofs: [
          {
            file: "plugins/tui/src/surface.test.ts",
            test: "runs a line typed during a Run after the Run closes",
          },
          {
            file: "plugins/tui/src/surface.test.ts",
            test: "says how many lines wait behind the open Run",
          },
          { file: "plugins/tui/src/line.test.ts", test: "steers the trimmed line on ctrl+s" },
          {
            file: "packages/conformance/src/tui.test.ts",
            test: "$binding is acted on, never swallowed",
          },
        ],
        limits: [],
      },
      { door: "Pipe", verdict: "none", proofs: [], limits: [] },
      {
        door: "Page",
        verdict: "proven",
        proofs: [
          {
            file: "packages/client-runtime/src/loop.test.ts",
            test: "settles the closed Run before the line that waited moves",
          },
          {
            file: "packages/client-runtime/src/loop.test.ts",
            test: "steers the open Run rather than queueing behind it",
          },
          {
            file: "apps/web/src/session.test.tsx",
            test: "says how many lines wait behind the Run that is open",
          },
        ],
        limits: [],
      },
      {
        door: "Wire",
        verdict: "none",
        proofs: [
          {
            file: "plugins/api/src/routes.test.ts",
            test: "carries a steer with the target it named",
          },
        ],
        limits: [],
      },
    ],
  },
  {
    says: "Cancel",
    cells: [
      {
        door: "Terminal",
        verdict: "proven",
        proofs: [
          {
            file: "plugins/tui/src/surface.test.ts",
            test: "cancels the Run it was pressed against",
          },
          {
            file: "packages/conformance/src/tui.test.ts",
            test: "cancels, quits, submits, and breaks the line",
          },
        ],
        limits: [],
      },
      {
        door: "Pipe",
        verdict: "proven",
        proofs: [
          {
            file: "apps/cli/src/conversation.test.ts",
            test: "keeps the partial work and closes the Run cancelled, leaving a foldable trace",
          },
        ],
        limits: [],
      },
      {
        door: "Page",
        verdict: "proven",
        proofs: [
          {
            file: "apps/web/src/composer.test.tsx",
            test: "offers a stop only while a Run is open",
          },
          {
            file: "packages/client-runtime/src/loop.test.ts",
            test: "stops the Run on a cancel before telling Eva, and drops the queue",
          },
        ],
        limits: [],
      },
      {
        door: "Wire",
        verdict: "proven",
        proofs: [
          {
            file: "plugins/api/src/routes.test.ts",
            test: "stops a Run with the cause the caller named",
          },
          {
            file: "packages/conformance/src/session-api-write.test.ts",
            test: "stops a Run in flight, and the record says so — $name",
          },
        ],
        limits: [],
      },
    ],
  },
  {
    says: "Answer a permission request with any of the four options — and lose the race to another door gracefully",
    cells: [
      {
        door: "Terminal",
        verdict: "proven",
        proofs: [
          {
            file: "plugins/tui/src/surface.test.ts",
            test: "answers a permission request with the option a person named",
          },
          {
            file: "plugins/tui/src/surface.test.ts",
            test: "retires the prompt when the other door answers",
          },
          {
            file: "packages/core/src/deciding.test.ts",
            test: "reads an option from its id, or from the words a person is offered",
          },
        ],
        limits: [],
      },
      {
        door: "Pipe",
        verdict: "refused",
        proofs: [
          { file: "plugins/print/src/index.ts", token: "interactive: false" },
          {
            file: "packages/boot/src/permission.test.ts",
            test: "is a denial when the surface takes no input",
          },
          {
            file: "apps/cli/src/surface.test.ts",
            test: "asks the surfaces whose rows take input, and passes over the rest",
          },
        ],
        limits: [],
      },
      {
        door: "Page",
        verdict: "proven",
        proofs: [
          {
            file: "apps/web/src/session.test.tsx",
            test: "offers the four options where a question stands",
          },
          {
            file: "plugins/web/src/ask.test.ts",
            test: "withdraws the question when the other door answers",
          },
          {
            file: "packages/conformance/src/two-surfaces.test.ts",
            test: "takes the answer the terminal gave, and withdraws the question from the page",
          },
        ],
        limits: [],
      },
      {
        door: "Wire",
        verdict: "proven",
        proofs: [
          {
            file: "packages/conformance/src/session-api-write.test.ts",
            test: "lets the call run on $optionId",
          },
          {
            file: "packages/conformance/src/session-api-write.test.ts",
            test: "denies the call on $optionId",
          },
          {
            file: "packages/conformance/src/both-doors.test.ts",
            test: "drops a second answer, and it cannot reach the next request of that id",
          },
        ],
        limits: [],
      },
    ],
  },
  {
    says: "Switch the model, choosing from what the Catalog knows",
    cells: [
      {
        door: "Terminal",
        verdict: "proven",
        proofs: [
          {
            file: "plugins/commands/src/index.test.ts",
            test: "offers every model, and sets the one that is taken",
          },
          {
            file: "plugins/commands/src/index.test.ts",
            test: "says what the Catalog holds, and nothing it does not",
          },
          {
            file: "plugins/tui/src/surface.test.ts",
            test: "hands the row back on enter, and closes",
          },
        ],
        limits: [],
      },
      {
        door: "Pipe",
        verdict: "proven",
        proofs: [
          {
            file: "apps/cli/src/argv.test.ts",
            test: "carries --model into the invocation behind --print",
          },
          {
            file: "packages/kernel/src/resolution.test.ts",
            test: "gives a flag the last word over every file and the environment",
          },
        ],
        limits: [
          {
            file: "plugins/commands/src/index.test.ts",
            test: "says so when the argument is not a model reference",
          },
        ],
      },
      {
        door: "Page",
        verdict: "proven",
        proofs: [
          {
            file: "apps/web/src/models.test.tsx",
            test: "offers the rows the terminal's panel picks from, and no others",
          },
          { file: "apps/web/src/models.test.tsx", test: "stands on the Session page" },
        ],
        limits: [],
      },
      {
        door: "Wire",
        verdict: "proven",
        proofs: [
          {
            file: "plugins/api/src/routes.test.ts",
            test: "answers every model the Catalog knows, as the rows the panel picks from",
          },
          {
            file: "plugins/api/src/routes.test.ts",
            test: "sets the model, and the read half hands the new one back",
          },
          {
            file: "plugins/api/src/client/transport.test.ts",
            test: "reads every model the Catalog behind the wire knows",
          },
        ],
        limits: [],
      },
    ],
  },
  {
    says: "See what the Session spent",
    cells: [
      {
        door: "Terminal",
        verdict: "proven",
        proofs: [
          {
            file: "plugins/tui/src/console.test.ts",
            test: "spells the tokens and the cost the way the contract does",
          },
          {
            file: "plugins/tui/src/console.test.ts",
            test: "says nothing about cost when the Session has not run",
          },
        ],
        limits: [],
      },
      {
        door: "Pipe",
        verdict: "proven",
        proofs: [
          {
            file: "apps/cli/src/conversation.test.ts",
            test: "reports the whole session's spend, and says so when cost is unreported",
          },
          {
            file: "plugins/print/src/cost-line.test.ts",
            test: "reads as the shape the product shows",
          },
        ],
        limits: [],
      },
      {
        door: "Page",
        verdict: "proven",
        proofs: [
          { file: "apps/web/src/session.test.tsx", test: "shows what a Provider reported" },
          {
            file: "apps/web/src/session.test.tsx",
            test: "says the cost is unreported rather than showing a figure nobody gave",
          },
        ],
        limits: [],
      },
      {
        door: "Wire",
        verdict: "proven",
        proofs: [
          {
            file: "plugins/api/src/client/transport.test.ts",
            test: "reads back what a Provider reported, and prices nothing itself",
          },
        ],
        limits: [
          {
            file: "plugins/api/src/client/transport.test.ts",
            test: "folds a Session from the record, and ends where the record ends",
          },
        ],
      },
    ],
  },
  {
    says: "Survive a dropped pipe: say so, catch up by Cursor, never duplicate",
    cells: [
      {
        door: "Terminal",
        verdict: "proven",
        proofs: [
          {
            file: "plugins/tui/src/surface.test.ts",
            test: "says the pipe is gone, and stops saying so when it is back",
          },
          {
            file: "plugins/tui/src/surface.test.ts",
            test: "costs one repaint, and the record shows every line once",
          },
        ],
        limits: [],
      },
      { door: "Pipe", verdict: "none", proofs: [], limits: [] },
      {
        door: "Page",
        verdict: "proven",
        proofs: [
          { file: "apps/web/src/session.test.tsx", test: "says the pipe is down while it is down" },
          {
            file: "apps/web/src/composer.test.tsx",
            test: "refuses the send visibly rather than taking the line",
          },
          {
            file: "packages/conformance/src/page-converges.test.ts",
            test: "converges from the Cursor it holds when the pipe drops mid-Run",
          },
        ],
        limits: [],
      },
      {
        door: "Wire",
        verdict: "proven",
        proofs: [
          {
            file: "plugins/api/src/routes.test.ts",
            test: "numbers each frame from the Cursor it was asked with",
          },
          {
            file: "plugins/api/src/client/transport.test.ts",
            test: "says so through health while it is down, and says it is back",
          },
          {
            file: "plugins/api/src/client/transport.test.ts",
            test: "misses nothing between the two calls, and says nothing folded twice",
          },
        ],
        limits: [],
      },
    ],
  },
  {
    says: "Run a Workflow, and read its one answer",
    cells: [
      {
        door: "Terminal",
        verdict: "proven",
        proofs: [
          {
            file: "apps/cli/src/main.test.ts",
            test: "runs the named row and the last Run's text reaches the output exactly once",
          },
          {
            file: "apps/cli/src/main.test.ts",
            test: "writes one answer for a three-Step Workflow, not three",
          },
          {
            file: "apps/cli/src/main.test.ts",
            test: "runs the .eva workflow by its file name, over the --input file",
          },
        ],
        limits: [],
      },
      { door: "Pipe", verdict: "none", proofs: [], limits: [] },
      { door: "Page", verdict: "none", proofs: [], limits: [] },
      {
        door: "Wire",
        verdict: "none",
        proofs: [
          { file: "plugins/api/src/wire.test.ts", test: "reads back a $kind as it was written" },
        ],
        limits: [],
      },
    ],
  },
  {
    says: "Read the resolved config, and where each key came from",
    cells: [
      {
        door: "Terminal",
        verdict: "proven",
        proofs: [
          {
            file: "apps/cli/src/main.test.ts",
            test: "prints the model and the file each key came from",
          },
          {
            file: "apps/cli/src/main.test.ts",
            test: "names the command line, not the file, when a flag set the model",
          },
          {
            file: "apps/cli/src/main.test.ts",
            test: "answers even when the config names a plugin nobody has",
          },
        ],
        limits: [],
      },
      { door: "Pipe", verdict: "none", proofs: [], limits: [] },
      { door: "Page", verdict: "none", proofs: [], limits: [] },
      { door: "Wire", verdict: "none", proofs: [], limits: [] },
    ],
  },
  {
    says: "Grant this directory trust, and drop the grant",
    cells: [
      {
        door: "Terminal",
        verdict: "proven",
        proofs: [
          {
            file: "apps/cli/src/main.test.ts",
            test: "records the directory beside the person's own config",
          },
          { file: "apps/cli/src/main.test.ts", test: "drops the grant again" },
          {
            file: "apps/cli/src/main.test.ts",
            test: "says nothing was written when there was no grant to drop",
          },
        ],
        limits: [],
      },
      { door: "Pipe", verdict: "none", proofs: [], limits: [] },
      { door: "Page", verdict: "none", proofs: [], limits: [] },
      { door: "Wire", verdict: "none", proofs: [], limits: [] },
    ],
  },
  {
    says: "Check a rule set, and name the fault in a malformed one",
    cells: [
      {
        door: "Terminal",
        verdict: "proven",
        proofs: [
          {
            file: "apps/cli/src/main.test.ts",
            test: "exits nonzero on a malformed rule set, and names the fault",
          },
          {
            file: "apps/cli/src/main.test.ts",
            test: "names every fault, so a person fixes the file once",
          },
          {
            file: "apps/cli/src/main.test.ts",
            test: "counts the rules of a rule set it reads whole, and exits 0",
          },
          { file: "apps/cli/src/main.test.ts", test: "exits nonzero on a rule no call can reach" },
        ],
        limits: [],
      },
      { door: "Pipe", verdict: "none", proofs: [], limits: [] },
      { door: "Page", verdict: "none", proofs: [], limits: [] },
      { door: "Wire", verdict: "none", proofs: [], limits: [] },
    ],
  },
]

/**
 * The citations the page makes in prose rather than in a cell: the layer below
 * a row, the bench a row should be read against, and the two commands section
 * 4 covers. They are proofs like any other, so they are held like any other.
 */
interface Note {
  // The heading the note sits under.
  readonly beside: string
  readonly cites: readonly Citation[]
}

const NOTES: readonly Note[] = [
  {
    beside: "1. Open a Session, and see the Sessions that exist",
    cites: [
      {
        file: "packages/conformance/src/session-api.test.ts",
        test: "opens a Session the store then lists",
      },
      {
        file: "packages/conformance/src/list-order.test.ts",
        test: "puts the most recently updated Session first, titled",
      },
    ],
  },
  {
    beside: "3. Queue a line behind an open Run; steer into one deliberately",
    cites: [
      {
        file: "packages/client-runtime/src/loop.test.ts",
        test: "waits its turn while a Run is open, rather than racing it",
      },
      {
        file: "packages/client-runtime/src/loop.test.ts",
        test: "steers the open Run rather than waiting behind it",
      },
    ],
  },
  {
    beside:
      "5. Answer a permission request with any of the four options — and lose the race to another door gracefully",
    cites: [
      {
        file: "packages/conformance/src/two-surfaces.test.ts",
        test: "records one decision for a request both doors answered",
      },
      {
        file: "plugins/tui/src/surface.test.ts",
        test: "retires the prompt when the other door answers",
      },
    ],
  },
  {
    beside: "8. Survive a dropped pipe: say so, catch up by Cursor, never duplicate",
    cites: [
      {
        file: "packages/client-runtime/src/reconnect.test.ts",
        test: "costs a repaint, and every committed payload reaches the caller once",
      },
      {
        file: "plugins/api/src/routes.test.ts",
        test: "answers the same key twice and opens one Run",
      },
    ],
  },
  {
    beside: "9. Run a Workflow, and read its one answer",
    cites: [
      {
        file: "packages/conformance/src/workflow-validator.test.ts",
        test: "repairs exactly once, and both Verdicts reach the record",
      },
      {
        file: "packages/conformance/src/workflow-prompt.test.ts",
        test: "fills a Step's Instruction from the row eva.prompt projected",
      },
    ],
  },
  {
    beside: "10. Read the resolved config, and where each key came from",
    cites: [
      { file: "plugins/config/src/index.test.ts", test: "names a key that reached nothing" },
      {
        file: "apps/cli/src/main.test.ts",
        test: "names a key nothing reads against the file that set it",
      },
    ],
  },
  {
    beside: "11. Grant this directory trust, and drop the grant",
    cites: [
      {
        file: "packages/kernel/src/resolution.test.ts",
        test: "does not read a project directory without a grant, and says which",
      },
      {
        file: "packages/kernel/src/resolution.test.ts",
        test: "reads the project directory once the grant is there",
      },
      {
        file: "apps/cli/src/main.test.ts",
        test: "says which project file it did not read, and how to allow it",
      },
    ],
  },
  {
    beside: "12. Check a rule set, and name the fault in a malformed one",
    cites: [
      {
        file: "packages/conformance/src/tool-policy.test.ts",
        test: "refuses rm -rf /, and the command never reaches the Sandbox",
      },
    ],
  },
  {
    beside: "4. Two commands, reachable rather than re-implemented",
    cites: [
      {
        file: "packages/conformance/src/two-surfaces.test.ts",
        test: "changes the mode the terminal's next write is judged by",
      },
      {
        file: "packages/conformance/src/two-surfaces.test.ts",
        test: "reverses a write the terminal's Run made",
      },
      {
        file: "plugins/api/src/routes.test.ts",
        test: "lists what it would have asked, because this door draws no panel",
      },
    ],
  },
]

const DOORS: readonly Door[] = ["Terminal", "Pipe", "Page", "Wire"]

// A test is found by its own words; a token is found as the source spells it.
const spelling = (cite: Citation): string => ("test" in cite ? `"${cite.test}"` : cite.token)

const cited = [
  ...MATRIX.flatMap((row) =>
    row.cells.flatMap((cell) =>
      [...cell.proofs, ...cell.limits].map((cite) => ({
        file: cite.file,
        names: spelling(cite),
        where: `${row.says}, at the ${cell.door}`,
      })),
    ),
  ),
  ...NOTES.flatMap((note) =>
    note.cites.map((cite) => ({
      file: cite.file,
      names: spelling(cite),
      where: `the note beside ${note.beside}`,
    })),
  ),
]

const cells = MATRIX.flatMap((row) => row.cells)

describe("every citation the parity matrix makes", () => {
  // A proof renamed or deleted is a citation to follow, on the page and here.
  it.each(cited)("$where names $names in $file", ({ file, names }) => {
    expect(readFileSync(join(ROOT, file), "utf8")).toContain(names)
  })
})

describe("the shape the matrix holds", () => {
  it.each(MATRIX)("$says covers the four doors, in order", ({ cells: row }) => {
    expect(row.map((cell) => cell.door)).toEqual(DOORS)
  })

  it("names a proof for every cell that is not a gap", () => {
    const silent = cells.filter((cell) => cell.verdict !== "none" && cell.proofs.length === 0)
    expect(silent).toEqual([])
  })

  /**
   * The one number the page spells out in words. It is here so that a row
   * added on one side and not the other fails rather than passes quietly.
   */
  it("counts what the page says it counts", () => {
    const tally = (verdict: Verdict): number =>
      cells.filter((cell) => cell.verdict === verdict).length
    expect({
      cells: cells.length,
      proven: tally("proven"),
      refused: tally("refused"),
      none: tally("none"),
    }).toEqual({ cells: 48, proven: 31, refused: 1, none: 16 })
  })
})
