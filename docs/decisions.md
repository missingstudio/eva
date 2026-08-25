# Decisions

Every decision this repository has made, grouped by the thing it decided, one
entry each. An entry says what was decided and why, and names what it rejected,
in three or four lines.

Decisions made before code exists are marked **provisional** — they are held
because the reasoning is good, not because a test proved them.

## The plugin system

**A plugin is an `Effect`, not a `Layer`.** Effect's `Context` is compile-time,
so a plugin set built at runtime cannot be typed into it: a loader merging
`Layer<never, never, never>` compiles and then cannot return a service
(`effect@4.0.0-rc.109`). _Rejected:_ a Layer per plugin.

**There are exactly four extension points.** Domain, Slot, Hook, Broadcast.
Adding a fifth is an SDK change and a reviewed decision, not a convenience.

**One table declares the domains.** A domain was spelled in five places that
had to agree, and each `rowDomain` call paired a name with its topic by hand.
`RowInfos` maps a name to its Info and the types, topics, context, and kernel
derive from it; `satisfies Domains` makes a missed domain a compile error.

**`peek` is the production read of a Slot, and `get` is the test's.** Every
production reader answers for its own capability when a slot is empty, so there
is no shared fallback to concentrate; `get` dies instead. The defect was
`writing-plugins.md` teaching `get`. _Rejected:_ a read that takes a fallback.

**Same-id replace keeps the plugin's order position.** Replay order decides
which transform wins, so a replace that re-appends silently changes precedence.
Eva's own rule — OpenCode re-registers at the end. **Proven** by the reload
test in `packages/kernel/src/plugin.test.ts`, which runs on Bun and on Node.

**A Slot is late-bound.** Consumers read at the point of use and never capture,
so replacing the plugin behind a Slot takes effect on the next read.
_Rejected:_ Cordis's epoch-keyed reactivation. **Proven** by `swap.test.ts`,
which swaps a live sink with no restart.

**No boot phases.** Neither Cordis nor OpenCode has them; dependencies decide
order. A phase is a static partition that forbids legal graphs.

**A plugin may host plugins.** A host exposes extension points only its hosted
plugins see, isolated per host instance. Without this a harness can only be
replaced, never adjusted — DeepSeek Harness's base bundle has 78 rows for this.

**A row is registered whole.** `update` upserted `{ id }` cast to a whole Info,
so rows reached readers with every field but the id undefined, and six plugins
kept private mirrors and copiers to compensate. `set` takes the Info and keeps
a replaced row's position; `update` edits only a row that already exists.

**A declaration produces the reader.** A key was spelled beside the plugin's id
and again at the reader that took it, with nothing joining them. `declare`
returns the shapes and the `read` that takes a key it declared, so the shape
decides the value's type and its fallback.

**A plugin's own options are declared and swept.** Only the top level was
swept, so `maxTokns:` under a `plugins` entry fell back in silence while the
same mistake one level up was named. `takes` declares them and the same two
sweeps run over them.

**Dispatching a Command is one module.** Three exported parts meant every
Console assembled them itself, which is how the terminal answered an unknown
command with no suggestion. `dispatch` owns parse, resolve, suggest, run, and
the words it says.

**A plugin loads whole, or not at all.** A failing effect used to keep its
partial registrations, stay in `list`, and fire `added`. The rollback closes
the scope and leaves the plugin absent. _Rejected:_ keeping the partial load
beside a `failed` broadcast — a half-loaded plugin matches no plugin list
anyone wrote.

**A Transform is synchronous.** A rebuild replays every transform, so an
Effect return lets a transform run I/O that multiplies with plugin count.
Work runs once in the plugin's effect; the transform registers the result.
_Rejected:_ keeping the Effect return as a convention — a compile error
enforces the rule, and a convention does not.

**An edit that reached no row is reported, not solved with a graph.** An
`update` before its row's `set` no-ops on every rebuild, and used to do so
in silence. The miss rides the `<name>.updated` payload naming the id and
the owning plugin, and the terminal says it once. _Rejected:_ Cordis-style
declared dependencies — a manifest on every plugin to prevent what one line
now reports. Revisit at stage 6.5 with evidence.

**A second filler of a live Slot is named.** Last-writer-wins stays, because
load order is precedence everywhere else and a bundle overlay must be able
to replace a default. The eviction rides `slot.filled` as `evicted`.
_Rejected:_ refusing the second fill.

**An `.updated` topic keeps only the latest.** The payload is a snapshot and
a Broadcast carries no control flow, so a lagging subscriber that sees only
the newest commit has lost nothing. Sliding, capacity one; every other topic
stays unbounded. _Rejected:_ unbounded buffers on coalescible topics — a
wedged surface grows the heap for as long as the process lives.

**A hook dies toward its boundary's safe side** — provisional, lands with
stage 2's gate. An observing hook that dies is reported and skipped; a
deciding hook that dies is a denial. The boundary declares which it is.
_Rejected:_ one failure rule for both — skip-and-continue at a permission
gate is fail-open.

## The harness seam

**The harness contract is the Agent Client Protocol, not one we invent.** The
Go tree's `Answer(prompt) → Outcome` is one-shot: no long-lived session,
nowhere to ask permission, no typed record — so `--race` would compare
harnesses under three sets of rules.

**Eva targets ACP v1, shaped for v2.** v1 is what every shipped implementation
speaks; v2 is a labelled-unstable draft that hands the filesystem to the agent.
Eva's exposure is in the sealed union, not the client half. _Corrected:_ an
earlier entry called v2 "a transport change routing fs through MCP". It is not.

