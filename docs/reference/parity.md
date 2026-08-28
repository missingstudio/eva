# Parity

Eva has four doors, and one contract behind all of them. This page says what
each door can do, and names the test that proves it. A cell that names neither
a proof nor a refusal is a defect, and it is written here as one.

The matrix holds thirty-two cells: twenty-four are proven, one is a refusal
that names itself, and seven are neither. The seven are the work this page
exists to find, and section 3 says what is absent in each.

`packages/conformance/src/parity.test.ts` reads this page on every build. Every
citation on it has to resolve, so a proof that is renamed or deleted fails the
build instead of a user.

## 1. The four doors

| Door         | How it is started | What it is                                |
| ------------ | ----------------- | ----------------------------------------- |
| **Terminal** | `eva`             | `eva.tui`, drawing through `packages/tui` |
| **Pipe**     | `eva -p`          | `eva.print` — one answer, then exit       |
| **Page**     | `eva --web`       | `apps/web` over `eva.web`                 |
| **Wire**     | `eva serve --web` | `eva.api`, which any program can curl     |

One contract stands behind the four: the nine methods of `SessionAPI`
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
| 1. Open a Session, and see the Sessions that exist                                                         | none     | none    | proven | proven |
| 2. Prompt, and watch the Run live                                                                          | proven   | proven  | proven | proven |
| 3. Queue a line behind an open Run; steer into one deliberately                                            | proven   | none    | proven | none   |
| 4. Cancel                                                                                                  | proven   | proven  | proven | proven |
| 5. Answer a permission request with any of the four options — and lose the race to another door gracefully | proven   | refused | proven | proven |
| 6. Switch the model, choosing from what the Catalog knows                                                  | proven   | none    | proven | proven |
| 7. See what the Session spent                                                                              | proven   | proven  | proven | none   |
| 8. Survive a dropped pipe: say so, catch up by Cursor, never duplicate                                     | proven   | none    | proven | proven |

## 3. Where each cell is proven

A citation reads `` `file` › "test" `` for a test, and `` `file` › `token` ``
for a refusal the source declares. Several citations in one cell are separated
by `·`.

### 1. Open a Session, and see the Sessions that exist

| Door     | Verdict | Where it is proven                                                                                                                                                                                          | What is not covered                                                                                                                                          |
| -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Terminal | none    | `plugins/tui/src/surface.test.ts` › "shows the Session a command selected" · `plugins/commands/src/index.test.ts` › "names the four the product ships"                                                      | The listing. The terminal opens a Session at start-up and follows the one `/clear` opens. It never calls `list`, and it declares no refusal for the listing. |
| Pipe     | none    | `apps/cli/src/conversation.test.ts` › "keeps every Run in one session's fold, in order"                                                                                                                     | The listing. `eva -p` opens one Session per invocation and lists none. `PrintOptions.session` takes an existing Session, and no flag fills it.               |
| Page     | proven  | `apps/web/src/session.test.tsx` › "offers a new Session on the listing" · `apps/web/src/page.test.tsx` › "names every Session Eva holds, with its Header"                                                   | —                                                                                                                                                            |
| Wire     | proven  | `plugins/api/src/routes.test.ts` › "opens a Session, and the listing then holds it" · `plugins/api/src/client/transport.test.ts` › "opens a Session, and the listing after it holds the one it handed back" | —                                                                                                                                                            |

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
| Page     | proven  | `apps/web/src/composer.test.tsx` › "opens a Run on a line typed with nothing open" · `apps/web/src/session.test.tsx` › "draws what the open Run has streamed, and nothing around it"                          | —                   |
| Wire     | proven  | `plugins/api/src/routes.test.ts` › "opens a Run from a Prompt, and answers nothing back" · `packages/conformance/src/session-api-contract.test.ts` › "streams the Run live to a watch that carries no cursor" | —                   |

### 3. Queue a line behind an open Run; steer into one deliberately

| Door     | Verdict | Where it is proven                                                                                                                                                                                                                                                            | What is not covered                                                                                                                                                                  |
| -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Terminal | proven  | `plugins/tui/src/surface.test.ts` › "runs a line typed during a Run after the Run closes" · `plugins/tui/src/line.test.ts` › "steers the trimmed line on ctrl+s" · `packages/conformance/src/tui.test.ts` › "$binding is acted on, never swallowed"                           | —                                                                                                                                                                                    |
| Pipe     | none    | —                                                                                                                                                                                                                                                                             | Both halves. `eva -p` submits one Prompt from argv and exits, so it queues nothing and steers nothing. It declares no refusal for either; `interactive: false` answers an ask alone. |
| Page     | proven  | `apps/web/src/composer.test.tsx` › "queues a line typed during a Run, and sends nothing" · `apps/web/src/composer.test.tsx` › "steers the open Run rather than queueing behind it" · `apps/web/src/session.test.tsx` › "says how many lines wait behind the Run that is open" | —                                                                                                                                                                                    |
| Wire     | none    | `plugins/api/src/routes.test.ts` › "carries a steer with the target it named"                                                                                                                                                                                                 | The queue. `SessionAPI.submit` opens a Run and holds no queue — the composer fold does — and no test says what a second `submit` during an open Run does.                            |

