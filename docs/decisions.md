# Decisions — the consolidated view

Every decision this repository has made, grouped by the thing it decided, one
paragraph each.

The ledger itself is [`adr/`](adr/): append-only, never rewritten, never deleted. A
decision a later one overturned says so in its own status line, because the history of
being wrong is part of the record. Where this page and an ADR disagree, the ADR wins.
This page is the map, not the territory.

The numbering skips 0022. Nothing was removed; the number was never used.

## The Event schema

The one vocabulary. Every observable thing is an instance of one typed, versioned,
sequence-numbered Event. There is no second vocabulary anywhere in the system.

- **The envelope carries the fold keys** ([0001](adr/0001-event-envelope-carries-fold-keys.md)).
  Everything a projection needs to fold or filter rides on every record: identity,
  position, time, kind, tenant, actor, Run, Session, and Parent. The payload carries
  only display detail. Tenant and Actor are populated from commit one, because adding
  them later touches every stored record, query, and object path.
- **Unknown kinds are preserved, not dropped** ([0002](adr/0002-unknown-event-kinds-are-preserved-not-dropped.md)).
  An unrecognised kind arrives as `Unknown` with its bytes intact, and the Run is
  marked Degraded. Dropping would make a Trace structurally valid and quietly wrong,
  and a poisoned eval suite is a top-three risk.
- **Usage is normalized, and absence is not zero** ([0003](adr/0003-usage-is-normalized-with-absence-distinct-from-zero.md)).
  Cache writes and cache reads are separate figures, because they are priced
  differently. A figure the provider did not report is nil, never zero. A dollar
  amount is never an estimate.
- **Payloads are a sealed interface** ([0005](adr/0005-event-payloads-are-a-sealed-interface.md)).
  The kind set is closed by the compiler, not by review. The rejected shape was one
  struct with a pointer per kind. It lets "which pointer is set" and "what Kind says"
  disagree.
- **One schema version, additive within a major** ([0006](adr/0006-one-schema-version-additive-within-a-major.md)).
  One monotonic integer versions the whole schema. Readers migrate old records on
  read. Stored Traces are never rewritten, because the action log will be signed.
- **Tool results carry a Disposition, not a boolean** ([0007](adr/0007-tool-results-carry-a-disposition-not-a-boolean.md)).
  Denied, failed, skipped, cancelled, unknown tool, and budget denied each imply a
  different recovery. An enum is free, where inferring from prose is a guess.
- **Wire position and Trace position are two sequences** ([0008](adr/0008-wire-position-and-trace-position-are-two-sequences.md)).
  The producer assigns WireSeq per connection, so a reconnecting peer can resume. The
  sink assigns Seq per Session at commit. They diverge by construction, because the
  sink coalesces and commits groups atomically.
- **Usage counters are nullable, so silence is not zero** ([0024](adr/0024-usage-counters-are-nullable-so-silence-is-not-zero.md)).
  The type now carries what 0003 decided. Every counter is a pointer, and
  SchemaVersion moved to 2. A turn that reported nothing reads "no usage reported"
  rather than "0 in / 0 out".

## Recording — one path to the Trace

- **One Recorder is the only path** ([0011](adr/0011-one-recorder-is-the-only-path-to-the-trace.md)).
  A Unit says what happened. The Recorder stamps, commits the group atomically, and
  publishes what was committed. The Session has no writer of its own; it folds
  committed Events, which is what stops the transcript and the Trace disagreeing.
- **Retries are payloads, so every attempt is a record** ([0012](adr/0012-retries-are-payloads-so-every-attempt-is-a-record.md)).
  SDK retries are turned off and Eva retries itself, yielding a Retry record before
  the wait it caused. A client that swallows its own retries reports a turn that cost
  one request when it cost four.
- **The Recorder closes the Run, so the caveat commits with the claim** ([0013](adr/0013-the-recorder-closes-the-run-so-the-caveat-commits-with-the-claim.md)).
  Finish composes the Degraded caveat and commits it with Finished as one group. The
  Recorder is the only thing that sees every record, so it is the one place the caveat
  cannot be forgotten.