**Facts about a moving protocol carry the version they were checked against.**
The settled/unstable table went stale within one release cycle and misreported
four methods. It now names its SDK version. _Rejected:_ restating protocol
status from memory.

**The pin is `@agentclientprotocol/sdk` 1.3.0, and a test holds it.** The
architecture doc named a 1.6.0 that matches no release line; 1.3.0 is current
(checked 2026-08-15) and speaks protocol v1. `packages/acp` asserts every kind
against the SDK's schema.

**SDK 1.3.0 ships thirteen session updates, and two of them are draft.** The
eleven spec kinds each map to one payload kind. `plan_update` and
`plan_removed` are removable at any point, so they stay `unknown`, which is
what `unknown` is for.

**The block index belongs to the stream, not to a caller.** ACP sends none, and
a mapper taking it as an argument could only be handed zero, so two blocks
merged. `payloads` advances it itself: a block holds chunks of one kind.
_Rejected:_ `MappingContext`.

**The stop reason is the twelfth row of the mapping table, and it has a
mapper.** It arrives on the `session/prompt` result rather than as a session
update, so the eleven-kind table missed it. `toStopReason` returns Eva's
`StopReason`, and that return type is the tie.

**ACP's cost is a decimal amount with a currency, and only USD converts.**
`usage_update` carries `{amount, currency}`, and `costTicks` is defined in
ticks of 1e-10 USD, so USD converts at 1e10 and anything else stays unreported.
_Rejected:_ an exchange rate, which stops being the provider's own number.

**`usage_update` reports context occupancy, not a token split.** It carries
`used` and `size` where architecture §13 assumed input and output counts, so
the adapter commits no `usage` record and keeps only the cost. _Rejected:_
mapping `used` onto `inputTokens`.

**A cost is a level or an increment, and the two do not add.** ACP's cost is
cumulative and `costFold` added it, so $0.01, $0.03, $0.05 folded to $0.09.
`usage.costTicks` is one exchange and folds; `info.costTicks` is the total so
far and the last wins.

**Containment comes from the workspace, not from the protocol.** ACP's `fs/*`
and `terminal/*` are capabilities an agent may use, not obligations —
OpenCode's agent takes one display-only `writeTextFile` (SDK 0.21.0, checked
2026-08-14). The boundary is the Workspace.

**A sink stores; it does not sequence.** `TraceSink.append` carried three
ordered steps that both sinks reimplemented, held from outside by a suite in
`apps/cli`. A sink author writes a `TraceStore` and `sequenced` in core turns
one into a `TraceSink`. _Rejected:_ making the Slot itself `TraceStore`.

**An adapter is a record, not a Slot.** Five Claude Code sessions in five
worktrees means five instances of one harness kind; a Slot holds one. The
harness domain holds factories and a registry owns the instances.

**Eva's own harness has no privileged position.** One row in the harness
domain, disabled by config like any other.

**No bespoke adapter for anything that speaks ACP — and today that is
everyone.** OpenCode ships `opencode acp`, Claude and Codex have bridges under
the protocol's own organisation, and DeepSeek ships `@deepseek-ai/dsh-acp`. A
bespoke adapter dies the day its vendor speaks ACP.

**One ACP runtime plus thin per-vendor extensions, not one universal adapter.**
T3 Code runs a first-class ACP runtime and still needs vendor modules for
Cursor and xAI. An extension carries launch arguments, auth, and capability
probing — never protocol logic.

**Drive an SDK or an app-server, never a CLI's stdout.** A CLI's output is a
product surface that changes without notice. _Field check:_ every maintained
bridge targets the SDK or app-server.

**The repair loop is the caller's, not the Validator's.** Two documents put it
behind the Slot, and a Slot reaches no Provider Turn and no open Run, so a
second Validator plugin would have shipped a second control flow. The Slot
judges one Candidate; the Workflow owns the loop, the count, and the flush
points. _Rejected:_ `compile(schema) => Checker`, which hands the caller a
value made by a plugin that may unload.

**A native Harness reaches Eva through two members, and `updates` is empty
because it has no wire.** `HarnessInfo.open` is handed a `HarnessHost` that
takes one Run and commits one group, so the ACP contract is unchanged and, of
the two members, only `run` opens or closes a Run. The in-process transport is
direct calls, which architecture.md §12.8 already says. _Rejected:_ a second set
of step and run types at the same seam, with their own `close`.

**A Prompt that names a harness nothing can run is refused as a Run of its
own.** `SessionAPI.submit` opens one, closes it with a failed Claim and a near
miss, and takes no Provider Turn, so a person reads the refusal where every
other outcome is read. The Claim is classed `other`, the way `submit` classes a
cancelled Run: the eight Error Classes name provider faults, and this Run
reached no provider. It is the one Run boot opens outside `submit`, and no
harness reaches it, because it runs before a harness exists. _Rejected:_ a
silent refusal, and one sentence for both mistakes — an id that names no row and
a row without `open` are corrected differently.

**Two plugins claiming one Catalog namespace resolve by load order.**
`model.resolve` hands over a setter with no getter, so the last hook to answer
wins and the comment claiming otherwise was wrong. It is the wanted behaviour:
a person who names a compatible endpoint `openai` means it to override the
first-party one. _Rejected:_ giving the hook a read, which no Stage 1 caller
needs.

