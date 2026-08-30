# Parity

Eva has four doors, and one contract behind all of them. This page says what
each door can do, and names the test that proves it. A cell that names neither
a proof nor a refusal is a defect, and it is written here as one.

The matrix holds forty-eight cells: thirty-one are proven, one is a refusal
that names itself, and sixteen are neither. The sixteen are the work this page
exists to find, and section 3 says what is absent in each.

This page is written by hand. Every citation on it names a test in the tree,
and section 5 says the rules a change to it holds.

## 1. The four doors

| Door         | How it is started                   | What it is                                |
| ------------ | ----------------------------------- | ----------------------------------------- |
| **Terminal** | `eva`                               | `eva.tui`, drawing through `packages/tui` |
| **Pipe**     | `eva -p`                            | `eva.print` — one answer, then exit       |
| **Page**     | `eva --web`, beside the terminal    | `apps/web` over `eva.web`                 |
| **Wire**     | `eva serve --web`, with no terminal | `eva.api`, which any program can curl     |

The page has two spellings and they are not the same run. `eva --web` runs the
page beside the terminal, in one process and against one Session, so a request
asked in the terminal is answerable in the browser. `eva serve --web` serves
the page and its API with no terminal, which is what a person runs when the
browser, or a program with a socket, is the only door they want.

One contract stands behind the four: the ten methods of `SessionAPI`
([../../packages/core/src/session-api.ts](../../packages/core/src/session-api.ts)).
How a surface plugs in is [architecture.md](architecture.md) section 14; what
each door does with that is this page.

## 2. The matrix

The rows are the basic interaction set. A door is done on a row when the row is
implemented, or when the door declares a deterministic refusal that says why —
the pipe's `interactive: false` is the pattern. A button that silently does
nothing is not parity, and neither is a row nobody has written down.

Each cell reads one of three ways:

- **proven** — a test names the behaviour, and section 3 names the test.
- **refused** — the door declares it cannot, the refusal has a name, and a test
  holds the door to it.
- **none** — neither. This is the defect the set exists to find, and section 3
  says what is absent.

| Interaction                                                                                                | Terminal | Pipe    | Page   | Wire   |
| ---------------------------------------------------------------------------------------------------------- | -------- | ------- | ------ | ------ |
| 1. Open a Session, and see the Sessions that exist                                                         | proven   | none    | proven | proven |
| 2. Prompt, and watch the Run live                                                                          | proven   | proven  | proven | proven |
| 3. Queue a line behind an open Run; steer into one deliberately                                            | proven   | none    | proven | none   |
| 4. Cancel                                                                                                  | proven   | proven  | proven | proven |
| 5. Answer a permission request with any of the four options — and lose the race to another door gracefully | proven   | refused | proven | proven |
| 6. Switch the model, choosing from what the Catalog knows                                                  | proven   | proven  | proven | proven |
| 7. See what the Session spent                                                                              | proven   | proven  | proven | proven |
| 8. Survive a dropped pipe: say so, catch up by Cursor, never duplicate                                     | proven   | none    | proven | proven |
| 9. Run a Workflow, and read its one answer                                                                 | proven   | none    | none   | none   |
| 10. Read the resolved config, and where each key came from                                                 | proven   | none    | none   | none   |
| 11. Grant this directory trust, and drop the grant                                                         | proven   | none    | none   | none   |
| 12. Check a rule set, and name the fault in a malformed one                                                | proven   | none    | none   | none   |

Rows 1 to 8 are the chat. Rows 9 to 12 are the rest of a first hour, and they
arrive with four proofs and twelve gaps: that ratio is the finding. The four
are verbs of the command line — `eva run`, `eva config show`, `eva trust` and
`eva policy check` — so the Terminal column grades the command line a person
types beside the surface. `eva.tui` holds a command row for none of them, and
each Terminal cell says so. No cell in the four is refused, because no door
declares a refusal for any of them. A declared refusal costs less than an
implementation, and it tells a person what this product does not do.

## 3. Where each cell is proven

A citation reads `` `file` › "test" `` for a test, and `` `file` › `token` ``
for a refusal the source declares. Several citations in one cell are separated
by `·`.

### 1. Open a Session, and see the Sessions that exist