One fold holds the queue for both composers, so the two cannot disagree:
`packages/client-runtime/src/loop.test.ts` › "waits its turn while a Run is
open, rather than racing it", and `packages/client-runtime/src/loop.test.ts` ›
"steers the open Run rather than waiting behind it".

### 4. Cancel

| Door     | Verdict | Where it is proven                                                                                                                                                                                | What is not covered                                                                               |
| -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Terminal | proven  | `plugins/tui/src/surface.test.ts` › "cancels the Run it was pressed against" · `packages/conformance/src/tui.test.ts` › "cancels, quits, submits, and breaks the line"                            | —                                                                                                 |
| Pipe     | proven  | `apps/cli/src/conversation.test.ts` › "keeps the partial work and closes the Run cancelled, leaving a foldable trace"                                                                             | The signal that raises the interrupt. `withSignals` in `apps/cli/src/run.ts` is named by no test. |
| Page     | proven  | `apps/web/src/composer.test.tsx` › "offers a stop only while a Run is open" · `apps/web/src/composer.test.tsx` › "drops the queue on a cancel, and tells Eva"                                     | —                                                                                                 |
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

| Door     | Verdict | Where it is proven                                                                                                                                                                                                                                                                                                | What is not covered                                                                                                                                                                                          |
| -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Terminal | proven  | `plugins/commands/src/index.test.ts` › "offers every model, and sets the one that is taken" · `plugins/commands/src/index.test.ts` › "says what the Catalog holds, and nothing it does not" · `plugins/tui/src/surface.test.ts` › "hands the row back on enter, and closes"                                       | The terminal's own suite proves the picker with a stand-in command row, not with `/model`. The `/model` rows and the set are proven where they live, in `eva.commands`.                                      |
| Pipe     | none    | —                                                                                                                                                                                                                                                                                                                 | `--model` is a root flag and it reaches the print invocation as an overlay, and no test pairs it with `--print`: `apps/cli/src/argv.test.ts` › "reads a prompt behind --print" asserts an empty overlay set. |
| Page     | proven  | `apps/web/src/models.test.tsx` › "offers the rows the terminal's panel picks from, and no others" · `apps/web/src/models.test.tsx` › "stands on the Session page"                                                                                                                                                 | —                                                                                                                                                                                                            |
| Wire     | proven  | `plugins/api/src/routes.test.ts` › "answers every model the Catalog knows, as the rows the panel picks from" · `plugins/api/src/routes.test.ts` › "sets the model, and the read half hands the new one back" · `plugins/api/src/client/transport.test.ts` › "reads every model the Catalog behind the wire knows" | —                                                                                                                                                                                                            |

### 7. See what the Session spent

| Door     | Verdict | Where it is proven                                                                                                                                                                              | What is not covered                                                                                                                                                                                                                                                                                                          |
| -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal | proven  | `plugins/tui/src/console.test.ts` › "spells the tokens and the cost the way the contract does" · `plugins/tui/src/console.test.ts` › "says nothing about cost when the Session has not run"     | —                                                                                                                                                                                                                                                                                                                            |
| Pipe     | proven  | `apps/cli/src/conversation.test.ts` › "reports the whole session's spend, and says so when cost is unreported" · `plugins/print/src/cost-line.test.ts` › "reads as the shape the product shows" | —                                                                                                                                                                                                                                                                                                                            |
| Page     | proven  | `apps/web/src/session.test.tsx` › "shows what a Provider reported" · `apps/web/src/session.test.tsx` › "says the cost is unreported rather than showing a figure nobody gave"                   | —                                                                                                                                                                                                                                                                                                                            |
| Wire     | none    | —                                                                                                                                                                                               | No route answers cost, and the estimate does not cross: `plugins/api/src/client/transport.test.ts` › "folds a Session from the record, and ends where the record ends" holds the estimate to null, because that side holds no Catalog. What a Provider reported rides the record, and no test reads it back over the socket. |

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

## 5. How this page is checked

`packages/conformance/src/parity.test.ts` reads this file and holds it to five
rules:

1. The matrix carries the eight interactions, in the set's own words.
2. Every interaction has a section, and every section covers the four doors.
3. A section's verdict is the verdict the matrix shows.
4. A cell that reads `proven` or `refused` names at least one citation.
5. A cell that reads `none` says what is absent.

Then it resolves every citation on the page: the file has to exist, and it has
to hold the test name or the token the citation gives. A proof that is renamed
or deleted fails that suite, and `verify` runs it.

It is a sibling of `packages/conformance/src/w2-exit.test.ts` rather than a
part of it. The two ledgers answer to different authorities: the exit test is
held to the roadmap's own sentences, and this page is held to the interaction
set and to itself. The exit test names this suite in the clause the stage plan
added, so the matrix cannot be dropped without the exit test failing.