**The wire-agnostic Provider body is one sdk module; a provider plugin keeps
its dialect.** Three plugins spelled the same history mapping, error table,
credential resolution and stream drain, so a fix landed in one and missed two.
"Two plugins over two wires share nothing" stands for the dialects — event
mapping, stop reasons, usage counters — not for `streamingProvider`,
`classifyWire`, `chatMessages` and the credential helpers. One consequence is
deliberate: 529 now reads `overloaded` on every wire, where the OpenAI dialects
read `server_error`. _Rejected:_ a fourth package for the body — the sdk is
already the layer every plugin imports.

## The trace

**The payload union must carry an ACP session with no loss.** A missing kind
means every adapter emits `unknown` and the cross-harness comparison compares
incomplete traces. All eleven v1 `sessionUpdate` kinds map.

**Cost comes from the provider, in integer ticks.** Token count times rate
cannot reproduce request-level pricing, and a float loses sub-cent precision.
Absent means not reported — never zero, never estimated. Ticks are Multica's;
absent-not-zero is ours, and it governs the record rather than the projection.

**An estimate is a projection, and never a record.** No model API returns a
price, so `costTicks` is empty on every direct provider. `costFold` takes a
price lookup and answers `estimatedCostTicks` beside it, never merged — a
stored one freezes a rate and drifts.

**The price lookup is derived once and handed over.** Three callers each
spelled `priceLookup(catalog.get)` and two declared the same optional field
with the same comment. Boot derives it beside the Catalog onto `ctx.prices`; it
stays an Effect, so a Catalog rebuild moves the next estimate.

**The price snapshot is vendored, and `tokenlens` takes it.** A hand-typed rate
table restates a moving vendor fact, and tokenlens's bundled catalog holds none
of the seeded models. `fixtures/generate.ts` writes a reviewed `prices.ts`, and
boot does no network.

**One module owns the content block.** The variants were declared three times —
union, wire schema, and a lenient copy — with a fourth walk converting between
them. `packages/schema/src/content.ts` holds the strict schema and the lenient
reader together. _Rejected:_ one schema for both, which accepts corruption.

**The Ticks conversion lives with the unit.** `1e10` was declared in three
places with three rounding postures, one of them inline in a template string.
`toTicks` and `toUsd` sit beside the union that defines the unit. _Rejected:_ a
constant per caller.

**A vendor delta with no kind is preserved; framing is not.** The Anthropic
provider returned early on every stream event that was not a text or thinking
delta. A delta is content, so an unmapped one commits as `unknown`; envelopes
and block boundaries are structure. _Rejected:_ recording every frame.

**A Provider Turn reports why it ended, and the Run takes it from there.**
`turn` returned a bare stream, so `submit` closed every Run with a hardcoded
`end_turn` and a `max_tokens` cut-off read as clean. It returns a
`ProviderTurn` now, and silence is absent.

**A stop reason is not an error class.** A refusal is a legitimate outcome and
a token cap is a budget fact.

**Usage is keyed by model.** One Run can span several.

**Counters are clamped once, in `eva.usage`.** The Anthropic provider clamped
negatives and truncated fractions in its own mapper, while
`provider.response.after` already does that work for every provider. A
provider reports the counters as they arrived; silence stays null. _Rejected:_
keeping the provider's copy as a guard — two rules for one concern drift
apart.