| Door     | Verdict | Where it is proven                                                                                                                                                                                                                                                                              | What is not covered                                                                                                                                                                                                                                 |
| -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal | proven  | `plugins/commands/src/index.test.ts` › "offers every Session Eva holds, and follows the one that is taken" · `plugins/commands/src/index.test.ts` › "says Eva holds no Session rather than drawing an empty panel" · `plugins/tui/src/surface.test.ts` › "shows the Session a command selected" | The terminal's own suite proves the panel with a stand-in command row, not with `/sessions`: `plugins/tui/src/surface.test.ts` › "hands the row back on enter, and closes". The rows and the opening are proven where they live, in `eva.commands`. |
| Pipe     | none    | `apps/cli/src/conversation.test.ts` › "keeps every Run in one session's fold, in order"                                                                                                                                                                                                         | The listing. `eva -p` opens one Session per invocation and lists none. `PrintOptions.session` takes an existing Session, and no flag fills it.                                                                                                      |
| Page     | proven  | `apps/web/src/shell.test.tsx` › "offers a new Session, and takes no press when it was drawn with nowhere to send one" · `apps/web/src/shell.test.tsx` › "names every Session Eva holds, with its Header"                                                                                        | —                                                                                                                                                                                                                                                   |
| Wire     | proven  | `plugins/api/src/routes.test.ts` › "opens a Session, and the listing then holds it" · `plugins/api/src/client/transport.test.ts` › "opens a Session, and the listing after it holds the one it handed back"                                                                                     | —                                                                                                                                                                                                                                                   |

`/sessions` is what the terminal reads the listing with, and taking a row is
opening it — the same `select` `/clear` uses, so the door follows a Session it
did not open. The command answers in words where a door draws no panel, so the
answer is the same answer at every door that asks.

The listing a door reads is the store's, and the store's own round trip is held
one layer down: `packages/conformance/src/session-api.test.ts` › "opens a
Session the store then lists", and the order in
`packages/conformance/src/list-order.test.ts` › "puts the most recently updated
Session first, titled". The two-surfaces bench runs with no session store, so
what it lists is what that process opened.

### 2. Prompt, and watch the Run live

| Door     | Verdict | Where it is proven                                                                                                                                                                                            | What is not covered |
| -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Terminal | proven  | `plugins/tui/src/surface.test.ts` › "becomes a prompt when it is not a command" · `plugins/tui/src/surface.test.ts` › "shows streamed text in the live area while the Run is open"                            | —                   |
| Pipe     | proven  | `apps/cli/src/argv.test.ts` › "reads a prompt behind --print" · `apps/cli/src/conversation.test.ts` › "streams the output as it arrives rather than after the Run"                                            | —                   |
| Page     | proven  | `packages/client-runtime/src/loop.test.ts` › "dispatches a line and opens the Run it turned out to mean" · `apps/web/src/session.test.tsx` › "draws what the open Run has streamed, and nothing around it"    | —                   |
| Wire     | proven  | `plugins/api/src/routes.test.ts` › "opens a Run from a Prompt, and answers nothing back" · `packages/conformance/src/session-api-contract.test.ts` › "streams the Run live to a watch that carries no cursor" | —                   |

### 3. Queue a line behind an open Run; steer into one deliberately

| Door     | Verdict | Where it is proven                                                                                                                                                                                                                                                                                                                       | What is not covered                                                                                                                                                                  |
| -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Terminal | proven  | `plugins/tui/src/surface.test.ts` › "runs a line typed during a Run after the Run closes" · `plugins/tui/src/surface.test.ts` › "says how many lines wait behind the open Run" · `plugins/tui/src/line.test.ts` › "steers the trimmed line on ctrl+s" · `packages/conformance/src/tui.test.ts` › "$binding is acted on, never swallowed" | —                                                                                                                                                                                    |
| Pipe     | none    | —                                                                                                                                                                                                                                                                                                                                        | Both halves. `eva -p` submits one Prompt from argv and exits, so it queues nothing and steers nothing. It declares no refusal for either; `interactive: false` answers an ask alone. |
| Page     | proven  | `packages/client-runtime/src/loop.test.ts` › "settles the closed Run before the line that waited moves" · `packages/client-runtime/src/loop.test.ts` › "steers the open Run rather than queueing behind it" · `apps/web/src/session.test.tsx` › "says how many lines wait behind the Run that is open"                                   | —                                                                                                                                                                                    |
| Wire     | none    | `plugins/api/src/routes.test.ts` › "carries a steer with the target it named"                                                                                                                                                                                                                                                            | The queue. `SessionAPI.submit` opens a Run and holds no queue — the composer fold does — and no test says what a second `submit` during an open Run does.                            |

