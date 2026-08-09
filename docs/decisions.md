# Decisions — the consolidated view

Every decision this repository has made, grouped by the thing it decided, one paragraph each. The ledger itself is `docs/adr/`: append-only, never rewritten, never deleted, because a decision a later one overturned says so in its own status line and the history of being wrong is part of the record. Where this page and an ADR disagree, the ADR wins — this page is the map, not the territory.

The numbering skips 0022; nothing was removed, the number was never used.

## The Event schema

The one vocabulary. Every observable thing is an instance of one typed, versioned, sequence-numbered Event, and there is no second vocabulary anywhere in the system.

- **The envelope carries the fold keys** ([0001](adr/0001-event-envelope-carries-fold-keys.md)). Everything a projection needs to fold or filter — identity, position, time, kind, tenant, actor, Run, Session, Parent — rides on every record; the payload carries only display detail. Tenant and Actor are populated from commit one, because adding them later touches every stored record, query, and object path.
- **Unknown kinds are preserved, not dropped** ([0002](adr/0002-unknown-event-kinds-are-preserved-not-dropped.md)). An unrecognised kind arrives as `Unknown` with its bytes intact and the Run marked Degraded. Dropping would make a Trace structurally valid and quietly wrong, and a poisoned eval suite is a top-three risk.
- **Usage is normalized, and absence is not zero** ([0003](adr/0003-usage-is-normalized-with-absence-distinct-from-zero.md)). Cache writes and cache reads are separate figures because they are priced differently; a figure the provider did not report is nil, never zero; a dollar amount is never an estimate.
- **Payloads are a sealed interface** ([0005](adr/0005-event-payloads-are-a-sealed-interface.md)). The kind set is closed by the compiler, not by review. The rejected shape — one struct with a pointer per kind — lets "which pointer is set" and "what Kind says" disagree.
- **One schema version, additive within a major** ([0006](adr/0006-one-schema-version-additive-within-a-major.md)). One monotonic integer versions the whole schema; readers migrate old records on read; stored Traces are never rewritten, because the action log will be signed.
- **Tool results carry a Disposition, not a boolean** ([0007](adr/0007-tool-results-carry-a-disposition-not-a-boolean.md)). Denied, failed, skipped, cancelled, unknown tool, and budget denied each imply a different recovery, and an enum is free where inferring from prose is a guess.
- **Wire position and Trace position are two sequences** ([0008](adr/0008-wire-position-and-trace-position-are-two-sequences.md)). The producer assigns WireSeq per connection so a reconnecting peer can resume; the sink assigns Seq per Session at commit. They diverge by construction, because the sink coalesces and commits groups atomically.
- **Usage counters are nullable, so silence is not zero** ([0024](adr/0024-usage-counters-are-nullable-so-silence-is-not-zero.md)). What 0003 decided, the type now carries: every counter is a pointer, SchemaVersion moved to 2, and a turn that reported nothing reads "no usage reported" rather than "0 in / 0 out".

## Recording — one path to the Trace

- **One Recorder is the only path** ([0011](adr/0011-one-recorder-is-the-only-path-to-the-trace.md)). A Unit says what happened; the Recorder stamps, commits the group atomically, and publishes what was committed. The Session has no writer of its own — it folds committed Events, which is what stops the transcript and the Trace disagreeing.
- **Retries are payloads, so every attempt is a record** ([0012](adr/0012-retries-are-payloads-so-every-attempt-is-a-record.md)). SDK retries are turned off and Eva retries itself, yielding a Retry record before the wait it caused. A client that swallows its own retries reports a turn that cost one request when it cost four.
- **The Recorder closes the Run, so the caveat commits with the claim** ([0013](adr/0013-the-recorder-closes-the-run-so-the-caveat-commits-with-the-claim.md)). Finish composes the Degraded caveat and commits it with Finished as one group. The Recorder is the only thing that sees every record, so it is the one place the caveat cannot be forgotten.
- **A Recorder is told what it cannot see for itself** ([0014](adr/0014-a-recorder-is-told-what-it-cannot-see-for-itself.md)). A cost nobody reported and an answer cut off leave no mark on the committed stream, so whoever knew says so through Degrade, and the close still commits one caveat.
- **A broken projection stops itself** ([0025](adr/0025-a-broken-projection-stops-itself.md)). A Subscriber that fails is dropped from the fan-out; every other projection keeps receiving the Trace in full, and the Run carries the caveat that one went blind.