**The reader's schemas are tied to the union at compile time.** `{ kind,
...parsed.data } as Payload` let a body that dropped a field compile. Each body
is compared field for field with its member, which found two unbranded strings
the type called branded.

**The schema version is not on the in-memory record.** `decode` refuses every
version but its own, so the field had one possible value everywhere and was
still stamped by the Recorder and seven test builders. The wire keeps it; the
codec refuses in and stamps out.

**One coalescing rule, and the caller says which kinds it covers.** "Adjacent
text in one block coalesces" was written twice with different guards. One
function takes the kinds it applies to, so the Trace coalesces `text` and the
transcript `text` and `thought`.

**Every projection lives with the others.** Three folds sat under a reviewed
golden; the Session Header was hand-written in core with none, and the Answer
was folded in `apps/cli`, where its only test surface was the composition
root's own suite. `headerFold` and `answerFold` joined them and the golden pins
five. `SessionHeader` stays in core, because a Session's identity is the
Session API's to add.

**A fold says where it folded to.** `Transcript` carried no position, so a
surface that read the record and then subscribed had no cursor to subscribe
from: it lost whatever committed between the two calls, or replayed from the
start and duplicated. `foldTranscript` computes `at` from the events it kept,
so the two implementers inherit it and cannot disagree with the record.

**A cursor watch follows the record; an uncursored one stays live.** A cursor
is a trace position, and positions exist only on committed events — the live
hub carries payloads before the sink numbers them, and commit merges adjacent
text, so the two streams are different granularities of one Run and cannot be
stitched. The cursor form therefore emits what `attach` would fold. Only that
form can fail, and the type says so: a watch with no cursor is behind nothing,
so no caller handles a refusal that cannot arrive.

**Subscribe, then read.** The cursor path takes the committed subscription
before it reads the record, and drops the overlap with one strict inequality on
the position. Read-first loses every event that commits during the read — a
race that passes when nothing is streaming and fails exactly when a surface
reconnects mid-Run. The test swaps the two lines to prove it.

**Following the record belongs to the sink.** `sequenced` is the one path that
assigns positions, so it is the one place that publishes them, and every sink
inherits `highWater` and `follow` unchanged. _Rejected:_ `RecorderDeps.published`,
the dead seam that offered the same thing one layer too high — a recorder is
per-Run and swappable, and following is per-session and outlives a Run.

**A replay too far behind is refused, not attempted.** Past
`WATCH_REPLAY_BOUND` the stream fails with `ResumeTooFarBehind` and reads
nothing; the caller folds fresh and watches from the fold's own cursor.
Unbounded replay of an append-only log is how a long-lived session exhausts a
subscriber. _Rejected:_ a payload kind for it — the schema is a versioned public
contract, and a resume that is too far behind is a fact about one subscription,
not something that happened in the session.

## The exit test

**Running the fixture in-process has one home.** `runFixture` takes a fixture
Workflow and hands back its Trace; the Build table is stated once beside it,
so the recorder no longer mirrors the config's plugin ids by hand. The
model-calling fan-out stays in `scripts/`, outside the test globs — the
src/-scripts/ split plan 010 calls load-bearing holds.

**The deterministic gate replays the vendored cassettes, not fold arithmetic
alone.** Each cassette runs back through the real fixture — the Workflow
harness, the Validator, the Repair — and its Trace must fold to the golden
the vendored trace folds to, so trace, cassette and golden are three
projections of one recording and `recorded` has a caller besides its own
test. _Rejected:_ hand-written traces the gate merely re-folds, which pinned
the arithmetic and nothing the fixture runs on.

**The gate's verdict is one value.** `gate` reads the traces back, applies the
no-Candidate share and the two thresholds, and answers what to print and why
it failed; the runner prints and exits on that report. The repair yield was
computed once to print and once to decide — `repairsOf` is the one
computation both read.

**The module that decides owns the rule it decides by.** The no-Candidate
share and the endpoint pin sat in `score.ts`, whose whole job is to fold and
print, so `gate.ts` imported its own verdict rule from the printer and
`fixture.ts` reached the endpoint through `../src/score.js`. The share moved
to `gate.ts` and the endpoint and `WORKFLOWS` to `fixture.ts`; the scorer
folds and prints and knows nothing of the fixture.

**Where a Run's Trace lands is one inline config layer.** The in-process half
rewrote the resolved `eva.trace.jsonl` entry and the fan-out interpolated the
path into a YAML string, so the measured half ran a mechanism the gate never
proved and a path holding a quote wrote a file nobody read. `hermeticEnv`
says it once, as JSON inside the layer both halves send. _Rejected:_ moving
the fan-out under `src/`, which the load-bearing split forbids.

## Vocabulary

**The bare word `turn` is retired.** It means the whole arc in ACP and DeepSeek
Harness, and one provider exchange in OpenCode and Eva's Go tree. Eva uses Run,
Step, and Provider Turn.

**One concept gets one name.** The only rule in `context.md` worth being strict
about, alongside recording where a borrowed term came from.

**The fourth extension point is a Broadcast.** Event meant both the trace
record and the process-local notification, and the two contradict — one has
exactly one versioned schema, the other none. The trace record keeps the name
Event.

**Pipeline and Partial are retired, and Workflow, Step, Candidate, Output,
Verdict, Fault, Repair, Validator, Template, Variable, Gap and Instruction are
promoted.** Pipeline collided with the shell idiom on the same line as Stage
1's own demo, and Partial was a second name for Template. A Repair is not a
Retry: `retry.errorClass` is required and all eight classes are about reaching
a Provider.

## Documentation

**Each document reads start to finish.** No jumping around inside a file.

**Never duplicate — link instead.** Two copies of a fact become two different
facts. The stage-0 working file was the one exception: it was deleted when that
effort ended, and a copy that cannot outlive its subject cannot drift.

**Code in a document is an excerpt, and its types are checked.** A snippet that
does not compile is worse than none, because a reader trusts it.

## Surfaces and remote

**A surface is a row in the `surface` domain.** "Every user interface is a
plugin" needs an extension point and had none. The domain holds factories, one
row per surface: a surface is started and stopped, so it cannot be a Slot.
_Rejected:_ a `Frontend` Slot.

**OpenTUI is admitted by name, and the gate still holds for everything else.**
No OpenTUI release is ever older than `bunfig.toml`'s three-day floor, so the
rule was a refusal and not a delay. `minimumReleaseAgeExcludes` names its
packages one per line, and `effect` joined them.

The risk this accepts is native code over Bun's FFI from a package published
two days before it was pinned. It is accepted for one dependency, pinned
exactly, with `Renderer` as the seam that makes dropping it a one-package
change.

**The renderer degrades rather than refusing.** OpenTUI draws where there is
FFI and a real screen; everywhere else a stream renderer draws the same
`Frame`. The composition root reaches the terminal by dynamic import, so Node
and `--print` never load the native chunk — CI asserts both halves.

**Two contracts cross the surface seam, in opposite directions.** `SessionAPI`
is what a surface calls; `Frontend` is what a surface implements. As one
interface it could not be implemented. A surface that cannot ask declares
`interactive: false`.

**A surface says what it can do once, on its row.** The three capability
booleans sat on the row and on the `Frontend`, written by hand in both, and
only the row was read. The row is the declaration; the `Frontend` keeps `ask`
and `done`.

**There is no transport layer on the surface seam.** A remote surface is a
plugin that speaks HTTP to `eva.api`, calling the same `SessionAPI` methods.
_Rejected:_ the Go tree's direct/remote pair. _Corrected:_ this entry once said
`Transport` was the harness seam's alone. The client runtime has one too, on the
caller's side of the same `SessionAPI` — never on the seam the kernel answers.

**The order a surface calls the Session API in is a protocol, and it has one
home.** The terminal and the print path each wrote it, and disagreed: one
stopped its drain on a bound, the other waited on a close that a watcher which
subscribed too late never hears. A third surface would have copied one of them,
and copied whichever race it held. `packages/client-runtime` holds it once —
subscribe, submit, drain in a bound, fold — and the bounded stop is the
direction it settles on.

**A surface is handed one handle, not the contract with a protocol beside it.**
`SurfaceInfo.start` takes a `Client`: the whole `SessionAPI`, plus the Run
protocol over it. The composition root builds one where it builds the API, so a
surface cannot reach a session call the runtime does not carry — the type is
most of that assertion, and a grep over what ships keeps the rest. `client.api`
is the same `SessionAPI` shape, so a command that only reads the contract
changed nothing. The sdk names the client runtime in that one signature, and the
runtime imports core alone, so the dependency points down. _Rejected:_ handing a
surface the API and `runPrompt` beside it — two things to pass is two things a
surface can pass one of.

**The client runtime holds what the server needs to hear about, and no
pixels.** It imports the contracts and nothing that draws, so the same package
serves a terminal, a web page and a phone. It takes one domain at a time, when
a real consumer needs one; today that is the Run. _Rejected:_ a cached read
model per domain up front — nothing reads one yet, and the record folds on
demand.

**Where the Session API lives is one interface, filled three times.** The local
filler is in this process, the second is a read-only HTTP reader, the third is
the whole wire. The local filler proves the shape and the second proves the
shape was right; if it does not survive its second filler, that is cheaper
learned at the second than at the third. `droppableTransport` ships beside it
rather than in a test file: it is the seam's own proof, and the exit test runs
on it from another package. _Rejected:_ extracting the client runtime with no
seam — the reconnect machinery is already built and no consumer passes a cursor,
so the package would own connection lifecycle without ever losing a connection.

**A transport says two things about the pipe, and says nothing through an error
channel.** `ready` or `disconnected`, and a drop ends every open watch.
`SessionAPI` has no error channel and the seam keeps it that way, so a call made
while the pipe is down waits: slower, never differently typed. A consumer that
must react to a drop reads `health`; one that only calls methods needs no new
handling. _Rejected:_ the field's six phases on this seam — they belong to a
filler whose wire can flap, and the three values a consumer acts on are the
runtime's, above the pipe.

**A reconnect folds fresh, and never resumes from a live position.** The live
stream's payloads carry no positions, because emit precedes commit, so a client
reading live deltas holds no honest cursor. Its only honest positions are
folds: on a restore the runtime folds with `attach` and watches from that
fold's own `at`, which is the gap `Transcript.at` and the cursor watch closed
between them. _Rejected:_ remembering the last live payload and resuming from
it, which is a position nothing ever assigned.

**The caller never sees `ResumeTooFarBehind`.** The head can move past the
replay bound between the fold and the watch, and the answer is the one the
Session API names: fold fresh again, watch from the new position. Every fold
restarts the gap at zero and the bound is a thousand commits wide, so the loop
converges. What the caller pays is one more repaint. _Rejected:_ surfacing the
refusal, which would make every surface hold the same recovery. _Corrected:_
plan 006 said the loop stays in `synchronizing` across a refusal. It cannot: a
refusal is decided on the resumed watch's first pull and nothing is knowable
before that pull, so the state reads `ready` for it and walks back. Declaring
`ready` only once the watch has produced would leave a quiet Run
`synchronizing` for as long as it stayed quiet.

**A Run says payloads and folds on one queue.** `RunSignal` is `payload` or
`folded`, so a repaint after a drop arrives in order with the words around it
and a surface needs no second channel to reconcile. The union is total, so the
print path — whose pipe is the process, and which therefore never refolds —
still has the compiler tell it when that stops being true. _Rejected:_ a
separate callback for the fold, which two consumers would have to order by
hand.

**The Answer is a fold on the record, so nothing folds the Trace twice.**
`Transcript` says `answer()` beside `messages()` and `cost()`, because it is
the same thing they are. Before it, the harness path read the trace sink out
of the kernel and folded the Answer itself — the one Slot read in shipped code
outside boot — while the print path scraped the Claim off the live stream. One
question, two answers, one file. Both now read what the runtime gives back.
_Rejected:_ a Session API method of its own — `attach` already returns the
record, and a second call would be a second read of the same events.

**The Run protocol gives back what the Run answered, and falls back once.**
`runPrompt` returns a `RunOutcome`: the record, and the Answer. The Answer is
the record's own fold, except where the record holds no Claim and the stream
said one — a build with no Trace has nothing to fold, and the Run still
answered. The fallback lives in the protocol rather than in each caller,
because two callers with the same fallback is how the print path and the
harness path came to disagree in the first place. It is the one-Run case it is
written for: a Workflow with no Trace cannot answer at all.

**The in-memory Session API is a filler, not a fake in a test file.** The
cursor watch's rule — subscribe, then read the record, then drop the overlap
on a strict inequality — was written out three times: the kernel's, one inside
`client-runtime`, and one inside the terminal's own suite. Two of the three
were where the reconnect and drop tests took their confidence, and a copy of a
rule keeps passing after the rule moves. `memorySessionAPI` ships beside
`droppableTransport` for the reason that one does: the rule it carries is the
seam's, not one suite's. What a Run says stays the caller's, through one
`answer` callback, so one filler serves a suite that streams words, one that
closes early and one that never closes at all.

**One suite holds both fillers of the Session API.** `packages/conformance`
runs the same twenty assertions against the kernel's filler and the in-memory
one. It earned its place on the first run: the in-memory filler did not open a
Run with `started`, so two Runs folded to one Answer and nothing said so. A
suite that only ever drives one filler cannot find that.

**A fold while a Run is open is a repaint, not an ending.** The Console reset
its mode to `ready` on every fold, because until now a fold only ever arrived
at close. It reads the Run's own spinner instead: a Run says when it is over,
and a dropped connection is not it.

**The loop's rules are a fold, as the screen's are.** The Console fold has
always said what the screen shows; the loop's own state — the open Run, the
lines typed behind it, the armed cancel, which close closes which Run — was
mutable locals inside `makeSurface`, reachable only through a real renderer, a
real Client and a real event loop. Its suite slept for them: 91 timed waits
and two five-second pollers, 56 tests in 6.25 seconds, against 38 tests in
seven milliseconds for the fold beside it. `loop.ts` takes what happened and
answers with what to do; the surface does it and decides nothing. Sixteen
rules moved and now cost five milliseconds.

**Everything that moves a Run goes through the fold, the panel included.** A
row taken from the command palette used to reach `handle` directly. With a Run
already open that forked a second one over it and dropped the fiber holding
the first, so nothing could interrupt it and its close named a Run the loop
was no longer holding. A row is a line like any other, and one door for lines
is what makes that unwriteable rather than merely fixed.

**A Surface shows where the runtime is, and decides nothing about it.** The
Console holds `connection` and the status line says it, most urgent first: a
pipe that is gone outranks a question, which cannot be answered down it, and
outranks an open Run, which is not running. Nothing else moves — the Live
area, the fold and the open Run are the runtime's to put back, and it does.
Until this, `Client.state` was read by no shipped code and a drop cost the
terminal one silent repaint: the words rewrote themselves, coarser, with
nothing to say why.

**Remote-ready is three constraints on the two surface contracts, not a
feature.** Everything in them serializes, local facts stay out, and
reconnection is by `Cursor`. Hold them from the first surface; retrofitting
means revisiting every surface built meanwhile.

**Local facts do not cross a process boundary.** Which editor is installed,
what the working directory is, whether a remedy can run here. The membership
test: if the answer depends on which machine asks, it stays out of the
contract.

**The binding grammar is one module, and the keymap alone decides what a key
means.** Only `makeKeymap` could call `formatKey`, so nothing authoring a
binding could ask whether its string was well-formed, and four defects grew in
that gap. `canonical` sits beside it now.

**tui-core's dead exports are cut.** `Screen` made the same claim `Renderer`
makes with zero adapters, and the architecture doc cited it as the real drawing
contract. `Theme`, `Size`, and `size()` had no consumers. The deletion test
passed: nothing relocated.

**The theme contract is what is drawn.** `ThemeColors` carried seven colors and
`paletteFrom` read four. `THEME_KEYS` and `themeColors` are now the one
vocabulary and the one gate, and a `theme:` that names no row keeps the default
and says so — a theme dropped in silence reads as a theme applied.

**A Frame's strings have one home.** `Frame` holds pre-formatted strings, and
the closures that produced them lived in the surface plugin, reachable only
through a fake Renderer. `tokenLine`, `seconds`, `costText`, and `took` sit
beside `Frame` in tui-core.

**The Frame states its sequencing invariants, and a pipe carries the
conversation.** The stream renderer leans on two facts about `live` — within a
Run it only grows, and it returns to `""` when the stream is over — which were
true and stated nowhere. The contract says them, and which fields are chrome.

**A press carries the typed glyph, and a chord names its key.** readline
lowercases a letter whatever was typed and `toKeyPress` preferred the name, so
capitals landed lowercase. The typed sequence wins when it is one printable
character with no modifier.

**A command that opens another Session is followed there.** `/clear` selected
the new Session, printed its raw id, and left the old conversation on screen.
The surface refreshes when a command's `select` lands elsewhere — for a new
Session, nothing, which is what clearing looks like. The id print went with it.

**The end of the input is the Renderer's own word.** The minted ctrl+d press
worked only while `app.quit` stayed bound to it; rebind it and end-of-input
resolved to no command and the surface waited forever. `Renderer` carries
`onEnd` beside `onKey`, so the keymap no longer decides what silence means.

**A renderer dropped in silence reads as a renderer chosen.** A rich renderer
that failed to load fell back with its reason discarded, and a configured theme
landed on the plain renderer without a word. `start` returns the renderer
beside its notices.

**The Console is a module, and the loop stays at the queue.** The screen's
rules lived as closures over eleven mutable variables, and the loop awaited
each Run inline, so a cancel pressed mid-Run waited for the Run it was meant to
stop. The Run is a fiber now.

**The record is the record, and the surface's own words are notes.**
`Frame.session` was the fold and also carried the surface's own lines, so a
notice was destroyed when a Run closed. `notes` sits beside it and lasts until
the conversation moves on.

**A press says whether it carries a character.** "One typed character" had
three definitions: code points in the normalizer, UTF-16 units in the editor,
and a caret positioned for one it could never receive. `KeyPress` carries
`glyph`, decided once, and `Chord` is split out as what a binding spells.

**The Renderer contract says what stopping means.** `stop` was three words over
two adapters that disagreed, and the surface domain holds factories, so a
restarted surface leaked a listener per cycle. It is idempotent, frees every
subscription, and a later `draw` does nothing.

**A paste is the Renderer's own word, beside the end of input.** A block
vanished on OpenTUI, which names no key for one, and opened a Run per row on
readline, which delivers it a character at a time. `Renderer` carries
`onPaste`; the terminal knows a paste from typing, so it never reaches the
keymap and a newline in one is text. _Rejected:_ widening `glyph` to mean
"carries text", which splits one typed character across three modules again.

**A Run is over when `submit` returns, never because a watcher said so.** The
watcher subscribes after it is forked, so a Run closing in the same turn was a
close it never heard, and it waited on that close forever. `submit` does not
return until the Run has closed. The watcher feeds the Live area, drains
within a bound, and is stopped. _Rejected:_ subscribing before submitting —
neither `Stream.toQueue` nor `Stream.onStart` is eager in `effect@4.0.0-rc.109`.

**A screen is written over, not erased first.** `CSI 2J` and a whole frame on
every draw blanked the screen between frames, a frame per streamed word. It
homes, writes each row clearing the tail, and erases below; an identical frame
writes nothing.

**The caret, the panel, and the colors are facts of the Frame.** Each was a
decision a renderer made alone, and a place two renderers could disagree.
`Frame` carries `cursor`, an optional `overlay`, and an optional `theme`; a
renderer may ignore what it cannot draw.

**Enter on a panel row runs it, and an argument hint is not a demand.** The
palette read `argumentHint` as two facts — what an argument looks like, and
whether one is needed — and typed the row out instead of running it. It
silenced the only two rows that name one, `/theme` and `/model`, which are
exactly the two that answer a bare line with a choice of their own. Enter
runs, tab completes, as the panel's hint always said. _Rejected:_ a `required`
flag, a domain field for a case no command has.

**One physics for selection, and every panel is reached through a command.**
Type to filter, up and down to move, enter to take, esc to keep what you had —
the same in the palette, in completion, and in every picker. Rows rank prefix
first, then word starts, then a scatter. Completion's query _is_ the buffer.

**A capability is what a surface can do, not what a command may assume.**
`CommandContext` gains optional `pick` and `paint`: a pipe supplies neither,
and `/model` writes the models instead of picking. The key handler resolves the
panel's Deferred, because the loop is what the command is blocking.

**A theme is looked at before it is chosen, and only a command applies it.**
The surface paints a pick row's colors while it is under the selection and
restores them when the panel closes. Applying goes through `paint`, so `/theme
mono` takes the picker's last step.

**The panel takes rows above the input line rather than floating over the
fold.** A floating panel has to hide what is behind it, and the theme contract
carries no background color. Geometry is the renderer's: OpenTUI draws a
bordered box of at most eight rows.

## Configuration

**Config is YAML.** `~/.eva/config.yaml`, bundle overlays, and profiles share
one format. Comments were the reason over plain JSON, and YAML carries them
without JSONC's nonstandard parser; Workflow and task specs were YAML already.
`package.json` stays JSON because npm owns it. **Proven** by `config.ts`.

**A layer merges per key, and the plugin list is the exception.** A mapping
merges key by key, a scalar replaces, a list replaces whole. The plugin list
concatenates and resolves per id, and within an id each field replaces as a
unit, so a flag erases no options.

**Every leaf remembers the file that set it.** The merge carries a dotted key
to source table, so `eva config show` says where each value came from and a
refusal can name the file that tried. _Rejected:_ provenance by diffing prefix
snapshots.

**The trust grant lives beside the person's config, not in the repository.**
The gate read `.eva/trust` inside the directory it trusted, so any checkout
could ship one. `trusted` sits beside the user's config, paths are
canonicalized, and the walk stops at the repository.

**A directory is a config layer.** `.eva/agents`, `.eva/commands`, and
`.eva/themes` produce the mapping a config file produces, so one merge law and
one origin table cover both. An agent prompt wants to be Markdown. The config
file is the later layer. **Proven** by `packages/kernel/src/resources.test.ts`.

**A key that reached nothing is named, with the key it likely meant.** Refusing
unknown keys would make each new plugin option a kernel change, so the
interpreting half reports the key, the file, and the nearest spelling. OpenCode
drops them silently.

**A key read in the wrong shape is named too, and the singular stays.** `theme`
selects one theme and `themes` holds the themes there are; either shape under
the other key reached nothing and said nothing. The shape is checked, and the
report names the key that would have taken the value as written.

**A flag is a layer, and the whole order is one module.** §10's order was
written twice and rung 9 applied by hand, so `--model` carried no origin and
`--show-config` named the losing file. `resolveConfiguration` holds every rung,
and the flags merge as one layer whose origin is the command line.

**Commander parses the command line, and it never acts.** The hand-written
parser had verbs wearing flag clothes. Handlers only record an `Invocation`;
`main` acts. `--no-plugin` became `--without-plugin`, which Commander read as a
negation. See [the reference](reference/command-line.md).

**The World is an argument.** `main` reached for `process.cwd()` and
`process.env` inside, so the trust branches and `--show-config` had no test
that did not touch a real home directory. One module builds the World;
everything else is handed one. _Rejected:_ a default that reads the process.

**A finding is data, not a line.** What a run did not read was six string
templates in the composition root, with no type and no test. It is a `Finding`,
and the terminal decides only how a person reads one. The interpreting half
still never imports the kernel: the origin arrives as a question to ask.

**A plugin declares the config keys it reads.** Two constants in `eva.config`
named keys owned by the kernel and by the TUI, so a third-party plugin's option
was reported as reaching nothing. `reads` sits beside the plugin id as data,
not a registration, so `eva config show` still answers before the kernel boots.

**The shape a key is declared as is the shape it is read as.** `eva.tui`
declared `theme` as a `name` and read it with `stringOption`, so `theme: { id:
mono }` passed the sweep and was ignored. `fitsShape` and `nameOption` sit
together in the SDK, and a test asserts the two agree for every value.

**`model` is a key the kernel carries, not one it reads.** `Config` lifted it
into a field, so it was parsed twice from two shapes and `ctx.model` held a
copy answered before the Catalog loaded. It lives in `raw` now, with every key
a plugin interprets.

**The kernel's assembly is a package, not a file in an app.** `boot` defines
what Eva's kernel is and sat in `apps/cli`, so an Electron shell would have
copied it. `packages/boot` holds it and the composition root keeps what differs
per artifact. _Rejected:_ naming it `host`, which collides with Host plugin.

**Boot loads the plugins it assembled the kernel for.** The composition root
walked the resolved list and wrapped it in `batch`, so the rule that rebuilds a
domain once was the caller's and five test harnesses each missed it. `boot`
takes the build and loads it.

**A plugin's tests may boot it, and only its tests.** No plugin may import the
kernel, so plugin tests asserted on pure helpers and five plugins grew private
slices of `PluginContext`. `packages/testkit` runs a plugin through the real
`boot`; the layer rule widens for `plugins/**/*.test.ts` alone.

**A build answers once for what it carries.** `Kernel.missing` had no
production reader while the `uncarried` Finding derived the same fact
separately before boot. `Build` is one object with `all` and `carries(id)`: the
Finding asks first, `missing` reports after.

**The row Draft belongs to the Domain, not to the composition root.**
Sixty-eight of boot's lines implemented what a Draft of rows does, reachable
only by assembling a whole kernel. `makeRowDomain` sits beside `makeDomain`,
and `Row` moved to `core/extension.ts`.

**The `SessionAPI` is implemented where it is declared, not in an app.** Core
declares it and the only implementation lived in `apps/cli`, so nothing below
the app could be tested against the contract. `makeSessionAPI`, `runTurn`, and
`priorMessages` sit in `packages/boot`; the app parses, resolves, and drives.

**Holding two adapters to one contract is a package, not an app.** A plugin
test may not import another plugin, so such a suite had one legal home — and
`apps/cli` owned 482 lines never about the command line. `packages/conformance`
ships nothing at all.

**Booting several plugins as peers is `withKernel`, in the testkit.**
`withPlugin` was deep for one plugin and absent for several, so seven suites
re-spelled boot, build, scope and close — two of them under the name
`withKernel` with different signatures — and six read the record back by
casting the Slot to the memory sink's own type. `withKernel` owns the dance
and `withPlugin` is one call of it; `committed` reads the Trace through the
`TraceSink` contract, so no cast is needed. The two suites that call `boot`
still are not this shape: one loads nothing and adds plugins mid-Run, and one
hands out a seam whose scope outlives the call.

**A test waits for the thing it asserts, never for a fixed pause.** The
surface suite's `settle` was one 10ms sleep, so under a loaded suite three of
its tests read state the loop had not reached yet — the file's own
`drawnWhere` already said a fixed pause misses on a loaded host. `settle` is
turns of the event loop, `drawnWhere` polls the screen, and `heldWhere` polls
the spy, each bounded.

**What a module needs from the machine lives in core.** `expand` was written
twice character for character and the sixteen-character id three times, because
a plugin may not import the kernel or an app. Two copies of one rule are two
rules the moment either changes. _Rejected:_ exporting them from the sdk.

**A fake Provider is a plugin, not a hook registration.** Two CLI tests
registered one by casting the event to reach `resolve`, which defeated the map
`ProviderHookSpec` exists to check. `providing` in the testkit supplies a
Provider the way a provider plugin does, with no Scope of its own.

**`ctx.plugin.add` names `Plugin`.** It took `{ id: string; effect: unknown }`
because `context.ts` and `plugin.ts` refer to each other, and the stand-in cost
the kernel the one unchecked cast on the plugin seam. Types are erased, so the
cycle is allowed, and both are gone.

**Vite+ on Bun.** One CLI over Vite, Rolldown, Vitest, Oxlint, Oxfmt, and
tsdown. Bun because OpenTUI's renderer needs FFI, and that constraint stops at
one module — `packages/tui/src/renderer.tsx`, reached by dynamic import.

**`apps/` holds what you launch; `packages/` holds what it is built from.** The
rule is about who runs, not who is biggest: the terminal is a library the entry
point draws through, so it stays in `packages/`. _Rejected:_ opencode's layout,
which puts the bin in `packages/cli` and has no `apps/` at all.

**An interface is a plugin until it needs its own runtime.** A surface this
binary can serve is a plugin and adds no app; a shell carrying its own runtime
and release artifact is an app. An app still never imports another app.
_Corrected:_ an earlier entry said there would never be a second app.

**A tsconfig per package, and still no project references.** `lib` and `types`
are per-program, so one program cannot give DOM to a web surface and withhold
it from the kernel. _Rejected:_ references, whose `composite` forces emit; and
a fan-out, at 3.0s against 1.4s.

**A package declares the types it claims.** Each depends on `@types/node`
directly, pinned to the oldest runtime `engines` accepts, so a package cannot
call an API that runtime lacks. _Rejected:_ a root `types: ["bun"]`, which
hands every package a runtime it does not run on.

**`effect` is pinned exactly.** v4 is a release candidate. A range is a Tuesday
nobody wants.
