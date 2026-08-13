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
  frontend and is `eva.Loop`, inside the Harness that owns it, whose contract is a
  depguard rule and a package comment, as every other layer's is.
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
- **An install checks the signature, and says what it could not check** ([0044](adr/0044-an-install-checks-the-signature-and-says-what-it-could-not-check.md)).
  The checksum is fetched from the same host as the archive, so it establishes the
  download and not the release. The signature over `checksums.txt` is what
  establishes the release, and it is checked first, because the checksum is spent
  against a file whose origin is then known. A signature that does not hold installs
  nothing. One that cannot be checked — no cosign, an unsigned build — installs on
  the checksum and says what that leaves unproven, because an installer that refused
  on a bare machine is one nobody runs. `--require-signature` removes the
  degradation.

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
- **The console owns the pane it scrolls** ([0043](adr/0043-the-console-owns-the-pane-it-scrolls.md)).
  0023's pane was the terminal library's, and it takes a piece of text — so every frame
  handed it the whole conversation and it measured the display width of every line of
  it again. Handing it lines it did not have to split saved 2%: the splitting was never
  the cost. Eva's own pane takes rows, keeps no figure derived from all of them, and
  measures nothing it is not drawing. A frame now costs what the window shows.
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

## The service seam

Eva is a service, and every interface is a client of it. The argument is in
[explanation/the-service-seam.md](explanation/the-service-seam.md). These are the
decisions it fixes. None of them changes a stage number or an exit test.

- **The Harness is a layer, and Eva is one entry in its registry** ([0045](adr/0045-the-harness-is-a-layer-and-eva-is-one-entry-in-its-registry.md)).
  The assembly that wires a Run left the frontend, because a server and a daemon each
  need it and each would have rebuilt it. Selection is a registry with one entry today,
  so a second Harness is a package plus one configuration line.
- **The wire is the public surface, and `internal` stays internal** ([0046](adr/0046-the-wire-is-the-public-surface-and-internal-stays-internal.md)).
  A version number already exists where the promise belongs: a reader migrates an old
  record, and nothing migrates a Go type. There is no `pkg/`.
- **One API, and two Transports carry it** ([0047](adr/0047-one-api-and-two-transports-carry-it.md)).
  The Direct Transport is a call in one process and the Remote Transport is the wire.
  Identical semantics, one conformance suite. This is what lets one turn on a command
  line open no socket while the browser reaches the same service.
- **The Session API crosses the wire, and Local facts do not** ([0048](adr/0048-the-session-api-crosses-the-wire-and-local-facts-do-not.md)).
  Three of the console's eight methods describe a machine rather than a Session, and
  each would have lied over a wire. Five and three, which also repairs the four-method
  rule this repository already held.
- **A Frontend resumes by Trace position, and only a durable Event moves a Cursor** ([0049](adr/0049-a-frontend-resumes-by-trace-position-and-only-a-durable-event-moves-a-cursor.md)).
  One stream carries what arrived and what was committed, and the durable position is
  the mark that tells them apart. A Worker replays a connection and resumes by WireSeq;
  a Frontend folds a Session and resumes by Seq. This is where 0008's split first pays.
- **The Go schema is canonical, and the wire schema is generated from it** ([0050](adr/0050-the-go-schema-is-canonical-and-the-wire-schema-is-generated-from-it.md)).
  Generated Go cannot carry an unexported method, so a schema compiler owning the types
  would delete 0005's seal. Generation runs outward from the payload registry. Two
  version numbers: one for records, one for the wire surface.
- **A pairing token is printed, and the Credential it buys is not** ([0051](adr/0051-a-pairing-token-is-printed-and-the-credential-it-buys-is-not.md)).
  A pairing act has to put something on a screen, so the question is what. A single-use
  grant that expires in minutes is safe to show; a bearer credential for an agent that
  runs commands is not. The rejected design is a static password defaulting to absent.
- **A Login verb lives under the noun that owns it** ([0052](adr/0052-a-login-verb-lives-under-the-noun-that-owns-it.md)).
  `eva provider login` and `eva console login`. Two subjects arrived — a machine
  reaching a model, and a person reaching the managed Console — and one verb cannot
  guess. The old verbs fail with their replacements rather than aliasing.