One fold holds the queue for both composers, so the two cannot disagree:
`packages/client-runtime/src/loop.test.ts` › "waits its turn while a Run is
open, rather than racing it", and `packages/client-runtime/src/loop.test.ts` ›
"steers the open Run rather than waiting behind it". And one walk carries the
fold's answers out at both doors, so neither holds an ordering rule of its
own — each hands the walk what its door can do, and the walk performs every
action in the order the fold asked.

### 4. Cancel

| Door     | Verdict | Where it is proven                                                                                                                                                                                | What is not covered                                                                               |
| -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Terminal | proven  | `plugins/tui/src/surface.test.ts` › "cancels the Run it was pressed against" · `packages/conformance/src/tui.test.ts` › "cancels, quits, submits, and breaks the line"                            | —                                                                                                 |
| Pipe     | proven  | `apps/cli/src/conversation.test.ts` › "keeps the partial work and closes the Run cancelled, leaving a foldable trace"                                                                             | The signal that raises the interrupt. `withSignals` in `apps/cli/src/run.ts` is named by no test. |
| Page     | proven  | `apps/web/src/composer.test.tsx` › "offers a stop only while a Run is open" · `packages/client-runtime/src/loop.test.ts` › "stops the Run on a cancel before telling Eva, and drops the queue"    | —                                                                                                 |
| Wire     | proven  | `plugins/api/src/routes.test.ts` › "stops a Run with the cause the caller named" · `packages/conformance/src/session-api-write.test.ts` › "stops a Run in flight, and the record says so — $name" | —                                                                                                 |

### 5. Answer a permission request with any of the four options — and lose the race to another door gracefully

| Door     | Verdict | Where it is proven                                                                                                                                                                                                                                                                                            | What is not covered                                                                                                              |
| -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Terminal | proven  | `plugins/tui/src/surface.test.ts` › "answers a permission request with the option a person named" · `plugins/tui/src/surface.test.ts` › "retires the prompt when the other door answers" · `packages/core/src/deciding.test.ts` › "reads an option from its id, or from the words a person is offered"        | The terminal's own suite presses two of the four options. It reads all four through `optionFor`, which the core test above pins. |
| Pipe     | refused | `plugins/print/src/index.ts` › `interactive: false` · `packages/boot/src/permission.test.ts` › "is a denial when the surface takes no input" · `apps/cli/src/surface.test.ts` › "asks the surfaces whose rows take input, and passes over the rest"                                                           | —                                                                                                                                |
| Page     | proven  | `apps/web/src/session.test.tsx` › "offers the four options where a question stands" · `plugins/web/src/ask.test.ts` › "withdraws the question when the other door answers" · `packages/conformance/src/two-surfaces.test.ts` › "takes the answer the terminal gave, and withdraws the question from the page" | —                                                                                                                                |
| Wire     | proven  | `packages/conformance/src/session-api-write.test.ts` › "lets the call run on $optionId" · `packages/conformance/src/session-api-write.test.ts` › "denies the call on $optionId" · `packages/conformance/src/both-doors.test.ts` › "drops a second answer, and it cannot reach the next request of that id"    | —                                                                                                                                |

The race between two doors is one Question with one Resolution:
`packages/conformance/src/two-surfaces.test.ts` › "records one decision for a
request both doors answered". Read that bench for what it is. Its terminal is a
test `Frontend` behind the local transport and not `plugins/tui`, so it proves
the gate and not the shipped terminal. The shipped terminal's own half of the
rule — an `ask` that is interrupted is what retires its prompt — is
`plugins/tui/src/surface.test.ts` › "retires the prompt when the other door
answers".

### 6. Switch the model, choosing from what the Catalog knows