- **A Recorder is told what it cannot see for itself** ([0014](adr/0014-a-recorder-is-told-what-it-cannot-see-for-itself.md)).
  A cost nobody reported, and an answer cut off, leave no mark on the committed
  stream. So whoever knew says so through Degrade, and the close still commits one
  caveat.
- **A broken projection stops itself** ([0025](adr/0025-a-broken-projection-stops-itself.md)).
  A Subscriber that fails is dropped from the fan-out. Every other projection keeps
  receiving the Trace in full, and the Run carries the caveat that one went blind.

## The sink and the file

- **Text chunks coalesce at the sink** ([0004](adr/0004-text-chunks-coalesce-at-the-trace-sink.md)).
  A Trace record is a unit of meaning, not a token. Consecutive chunks of one content
  block fold into one record at commit. Inter-token timing is deliberately lost.
  Needing it back revisits this ADR, rather than adding a parallel store.
- **A sink recovers the position the Trace reached** ([0027](adr/0027-a-sink-recovers-the-position-the-trace-reached.md)).
  Opening a file reads it back first. So a Session written by two processes cannot
  mint duplicate Seq values, which is the lie no reader could detect.

## Sessions and Runs

- **An interrupted Run closes** ([0016](adr/0016-an-interrupted-run-closes.md)).
  The commit and the close run beyond the cancellation's reach, and the Run closes
  failed with "interrupted". A Run with no Finished is one a reader cannot tell from a
  Run still going.
- **A Unit answers with an Outcome, and errors only when nothing recorded** ([0017](adr/0017-a-unit-answers-with-an-outcome-and-errors-only-when-nothing-recorded.md)).
  Every way the work can end is the Outcome. The error is reserved for the record
  itself failing, so no caller ever holds two accounts of one turn.
- **A Session opens its own Runs** ([0018](adr/0018-a-session-opens-its-own-runs.md)).
  Everything a Run's envelope carries, the Session already holds. A caller free to
  restate identity is free to restate it wrongly, and an Event stamped with the wrong
  Session is one no fold will find.
- **Clearing the transcript opens a new Session** ([0019](adr/0019-clearing-the-transcript-opens-a-new-session.md)).
  A Session that deleted its own messages would diverge from the Trace that still
  holds them. A fresh identifier diverges from nothing.
- **A Session folds under its own lock** ([0026](adr/0026-a-session-folds-under-its-own-lock.md)).
  Two Runs of one Session may fold from two goroutines. A frontend's scheduling is not
  a place to keep a core invariant.
- **A prompt is answered by a Run, and a turn is one provider exchange** ([0037](adr/0037-a-prompt-is-answered-by-a-run-and-a-turn-is-one-provider-exchange.md)).
  The prompt-to-answer arc has no name of its own. It is the Run, whose opening record
  carries the intent and whose claim closes it. "Turn" is pinned to the providers'
  meaning: one exchange with a Provider, of which one Run holds many once there are
  tools. Its consequence has landed. The type named for the arc moved out of the
  frontend into `internal/loop` and is `loop.Loop`, whose contract is a depguard rule
  and a package comment, as every other layer's is.
- **A transcript entry is blocks, so a tool exchange can be rebuilt** ([0039](adr/0039-a-transcript-entry-is-blocks-so-a-tool-exchange-can-be-rebuilt.md)).
  A Message holds words, a tool call, and the result that answers it, behind a sealed
  set. The Event schema already recorded tool calls and could not give them back: a
  call had no identifier, and a result named neither the call it answered nor what the
  model was shown. So the fold could rebuild that something happened, and not the
  conversation. Both fields are additive, so the schema version does not move.
- **A Unit holds its capabilities, and Execute takes only a Spec** ([0040](adr/0040-a-unit-holds-its-capabilities-and-execute-takes-only-a-spec.md)).
  The plan sketched a Runtime parameter. The composition rule decides against it,
  because a Unit is a tool to a parent Unit, and a tool is called with arguments.
  Capabilities are fields set where a Unit is built, which is also where a parent
  narrows what a child it spawns may reach.