## The sink and the file

- **Text chunks coalesce at the sink** ([0004](adr/0004-text-chunks-coalesce-at-the-trace-sink.md)). A Trace record is a unit of meaning, not a token: consecutive chunks of one content block fold into one record at commit. Inter-token timing is deliberately lost; needing it back revisits this ADR rather than adding a parallel store.
- **A sink recovers the position the Trace reached** ([0027](adr/0027-a-sink-recovers-the-position-the-trace-reached.md)). Opening a file reads it back first, so a Session written by two processes cannot mint duplicate Seq values — the lie no reader could detect.

## Sessions and Runs

- **An interrupted Run closes** ([0016](adr/0016-an-interrupted-run-closes.md)). The commit and the close run beyond the cancellation's reach, and the Run closes failed with "interrupted" — because a Run with no Finished is one a reader cannot tell from a Run still going.
- **A Unit answers with an Outcome, and errors only when nothing recorded** ([0017](adr/0017-a-unit-answers-with-an-outcome-and-errors-only-when-nothing-recorded.md)). Every way the work can end is the Outcome; the error is reserved for the record itself failing, so no caller ever holds two accounts of one turn.
- **A Session opens its own Runs** ([0018](adr/0018-a-session-opens-its-own-runs.md)). Everything a Run's envelope carries, the Session already holds — a caller free to restate identity is free to restate it wrongly, and an Event stamped with the wrong Session is one no fold will find.
- **Clearing the transcript opens a new Session** ([0019](adr/0019-clearing-the-transcript-opens-a-new-session.md)). A Session that deleted its own messages would diverge from the Trace that still holds them; a fresh identifier diverges from nothing.
- **A Session folds under its own lock** ([0026](adr/0026-a-session-folds-under-its-own-lock.md)). Two Runs of one Session may fold from two goroutines, and a frontend's scheduling is not a place to keep a core invariant.
- **A prompt is answered by a Run, and a turn is one provider exchange** ([0037](adr/0037-a-prompt-is-answered-by-a-run-and-a-turn-is-one-provider-exchange.md)). The prompt-to-answer arc has no name of its own — it is the Run, whose opening record carries the intent and whose claim closes it. "Turn" is pinned to the providers' meaning: one exchange with a Provider, of which one Run holds many once there are tools.

## Structure, purity, packaging

- **core is pure, so IO lives beside it** ([0010](adr/0010-core-is-pure-so-io-lives-beside-it.md)). The domain reaches no filesystem, network, or terminal; every layer that does sits beside it, and depguard's strict allow lists fail closed. The packaging half was superseded by 0021; the layer graph and the purity rule stand.
- **One module, and internal is the default** ([0021](adr/0021-the-repository-is-one-module-and-internal-is-the-default.md)). Six unpublished modules cost replace blocks and a green build over broken code; one module with layers under `internal/` is the stronger boundary, and `./...` reaching everything is what makes a green check mean every package.
- **Selection is a registry** ([0028](adr/0028-selection-is-a-registry.md)). Providers, sinks, and projections put themselves into the set configuration selects from, so the layer that wires a run knows no implementation by name and the offer a person reads cannot go stale. Settings cross as small structs, never as the config file; a credential crosses as a function, so only a Provider that needs one can fail for want of it.

## Configuration and trust

- **Config and profiles are TOML, decoded strictly** ([0009](adr/0009-config-and-profiles-are-toml.md)). An unknown key is an error carrying migration guidance, never a silent ignore — fail-closed applied to the file a person hand-edits most.
- **A repository may choose how Eva looks, and not what it does** ([0029](adr/0029-a-repository-may-choose-how-eva-looks-and-not-what-it-does.md)). A cloned repo's `.eva/` is content from the internet read by a process holding a credential, so what it may set is an allow list and everything else is refused by name.
- **Look and feel are configuration, and the default is not a choice** ([0030](adr/0030-look-and-feel-are-configuration-and-the-default-is-not-a-choice.md)). Every colour, glyph, and binding is a value a person may set, and a person who sets nothing sees exactly what Eva looked like before any of it was configurable.

## The console