| Door     | Verdict | Where it is proven                                                                                                                                                                                                                                                                                                | What is not covered                                                                                                                                                                                                                                                                                             |
| -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal | proven  | `plugins/commands/src/index.test.ts` › "offers every model, and sets the one that is taken" · `plugins/commands/src/index.test.ts` › "says what the Catalog holds, and nothing it does not" · `plugins/tui/src/surface.test.ts` › "hands the row back on enter, and closes"                                       | The terminal's own suite proves the picker with a stand-in command row, not with `/model`. The `/model` rows and the set are proven where they live, in `eva.commands`.                                                                                                                                         |
| Pipe     | proven  | `apps/cli/src/argv.test.ts` › "carries --model into the invocation behind --print" · `packages/kernel/src/resolution.test.ts` › "gives a flag the last word over every file and the environment"                                                                                                                  | The choosing. `eva -p` takes the reference the line names and draws no panel, so nothing at this door offers what the Catalog holds. A reference the Catalog does not know is refused where every other door's is: `plugins/commands/src/index.test.ts` › "says so when the argument is not a model reference". |
| Page     | proven  | `apps/web/src/models.test.tsx` › "offers the rows the terminal's panel picks from, and no others" · `apps/web/src/models.test.tsx` › "stands on the Session page"                                                                                                                                                 | —                                                                                                                                                                                                                                                                                                               |
| Wire     | proven  | `plugins/api/src/routes.test.ts` › "answers every model the Catalog knows, as the rows the panel picks from" · `plugins/api/src/routes.test.ts` › "sets the model, and the read half hands the new one back" · `plugins/api/src/client/transport.test.ts` › "reads every model the Catalog behind the wire knows" | —                                                                                                                                                                                                                                                                                                               |

### 7. See what the Session spent

| Door     | Verdict | Where it is proven                                                                                                                                                                              | What is not covered                                                                                                                                                                                                                                                                                                                            |
| -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal | proven  | `plugins/tui/src/console.test.ts` › "spells the tokens and the cost the way the contract does" · `plugins/tui/src/console.test.ts` › "says nothing about cost when the Session has not run"     | —                                                                                                                                                                                                                                                                                                                                              |
| Pipe     | proven  | `apps/cli/src/conversation.test.ts` › "reports the whole session's spend, and says so when cost is unreported" · `plugins/print/src/cost-line.test.ts` › "reads as the shape the product shows" | —                                                                                                                                                                                                                                                                                                                                              |
| Page     | proven  | `apps/web/src/session.test.tsx` › "shows what a Provider reported" · `apps/web/src/session.test.tsx` › "says the cost is unreported rather than showing a figure nobody gave"                   | —                                                                                                                                                                                                                                                                                                                                              |
| Wire     | proven  | `plugins/api/src/client/transport.test.ts` › "reads back what a Provider reported, and prices nothing itself"                                                                                   | The estimate. No route answers cost: what a Provider reported rides the record, and the estimate is priced from a Catalog this side does not hold, so a reader here is shown the reported figure or nothing — `plugins/api/src/client/transport.test.ts` › "folds a Session from the record, and ends where the record ends" holds it to null. |

### 8. Survive a dropped pipe: say so, catch up by Cursor, never duplicate

| Door     | Verdict | Where it is proven                                                                                                                                                                                                                                                                                                           | What is not covered                                                                                                                                                                                                                                             |
| -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal | proven  | `plugins/tui/src/surface.test.ts` › "says the pipe is gone, and stops saying so when it is back" · `plugins/tui/src/surface.test.ts` › "costs one repaint, and the record shows every line once"                                                                                                                             | —                                                                                                                                                                                                                                                               |
| Pipe     | none    | —                                                                                                                                                                                                                                                                                                                            | The whole row, and the refusal for it. A pipe's connection is the process, so nothing drops and nothing is refolded. That is said in a comment in `plugins/print/src/run.ts` and nowhere the gate can read: the surface row declares `interactive` and no more. |
| Page     | proven  | `apps/web/src/session.test.tsx` › "says the pipe is down while it is down" · `apps/web/src/composer.test.tsx` › "refuses the send visibly rather than taking the line" · `packages/conformance/src/page-converges.test.ts` › "converges from the Cursor it holds when the pipe drops mid-Run"                                | —                                                                                                                                                                                                                                                               |
| Wire     | proven  | `plugins/api/src/routes.test.ts` › "numbers each frame from the Cursor it was asked with" · `plugins/api/src/client/transport.test.ts` › "says so through health while it is down, and says it is back" · `plugins/api/src/client/transport.test.ts` › "misses nothing between the two calls, and says nothing folded twice" | —                                                                                                                                                                                                                                                               |