- **The web interface ships in the binary, and it needs no Console** ([0053](adr/0053-the-web-interface-ships-in-the-binary-and-needs-no-console.md)).
  One checksummed artifact is the whole install story. Three constraints bind, and the
  third is an exit test: a full turn through the interface against a local server with
  no route to the Console.
- **A repository is trusted per directory, and by the person** ([0054](adr/0054-a-repository-is-trusted-per-directory-and-by-the-person.md)).
  A Server outlives any one directory, so one process reads configuration from
  repositories nobody vetted. The grant lands while the only thing behind it is
  appearance, because a grant introduced later is a dialog people learn to dismiss.
- **An answer is a record, and a rejection is one of its Resolutions** ([0055](adr/0055-an-answer-is-a-record-and-a-rejection-is-one-of-its-resolutions.md)).
  The schema held the Question and nothing held the reply, so a Session that escalated
  could not be rebuilt. One additive Kind closes it, naming the Question by the Event
  identity that already exists. A person declining to answer is data, so neither Outcome
  nor Error Class widens. SchemaVersion stays 2.
- **A Question belongs to a Session, and the Inbox is a fold over a Location** ([0056](adr/0056-a-question-belongs-to-a-session-and-the-inbox-is-a-fold-over-a-location.md)).
  The Attention view cannot be built from per-Session lists, so the Inbox needs a
  boundary. Tenant is too wide and Run is too narrow. A Location is where a person is, so
  it travels on the request as well as on the Session.
- **The service version travels on the wire, and a busy Service is not replaced** ([0057](adr/0057-the-service-version-travels-on-the-wire-and-a-busy-service-is-not-replaced.md)).
  Additive within a major, checked on the service version rather than the build. It rides
  in the health response, because a client that arrived over a network has no local file
  to read. An idle Service is replaced silently; a busy one is reported. A development
  build never reuses one.
- **One web interface serves every screen** ([0058](adr/0058-one-web-interface-serves-every-screen.md)).
  The desktop application is a shell around it and a phone reaches it over a Pairing
  token, so there is one interface toolchain beside Go. What it cannot do — notifications,
  no network, an application store — is the falsifier, named rather than discovered.
- **The Console surface is a second interface document** ([0059](adr/0059-the-console-surface-is-a-second-interface-document.md)).
  Organizations, seats, and billing get their own document, version, and authentication. A
  namespace would put unanswerable methods in the surface; a reduced local implementation
  would fabricate an organization.
- **The Service registers itself, and a client never stops a stranger** ([0060](adr/0060-the-service-registers-itself-and-a-client-never-stops-a-stranger.md)).
  One server, and `--register` is what makes a run of it the Service. The port is
  ephemeral and the Registration carries the address. A client re-reads the Registration
  before and after it signals, because a process identifier is reused and a stale one
  stops whatever inherited it.
- **The assembly is the session API in this process** ([0061](adr/0061-the-assembly-is-the-session-api-in-this-process.md)).
  Five operations had three implementations, and one of them forwarded. The assembly
  answers the API itself and the Server's half serves the interface, so `api` names no
  implementation and a test can put a Session with nothing behind it under a Server. An
  arriving chunk is written as a chunk rather than as an Event with its position left off.
- **A Harness holds what a build gives it, and is handed the prompt to answer** ([0062](adr/0062-a-harness-holds-what-a-build-gives-it-and-is-handed-the-prompt-to-answer.md)).
  Two structs held the same five fields and the same comments three times over. The Loop
  keeps the Provider and the system prompt; a `Prompt` carries the rest — named for what a
  person asks rather than for a turn, because "Turn" is pinned to one Provider exchange and
  this shape spans a whole Run. `core.Unit` goes, because a Harness already says it and one
  concept gets one name.
- **The layer that opened a Run is the layer that closes it** ([0063](adr/0063-the-layer-that-opened-a-run-is-the-layer-that-closes-it.md)).
  A Harness that returns without closing its Run leaves one a reader cannot tell from a
  Run still going, and a comment cannot hold that invariant because the layer holding it
  cannot check it. The assembly closes what comes back open, and a Run closes once.

## What supersedes what

Nothing is rewritten. A superseded clause is marked in the older ADR's own status line.