- **The live area shows the stream, and only the record is kept** ([0015](adr/0015-the-live-area-shows-the-stream-and-only-the-record-is-kept.md)). A person watches a turn arrive from the stream; when the Run closes, that is erased and replaced by the fold over what was committed, so nothing kept came from anywhere but the record. Where a kept turn goes was superseded by 0023.
- **The base system prompt is compiled in, and its size is a gate** ([0020](adr/0020-the-base-system-prompt-is-compiled-in-and-its-size-is-a-gate.md)). What every turn is conditioned on before the transcript is bytes in the binary, reviewed as prose in a diff, and held to a 2 KiB budget CI enforces.
- **The transcript is a pane the console owns** ([0023](adr/0023-the-transcript-is-a-pane-the-console-owns.md)). A block handed to the terminal's scrollback is one the program can never reach again — no re-wrap on resize, no real `/clear`. The pane keeps 0015's substance: arriving text is stored separately and dropped at close.

## Providers, credentials, wires

- **A Credential has a mode, and the mode alone decides** ([0031](adr/0031-a-credential-has-a-mode-and-the-mode-alone-decides.md)). `api_key` or `subscription`, chosen in the file, no precedence chain and no fallback — a stale exported key must never silently outrank a fresh login and bill the wrong org.
- **A Login is a CLI verb, and its credential lives in one auth store** ([0032](adr/0032-a-login-is-a-cli-verb-and-its-credential-lives-in-one-auth-store.md)). A login reaches the network and waits on a person, which is everything a console Command must not do. The store is a file because a subscription credential expires and the renewed one must be written back.
- **The OpenAI Provider speaks the Responses API with no SDK** ([0033](adr/0033-the-openai-provider-speaks-the-responses-api-with-no-sdk.md)). One POST and one SSE body, two transports identical past the dial — and the subscription backend needs hosts and headers no SDK ships with.
- **One Driver pulls a turn, and a Provider is a Wire** ([0034](adr/0034-one-driver-pulls-a-turn-and-a-provider-is-a-wire.md)). The state machine every turn runs through — the queue, the retry-as-record, the books that close once — is written once; a Provider supplies only Dial, Pump, and Close. Two implementations of the same two hundred lines is what made the seam real.
- **The Provider contract is one method, and a suite is what enforces it** ([0035](adr/0035-the-provider-contract-is-one-method-and-a-suite-is-what-enforces-it.md)). No Name method — every caller already holds the name from configuration — and no error return, because a turn that could not start fails from the first Next, where every other failure already arrives. The rules the types cannot express, `providertest` enforces.
- **A replaying Provider is not a Provider a person may select** ([0036](adr/0036-a-replaying-provider-is-not-a-provider-a-person-may-select.md)). The fake is gone; tests drive the production Providers against a loopback server speaking the real wire protocol, because a second implementation of the contract is one that can disagree with the first and be believed.

## What supersedes what

Nothing is rewritten; a superseded clause is marked in the older ADR's own status line.

| Older decision | Superseded clause | By |
| --- | --- | --- |
| 0010 | the six-module packaging | 0021 |
| 0015 | where a kept turn goes on screen | 0023 |
| 0019 | "/clear does not clear the screen" | 0023 |
| Product.md | config format left open | 0009 |
| Product.md | the layer tree in the final-repo-shape section | 0010 |
| Product.md | six modules | 0021 |
| Product.md stage 0 | the `eva -p --json` exit-test clause | stated in Product.md itself |

## Open decisions

Named here so they are decided on purpose rather than by the first commit that needs them. Each is due before the stage that would harden a wrong shape. The full argument for all three is the review that raised them: [reviews/2026-08-09-architecture-review.md](reviews/2026-08-09-architecture-review.md).

- **The transcript schema.** `core.Message` is author-and-text, and the stage that adds tools needs typed content blocks — a tool call and its result must fold back into the transcript in the shape a provider can resend, or "no tool_use without its tool_result" cannot be a property of the writer. This is the second schema-grade decision the project has, with the same blast radius as the Event schema, and it deserves the same design session. Due before stage 2.
- **Where the loop lives.** `cli.Turn` is the embryo of the loop layer, and the frontend is not where a loop grows tool dispatch, parallel groups, and approval gates. The extraction is one construction site today. Its new name belongs to the loop (ADR 0037). Due before stage 2.
- **The Unit's shape.** The plan gives Execute a Runtime carrying tools, memory, verifier, and hooks; the code gives dependencies as fields on the implementing type. Both are defensible and only one can be the pattern — the null-implementation rule and the hook attachment point hang off whichever wins. Due before Units multiply.