The client runtime holds the reconnect rule once, so no surface writes it:
`packages/client-runtime/src/reconnect.test.ts` › "costs a repaint, and every
committed payload reaches the caller once". A write that is retried after a
drop is one Run, because the key is minted once:
`plugins/api/src/routes.test.ts` › "answers the same key twice and opens one
Run".

### 9. Run a Workflow, and read its one answer

| Door     | Verdict | Where it is proven                                                                                                                                                                                                                                                                                   | What is not covered                                                                                                                     |
| -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal | proven  | `apps/cli/src/main.test.ts` › "runs the named row and the last Run's text reaches the output exactly once" · `apps/cli/src/main.test.ts` › "writes one answer for a three-Step Workflow, not three" · `apps/cli/src/main.test.ts` › "runs the .eva workflow by its file name, over the --input file" | The surface. `eva run` is its own invocation, and `eva.tui` holds no command row that starts a Workflow.                                |
| Pipe     | none    | —                                                                                                                                                                                                                                                                                                    | The selection. `eva -p` hands `runPrint` a Prompt and names no harness, so the default harness answers every line.                      |
| Page     | none    | —                                                                                                                                                                                                                                                                                                    | The whole row. The composer submits a Prompt, and neither `apps/web` nor `packages/client-runtime` names a harness.                     |
| Wire     | none    | `plugins/api/src/wire.test.ts` › "reads back a $kind as it was written"                                                                                                                                                                                                                              | The Run. A `SubmitInput` carries a harness name and the wire reads it back, and no test opens a Run under a named harness at this door. |

A Workflow is a harness row. `eva.workflow` registers one per document under
the `workflows` key, which `.eva/workflows/*.yaml` fills through the kernel's
resource discovery, so a door that names a harness on a submit starts one. What
the Workflow does once it runs is held a layer down:
`packages/conformance/src/workflow-validator.test.ts` › "repairs exactly once,
and both Verdicts reach the record", and
`packages/conformance/src/workflow-prompt.test.ts` › "fills a Step's
Instruction from the row eva.prompt projected".

### 10. Read the resolved config, and where each key came from

| Door     | Verdict | Where it is proven                                                                                                                                                                                                                                                          | What is not covered                                                                             |
| -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Terminal | proven  | `apps/cli/src/main.test.ts` › "prints the model and the file each key came from" · `apps/cli/src/main.test.ts` › "names the command line, not the file, when a flag set the model" · `apps/cli/src/main.test.ts` › "answers even when the config names a plugin nobody has" | The surface. `eva config show` is its own verb, and `eva.tui` draws no config.                  |
| Pipe     | none    | —                                                                                                                                                                                                                                                                           | The resolved config. `eva -p` says what the config sweep found and prints no key and no origin. |
| Page     | none    | —                                                                                                                                                                                                                                                                           | The whole row. `apps/web` draws no config, and no route answers one.                            |
| Wire     | none    | —                                                                                                                                                                                                                                                                           | The whole row. `SessionAPI` has ten methods and not one of them reads config.                   |

Every door that boots a kernel does say what the sweep found: `door` in
`apps/cli/src/index.ts` reports each Finding before the door does its own work,
and `apps/cli/src/report.ts` owns the wording. The Findings are proven where
they are made — `plugins/config/src/index.test.ts` › "names a key that reached
nothing" — and what a person reads at the command line is
`apps/cli/src/main.test.ts` › "names a key nothing reads against the file that
set it".

### 11. Grant this directory trust, and drop the grant