| Older decision                               | Superseded clause                              | By                            |
| -------------------------------------------- | ---------------------------------------------- | ----------------------------- |
| 0010                                         | the six-module packaging                       | 0021                          |
| 0012                                         | a transport failure is classified `other`      | 0038                          |
| 0015                                         | where a kept turn goes on screen               | 0023                          |
| 0038                                         | a failed turn names the Trace                  | 0041                          |
| 0019                                         | "/clear does not clear the screen"             | 0023                          |
| 0032                                         | `login` as a top-level verb with no noun       | 0052, which narrows it        |
| 0028                                         | `Attach` as a second way to attach             | 0061, which removes it        |
| 0040                                         | `Execute(ctx, spec)`, and per-turn fields      | 0062, which keeps the rest    |
| reference/architecture.md                    | `cli` imports config, providers, trace directly | 0045                         |
| product.md (now `roadmap.md`)                | config format left open                        | 0009                          |
| product.md (now `reference/architecture.md`) | the layer tree in the final-repo-shape section | 0010                          |
| product.md (now `roadmap.md`, stage 0)       | six modules                                    | 0021                          |
| product.md stage 0 (now `roadmap.md`)        | the `eva -p --json` exit-test clause           | stated in `roadmap.md` itself |

## Open decisions

Every decision the 2026-08-09 review left open has been taken, and each is recorded
above: the transcript schema in 0039, the Unit's shape in 0040, and where the loop
lives in 0037's consequence. The review that raised them is
[reviews/2026-08-09-architecture-review.md](reviews/2026-08-09-architecture-review.md).

Six things are undecided, and each is named here rather than assumed. Five wait on work
that has not started, or on a stage not reached. The sixth — where the extraction sits in
the build order — waits on a person, and it is an omission rather than a deferral:

- **The lease clock, while a Run is blocked on a human.** A lease carries a deadline, and
  a Run waiting on a person is idle by design. So the deadline must pause or extend, or
  the escalation races it and the Job requeues under the operator's nose. The answer must
  also re-enter the exact call on the resume Cursor rather than restarting the Run. This
  needs a lease, and leases arrive at stage 9b. What already lands is the record the pause
  will read (0055, 0056). The falsifier
  `reference/architecture.md` carries still stands for the lease half: if a tool ships a
  genuine elicitation-through-lease, adopt its shape instead.
- **Provider Credentials over the wire.** A shipped tool exposes them, which is how its
  web interface configures a Provider. That collides with the rule that a Credential never
  reaches a record, and with 0031's rule that the mode alone decides. It is flagged rather
  than adopted, and it needs a decision of its own.
- **Which machine a Remedy describes, per Error Class.** 0048 keeps the Remedy on the
  Frontend's own side, and a wire adds a third party. A turn that failed on a Server for
  want of a Credential has a Remedy belonging to that Server's operator. A turn that failed
  because a person's editor is unset has one belonging to the person. There are eight
  classes and the answer differs by class, so it is settled per class rather than once.
  0041 already fixes that the layer which can check a Remedy is not the layer that says it,
  which is the constraint the answer has to satisfy.
- **The binary's size budget.** 0053 puts the web interface in the binary and says a size
  budget belongs beside the prompt-byte budget. No figure is set and no gate exists. The
  base prompt's budget is a test (0020), and this one should be too — otherwise what ships
  grows by accident rather than by review.
- **The editor protocol surface.** Editors speak their own protocol to an agent, and
  serving it lets somebody else's editor drive Eva — the mirror of a Harness adapter. The
  seam is named in `explanation/the-service-seam.md` and nothing is built. It is a *second*
  wire contract, and rule 3 says a published contract to other people's code is the
  expensive kind of shallow. It waits until the extension host at 6.5 has exercised the
  first one.
- **Where the extraction sits in the build order.** 0045 to 0060 fix the shape and change
  no stage number, so the work they describe has no stage. `roadmap.md` says to work the
  lowest stage whose exit test has not passed, which is stage 1, and an agent reading it
  would not know when to do this. Stage 0 already has the word for the answer — it calls
  the Makefile a prefactor, which ships first so every later ticket lands against checks
  that already run. The extraction is the same shape, and naming it that is a change to the
  build order. That is a person's call, and it is unmade.

What is left after those is known cost rather than undecided shape, named here so it is
met on purpose:

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