## Structure, purity, packaging

- **core is pure, so IO lives beside it** ([0010](adr/0010-core-is-pure-so-io-lives-beside-it.md)).
  The domain reaches no filesystem, network, or terminal. Every layer that does sits
  beside it, and depguard's strict allow lists fail closed. The packaging half was
  superseded by 0021. The layer graph and the purity rule stand.
- **One module, and internal is the default** ([0021](adr/0021-the-repository-is-one-module-and-internal-is-the-default.md)).
  Six unpublished modules cost replace blocks, and a green build over broken code. One
  module with layers under `internal/` is the stronger boundary, and `./...` reaching
  everything is what makes a green check mean every package.
- **Selection is a registry** ([0028](adr/0028-selection-is-a-registry.md)).
  Providers, sinks, and projections put themselves into the set configuration selects
  from. So the layer that wires a run knows no implementation by name, and the offer a
  person reads cannot go stale. Settings cross as small structs, never as the config
  file. A credential crosses as a function, so only a Provider that needs one can fail
  for want of it.

## Configuration and trust

- **Config and profiles are TOML, decoded strictly** ([0009](adr/0009-config-and-profiles-are-toml.md)).
  An unknown key is an error carrying migration guidance, never a silent ignore. This
  is fail-closed applied to the file a person hand-edits most.
- **A repository may choose how Eva looks, and not what it does** ([0029](adr/0029-a-repository-may-choose-how-eva-looks-and-not-what-it-does.md)).
  A cloned repo's `.eva/` is content from the internet, read by a process holding a
  credential. So what it may set is an allow list, and everything else is refused by
  name.
- **Look and feel are configuration, and the default is not a choice** ([0030](adr/0030-look-and-feel-are-configuration-and-the-default-is-not-a-choice.md)).
  Every colour, glyph, and binding is a value a person may set. A person who sets
  nothing sees exactly what Eva looked like before any of it was configurable.

## The console

- **The live area shows the stream, and only the record is kept** ([0015](adr/0015-the-live-area-shows-the-stream-and-only-the-record-is-kept.md)).
  A person watches a turn arrive from the stream. When the Run closes, that is erased
  and replaced by the fold over what was committed. So nothing kept came from anywhere
  but the record. Where a kept turn goes was superseded by 0023.
- **The base system prompt is compiled in, and its size is a gate** ([0020](adr/0020-the-base-system-prompt-is-compiled-in-and-its-size-is-a-gate.md)).
  What every turn is conditioned on before the transcript is bytes in the binary,
  reviewed as prose in a diff, and held to a 2 KiB budget CI enforces.
- **The transcript is a pane the console owns** ([0023](adr/0023-the-transcript-is-a-pane-the-console-owns.md)).
  A block handed to the terminal's scrollback is one the program can never reach
  again: no re-wrap on resize, and no real `/clear`. The pane keeps 0015's substance —
  arriving text is stored separately and dropped at close.
- **A failed claim carries a class, and a projection spends the class rather than the prose** ([0038](adr/0038-a-failed-claim-carries-a-class-and-a-projection-spends-the-class.md)).
  What went wrong is a value from a fixed set, and how it went wrong is prose. Only
  the second is unsafe to show, so `Claim` carries an `ErrorClass` and a person reads
  Eva's own sentence for it. The class is stated by the Provider and never parsed back
  out of a message. The empty class means nobody classified, rather than "other". A
  failed turn also named the Trace, so that keeping the vendor's words off the screen
  did not read as having destroyed them; 0041 withdrew that line.
- **A remedy is checked, and the layer that can check it is not the layer that says it** ([0041](adr/0041-a-remedy-is-checked-and-the-layer-that-can-check-it-is-not-the-layer-that-says-it.md)).
  0038 stopped at what happened, because `render` cannot tell a rejected key from an
  expired login. The layer that wires a run can. So it establishes the fact and hands
  back a `Remedy` the way it already hands back `About`. A step is shown only with a
  fact behind it, only when the fact leaves exactly one step correct, and never for the
  four classes with no local cause. A guess in Eva's own voice costs every later nudge
  that would have been right.