| Door     | Verdict | Where it is proven                                                                                                                                                                                                                      | What is not covered                                                                                                                                                                |
| -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal | proven  | `apps/cli/src/main.test.ts` › "records the directory beside the person's own config" · `apps/cli/src/main.test.ts` › "drops the grant again" · `apps/cli/src/main.test.ts` › "says nothing was written when there was no grant to drop" | The surface. `eva trust` answers before any config is read, and `eva.tui` holds no command row for it.                                                                             |
| Pipe     | none    | —                                                                                                                                                                                                                                       | The grant. `eva -p` reads it and gives none.                                                                                                                                       |
| Page     | none    | —                                                                                                                                                                                                                                       | The whole row. The grant is a file beside the person's own config, and a browser writes none.                                                                                      |
| Wire     | none    | —                                                                                                                                                                                                                                       | The whole row, and the refusal for it. A grant taken over a socket widens what the serving process reads, so this is the cell where a declared refusal is worth more than a route. |

The read half is a layer down and is proven there:
`packages/kernel/src/resolution.test.ts` › "does not read a project directory
without a grant, and says which", and
`packages/kernel/src/resolution.test.ts` › "reads the project directory once
the grant is there". What a person is told at the command line while the grant
is missing is `apps/cli/src/main.test.ts` › "says which project file it did not
read, and how to allow it".

### 12. Check a rule set, and name the fault in a malformed one

| Door     | Verdict | Where it is proven                                                                                                                                                                                                                                                                                                                                       | What is not covered                                                                                                           |
| -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Terminal | proven  | `apps/cli/src/main.test.ts` › "exits nonzero on a malformed rule set, and names the fault" · `apps/cli/src/main.test.ts` › "names every fault, so a person fixes the file once" · `apps/cli/src/main.test.ts` › "counts the rules of a rule set it reads whole, and exits 0" · `apps/cli/src/main.test.ts` › "exits nonzero on a rule no call can reach" | The surface. `eva policy check` reads the rule set alone — no kernel, no Session — and `eva.tui` holds no command row for it. |
| Pipe     | none    | —                                                                                                                                                                                                                                                                                                                                                        | The check. `eva -p` runs the gate and reads no rule set before it.                                                            |
| Page     | none    | —                                                                                                                                                                                                                                                                                                                                                        | The whole row. `apps/web` reads no rule set, and no route answers one.                                                        |
| Wire     | none    | —                                                                                                                                                                                                                                                                                                                                                        | The whole row. A rule set is a file of the serving process, and nothing on the wire asks it what its rules are.               |

The gate the rule set feeds stands in front of the tools rather than in front
of a surface, so it runs at every door:
`packages/conformance/src/tool-policy.test.ts` › "refuses rm -rf /, and the
command never reaches the Sandbox". The command and the gate read one file
through one reader, so CI and a Run cannot disagree about what a malformed rule
set is.

## 4. Two commands, reachable rather than re-implemented

`/mode` and `/undo` are command rows, and they are not in the set above. A
remote door does not re-implement them: it sends the line to the process that
holds the Domains, through `POST /api/sessions/:id/command`. A door that ran
the line for itself would change its own approval state and leave the Run under
the mode it already had.

The page and the wire reach both:
`packages/conformance/src/two-surfaces.test.ts` › "changes the mode the
terminal's next write is judged by", and
`packages/conformance/src/two-surfaces.test.ts` › "reverses a write the
terminal's Run made". A command that would draw a panel lists its choices
instead, because this door draws none:
`plugins/api/src/routes.test.ts` › "lists what it would have asked, because
this door draws no panel".

Read the mode result the way the record writes it. `/mode read-only` takes the
row out of the tool domain, so the next call is refused by name and the record
reads `unknown_tool`, not `denied`. A mode is capability selection, and not a
filter at call time.

## 5. How this page is kept

No suite reads this page. A change to it holds five rules:

1. The matrix carries the twelve interactions, in the set's own words.
2. Every interaction has a section, and every section covers the four doors.
3. A section's verdict is the verdict the matrix shows.
4. A cell that reads `proven` or `refused` names at least one citation.
5. A cell that reads `none` says what is absent.

A citation names a file that exists and a test that file holds. Follow a proof
that is renamed or deleted to this page, because nothing else will.

`packages/conformance/src/w2-exit.test.ts` is the other ledger, and it answers
to the roadmap rather than to this page: it carries the clauses of the W2 exit
test and names the test that proves each one.