## Providers, credentials, wires

- **A Credential has a mode, and the mode alone decides** ([0031](adr/0031-a-credential-has-a-mode-and-the-mode-alone-decides.md)).
  `api_key` or `subscription`, chosen in the file, with no precedence chain and no
  fallback. A stale exported key must never silently outrank a fresh login and bill
  the wrong org.
- **A Login is a CLI verb, and its credential lives in one auth store** ([0032](adr/0032-a-login-is-a-cli-verb-and-its-credential-lives-in-one-auth-store.md)).
  A login reaches the network and waits on a person, which is everything a console
  Command must not do. The store is a file, because a subscription credential expires
  and the renewed one must be written back.
- **The OpenAI Provider speaks the Responses API with no SDK** ([0033](adr/0033-the-openai-provider-speaks-the-responses-api-with-no-sdk.md)).
  One POST and one SSE body, with two transports identical past the dial. The
  subscription backend needs hosts and headers no SDK ships with.
- **One Driver pulls a turn, and a Provider is a Wire** ([0034](adr/0034-one-driver-pulls-a-turn-and-a-provider-is-a-wire.md)).
  The state machine every turn runs through is written once: the queue, the
  retry-as-record, and the books that close once. A Provider supplies only Dial, Pump,
  and Close. Two implementations of the same two hundred lines is what made the seam
  real.
- **The Provider contract is one method, and a suite is what enforces it** ([0035](adr/0035-the-provider-contract-is-one-method-and-a-suite-is-what-enforces-it.md)).
  There is no Name method, because every caller already holds the name from
  configuration. There is no error return, because a turn that could not start fails
  from the first Next, where every other failure already arrives. The rules the types
  cannot express, `providertest` enforces.
- **A replaying Provider is not a Provider a person may select** ([0036](adr/0036-a-replaying-provider-is-not-a-provider-a-person-may-select.md)).
  The fake is gone. Tests drive the production Providers against a loopback server
  speaking the real wire protocol, because a second implementation of the contract is
  one that can disagree with the first and be believed.

## What supersedes what

Nothing is rewritten. A superseded clause is marked in the older ADR's own status line.

| Older decision                               | Superseded clause                              | By                            |
| -------------------------------------------- | ---------------------------------------------- | ----------------------------- |
| 0010                                         | the six-module packaging                       | 0021                          |
| 0012                                         | a transport failure is classified `other`      | 0038                          |
| 0015                                         | where a kept turn goes on screen               | 0023                          |
| 0038                                         | a failed turn names the Trace                  | 0041                          |
| 0019                                         | "/clear does not clear the screen"             | 0023                          |
| product.md (now `roadmap.md`)                | config format left open                        | 0009                          |
| product.md (now `reference/architecture.md`) | the layer tree in the final-repo-shape section | 0010                          |
| product.md (now `roadmap.md`, stage 0)       | six modules                                    | 0021                          |
| product.md stage 0 (now `roadmap.md`)        | the `eva -p --json` exit-test clause           | stated in `roadmap.md` itself |

## Open decisions

Every decision the 2026-08-09 review left open has been taken, and each is recorded
above: the transcript schema in 0039, the Unit's shape in 0040, and where the loop
lives in 0037's consequence. The review that raised them is
[reviews/2026-08-09-architecture-review.md](reviews/2026-08-09-architecture-review.md).

What is left is known cost rather than undecided shape, named here so it is met on
purpose:

- **Rebuilding a Session is linear in its records**, and every turn copies the whole
  transcript. That is nothing at the length a person types, and something at the
  length an unattended Run reaches. The fix is a checkpoint the fold resumes from,
  keyed by the Cursor that already names a durably reached position. It is never a
  cache beside the fold, which is the second source of truth the fold exists to
  prevent. The trigger is resume over a Trace long enough to measure.
- **Neither wire sends a tool block.** The transcript can hold a tool exchange and the
  fold gives one back. What turns that into a request lands with the tool registry
  that produces the blocks, tested against the API shapes it maps onto. A block a wire
  cannot send fails the turn and names the block, rather than being left out (0039).
