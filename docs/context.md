# Context — the words Eva uses

This file fixes the words Eva uses for its own machinery. One concept gets one
name — in the code, the traces, the config, and in conversation.

[README.md](README.md) says **what** Eva is.

Each entry is one definition in at most three sentences, saying what the term is. `_Avoid_` names a rejected word — using one is a defect. Deferred is a
parking lot; move terms either way as the work needs, without ceremony.

## The plugin system

**Kernel**:
The part of Eva that is not a plugin. It holds the plugin runtime, the four
extension points, the config source, and location resolution. Nothing else — the
event schema is a package the Kernel imports, not a part of it.
_Avoid_: Core (that is a package name), runtime, framework

**Plugin**:
A module that exports an id and an effect, and declares the config keys it
reads. The effect runs once at load and registers into extension points.
Everything that is not the Kernel is one.
_Avoid_: Module, extension, addon, package (a package is how a plugin ships)

**Extension point**:
One of exactly four ways to extend Eva: a Domain, a Slot, a Hook, or a
Broadcast. There is no fifth.

**Domain**:
Shared state that many plugins build together. The Kernel rebuilds it by
replaying every registered Transform in order, then running the domain's
finalizer.
_Avoid_: Registry (a registry holds; a Domain rebuilds), store, collection

**Transform**:
A registered callback that edits a Domain's Draft. It replays on every rebuild,
so it describes a contribution rather than performing one.
_Avoid_: Mutation, patch, contribution

**Draft**:
The narrow editor a Transform receives. It speaks public types, and it is never
the Domain's internal state. A row is registered whole — a Draft never mints a
part of one and types it as the rest.
_Avoid_: Editor, builder, proxy

**Declaration**:
The config keys a plugin reads, and the reader they produce. One half goes
beside the plugin's id and the other reads a key out of config, so a key is
declared and read in one place. The key sweep asks the same reader, so a value
it passes is a value the plugin can read.
_Avoid_: Schema (a Declaration validates nothing and rejects nothing — the
word belongs to JSON Schema, which does both), options

**Seam**:
A complete swappable capability, in three roles: the **Slot** that defines it,
the plugins that fill it, and the plugins that read it. The Seam is the whole
capability. Name a part by its role, never by calling the part a Seam.
_Avoid_: Using Seam for the Slot alone

**Slot**:
The definition half of a Seam: a typed key and its contract. Exactly one plugin
fills a Slot at a time. A consumer reads it at the moment of use and never
captures it, so replacing the plugin behind it takes effect at once.
_Avoid_: Service key (a service key is fixed at build time; a Slot is
late-bound), singleton, provider (a Provider is a model)

**Hook**:
A callback at a live operation boundary. Hooks run in registration order, a
later Hook sees what an earlier one changed, and a Hook may narrow what a Run
does but never widen it.
_Avoid_: Listener, interceptor, middleware

**Hook boundary**:
Where one family of Hooks runs, and the declaration of what they do there. A
Hook that dies at a **deciding** boundary is a denial, because a gate that
fails open when a plugin throws is not a gate; one that dies at an
**observing** boundary is reported through `plugin.failed` and the Run goes on.
The boundary declares which it is, because only the caller of the Hooks knows
what they decide.
_Avoid_: Hook kind, hook type, deciding hook (a boundary decides, not a Hook)

**Broadcast**:
A typed, process-local notification a plugin subscribes to as a stream. It is
never written to the Trace and carries no schema guarantee across versions;
control flow belongs to a Hook.
_Avoid_: Event (that is the trace record), runtime event, signal (a stage 13
domain)

**Registration**:
What registering into an extension point returns. It is owned by the registering
plugin's scope, and disposing it is safe to repeat.
_Avoid_: Handle, subscription, disposer (a disposer is the function inside one)

**Host plugin**:
A plugin that loads plugins of its own and exposes extension points only they
can see. Its hosted plugins live in its scope and unload with it.
_Avoid_: Container, parent, framework

**Scoped registration**:
A contribution visible to one Host plugin instance rather than to all of Eva.
Two hosts that declare the same extension point have two of it, not one shared
one.
_Avoid_: Local, private, namespaced

**Bundle**:
An npm package that contributes plugins. It carries a config layer that applies
when a Profile lists it.
_Avoid_: Distribution, pack, module

**Build**:
The implementations one artifact carries, and the single thing that answers
whether it carries a given id. A composition root owns its Build and hands it
to boot, so the config report and the run that follows it cannot name different
plugins. A Build says what exists here; config says what loads.
_Avoid_: Registry, table (a table is the list inside one), Bundle (a Bundle
ships plugins; a Build is what one artifact ended up with)

## The work

**Spec**:
A statement of intent whose acceptance criteria a machine can check. A
description with no machine-checkable criteria is not a Spec.
_Avoid_: Ticket, story, request

**Unit**:
Anything that takes a Spec and returns an Outcome. A model call, a workflow, an
agent, a harness, and a factory are all Units at different timescales.
_Avoid_: Worker (that is the machine), actor, executor

**Outcome**:
What a Unit returns: Done, Failed, NeedsHuman, or Exhausted. Escalation to a
human is an Outcome, not an error.

**Claim**:
An assertion of success by whatever did the work. A Claim is never Evidence,
whatever its source. A failed Claim carries an Error Class.

**Candidate**:
One answer a Step produced, before anything judged it. A Verdict is about
exactly one, and a repair loop counts Candidates rather than Provider Turns or
Messages.
_Avoid_: Output (that is what a Candidate becomes), result, Artifact (an
artifact is what a release ships), payload (that is the record's)

**Output**:
The value a Candidate became once it satisfied the JSON Schema its Step
declared. A Step that declared no JSON Schema has an Output too — the answer
text — and that is not Degraded, because nothing was missing.
_Avoid_: Result (a Claim is what a Run returns), Artifact, response, payload

**Budget**:
What a Run may spend: tokens, money, wall clock, and Steps. Exhausting it is an
Outcome, not an error, and the partial work is kept.
_Avoid_: Quota, limit, cap (those are one field of a Budget, not the whole)

**Cost**:
What a Provider says a request cost, in **Ticks** — integers of 1e-10 USD.
Absent means the Provider did not report one, which is not zero and is never a
number Eva computes from tokens times a rate. A Run that cannot report cost
says so in words.
_Avoid_: Price (that is the vendor's rate), Estimate (that is what the
counters come to at one), a float of dollars

**Price**:
What a vendor publishes for a model, in Ticks per million tokens. It lives in
the Catalog, which is rebuilt and not recorded, so a Price reaches an Estimate
and never a Cost.
_Avoid_: Cost, rate card, tariff

**Estimate**:
What a Run's counters come to at Catalog Prices. It is a projection, folded
from the Trace and never written to it, so it moves when a vendor reprices. It
is shown marked, because an Estimate read as a Cost is the mistake the pair
exists to prevent, and one record that cannot be priced leaves it absent.
_Avoid_: Cost, derived cost, approximate cost

**Hunk**:
One replacement inside one file: the text to find, and the text that takes its
place. A Hunk lands when its text appears exactly once in what the Hunks before
it produced; absent or repeated, it refuses the whole Preview.
_Avoid_: Patch (that is the whole set), chunk, block (a Block is the fold's)

**Preview**:
A resolved edit: the whole content an apply will write, and a fingerprint of the
content it was computed against. Every Hunk has already landed in it, so an
apply is one write and a file that moved underneath it is refused rather than
mangled.
_Avoid_: Dry run (that is the act that produces one), patch, plan

## Execution and continuity

Four systems Eva touches use `turn` for two different things, so Eva does not
use the bare word at all.

| System                | The whole prompt-to-stop arc | One model request and its tools |
| --------------------- | ---------------------------- | ------------------------------- |
| Agent Client Protocol | "prompt turn"                | not named                       |
| DeepSeek Harness      | **turn**                     | **step**                        |
| OpenCode              | Session Drain                | **Provider Turn**               |
| Eva's Go tree         | **Run**                      | **Turn**                        |

**Run**, **Step**, and **Provider Turn** below are the three unambiguous words
that replace it.

**Session**:
The durable, resumable transcript. It survives `kill -9`, and resume, branch,
and rewind all act on it.
_Avoid_: Conversation, thread, chat

**Header**:
What a Session says about itself: what to call it, and when it last moved. It
is a fold over the Trace, as every other projection is. A store may keep the
fold's answer beside the log so a listing is a read rather than a replay, and
then it records which fold rule wrote it — a cache that cannot say that is a
listing that goes quietly wrong the first time the rule moves.
_Avoid_: Metadata, summary, title (a title is one field of a Header)

**Run**:
One execution of a Unit against a Session, from the intent that opens it to the
Claim that closes it. A Session resumed twice has several Runs.
_Avoid_: Turn, invocation, execution, Session Drain (OpenCode's near-match —
theirs is process-local with no durable identity), prompt turn (the protocol's
word for it)

**Answer**:
What a Harness produced, as a fold over the Trace: the Claim the Run that
closed last carries, and that Run's text. A Workflow is many Runs, so the
earlier ones stay on the Trace and the Answer is the last one's. Nothing
stores one — it is read off the record, beside the Messages and the Cost, and
a caller that folds the Trace for itself is reading it a second way.
_Avoid_: Result (a Claim is what a Run returns), Output (that is what a
Candidate became), reply

**Provider Turn**:
One exchange with a Provider: a request starts, and a stream is read to its end.
It is not a unit of record.
_Avoid_: Turn unqualified, completion, round-trip

**Stop Reason**:
Why a Run ended: `end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, or
`cancelled`. A refusal is a legitimate outcome and a cap is a budget fact;
neither is a failure.
_Avoid_: Exit code, status, error (a Claim carries the failure question)

**Message**:
One entry in the transcript: who spoke, and the Blocks of what they said.
Nothing writes a Message; the Trace holds the records, and a fold gives the
Message back.
_Avoid_: Entry, line

**Block**:
One piece of what a Message says: words, reasoning, a tool call, the result
that answers a call, or a file the Run changed. The set is closed, as the Event
kinds are.
_Avoid_: Part, segment, content, chunk (a chunk is a piece of one Block
arriving)

## Evidence and observation

**Event**:
One typed, versioned, sequence-numbered record of something observable. There is
exactly one Event schema.
_Avoid_: Broadcast (that is the process-local notification, never recorded)

**Fold Keys**:
The envelope fields every projection groups by: Session, Run, and Parent.
Anything a projection needs to fold or filter lives on the envelope; anything it
only needs to display lives in the payload. A key nothing folds by is not a Fold
Key, and does not earn a place on every record.
_Avoid_: Metadata, headers

**Trace**:
The persisted Event stream of a Run, and the single source of truth. Every
projection is a fold over it, and anything a Trace cannot rebuild is a bug.
_Avoid_: Trajectory, log, history, audit trail

**Recorder**:
The one path an Event takes to the Trace. It stamps the envelope, commits a
group, and publishes what it committed. A Unit says what happened; it does not
decide how that is recorded. The one envelope field it does not stamp is the
trace position: the store allocates that inside the act that makes the group
durable, because a position handed out before the write is a position a second
writer can take.
_Avoid_: Logger, writer, emitter

**Degraded**:
A marker on a Run, an Event, or a field: this data is incomplete, estimated, or
unreported. Eva keeps Degraded data, marks it, and holds it out of eval scoring.
Eva never guesses a repair and never drops it in silence.

**Finding**:
Something a run did not read, as data rather than a line of text: a file a
grant would have opened, a key nothing declares, or a key written in a shape
nothing reads. A key under a plugin's own entry is swept the same way a
top-level one is, and names the plugin whose options it was written under. A
Finding is a Degraded outcome, so it is reported and never passed over in
silence.
_Avoid_: Warning, diagnostic, error (a Finding stops nothing)

**Error Class**:
Why an attempt failed, from a fixed set of eight: `rate_limit`, `overloaded`,
`auth_failed`, `unreachable`, `server_error`, `no_such_model`, `billing`, and
`other`. An absent class means nobody classified the failure, which is not the
same as `other`.
_Avoid_: Error code, error type, reason string

**Disposition**:
How a tool call ended: `ok`, `denied`, `failed`, `skipped`, `cancelled`,
`unknown_tool`, or `budget_denied`. Each one is data the model can recover from,
so a tool call always has a result.
_Avoid_: Error, success flag. Not Tool Status, which is a different thing.

**Tool Status**:
Where a tool call is in its life: `pending`, `in_progress`, `completed`, or
`failed`. ACP's own set, and it says whether a call is still running. A
Disposition says how one ended. A call has both, and neither replaces the other.
_Avoid_: Disposition, state

**Resolution**:
How a Question ended: `answered`, `rejected`, `expired`, or `cancelled`. A
`needs_human` record and the `resolved` record that answers it are a pair, so an
inbox is a fold over the Questions with no Resolution.
_Avoid_: Answer (that is what a Harness produced, and a Question's reply is
its content), reply, outcome

**Verdict**:
What came of judging one Candidate: `valid`, `invalid`, or `unchecked`.
`unchecked` is the caller's word for a Candidate nothing judged, because an
empty Slot answers nothing, and it is held out of every rate rather than counted
as either.
_Avoid_: Result, status, Claim (a Claim asserts success about work; a Verdict
judges form), Disposition (that is how a tool call ended)

**Fault**:
One thing a Candidate got wrong: where it is, as a JSON Pointer, and what the
JSON Schema wanted there. A Verdict of `invalid` carries every one the Validator
found, so the Repair that follows can be rebuilt from the Trace.
_Avoid_: Error (an Error Class is why an attempt failed to reach a Provider),
violation, issue, Finding (a Finding is config a run did not read)

**Repair**:
A second Step that asks for the same Candidate again with the Faults of the
first named. It follows an answer that arrived and did not conform, so it waits
for nothing and it is not a Retry.
_Avoid_: Retry, fix, correction, reattempt, Remediation (stage 5's, which cleans
an environment before another attempt)

**Retry**:
A refused Provider Turn that spent money and wall clock and produced nothing. It
is a record of its own. An answer that arrived and did not conform is a Repair,
not a Retry.
_Avoid_: Backoff (that is the arithmetic, not the attempt), reattempt

**Cursor**:
A position in an Event stream that a consumer committed durably. Only a durable
commit moves a Cursor.
_Avoid_: Offset, pointer, checkpoint

## The harness seam

**Harness**:
Something that fills the harness domain: it takes a Prompt and drives it to a
Stop Reason behind the Agent Client Protocol. Eva's native loop, Claude Code,
Codex, OpenCode, and DeepSeek Harness all are — and so is the stage 1 Workflow,
which has no agency at all. Every one is a plugin, and Eva's own holds no
privileged position.
_Avoid_: Orchestrator, engine, backend

**Workflow**:
A declared list of Steps, each one Instruction and one model request, where the
code owns the control flow and the model fills the slots. It has no agency:
nothing it does depends on what a model decided. It is a Unit and a Harness, and
running one is a Run.
_Avoid_: Pipeline (retired — a pipe is also what a shell does on the same
command line), DAG, chain, script, recipe

**Step**:
One model request plus the tool executions its response causes; a Run holds zero
or more. A Workflow's Step causes none, and a Repair is a Step. DeepSeek
Harness's word, and precise.
_Avoid_: Turn unqualified, stage, task, job

**Loop**:
Eva's own Harness, and the first one with agency: it proposes, acts, and
observes until the model asks for no more tools, a Budget runs out, or the
max-steps fuse trips. One Step is one Run, so the calls a response proposed
commit inside the Run that proposed them.
_Avoid_: Agent loop, ReAct, engine, REPL

**Tool**:
A named action a model may call: an id, a description, a JSON Schema for its
input, and the behaviour that runs it. It is a row in the tool domain, so what a
Session may call is what the domain holds at the moment of the call.
_Avoid_: Function, action, capability, Command (that is what a person types)

**Tool Execution**:
One tool call, from the name a model wrote to the three records it leaves: the
deciding boundary settles the arguments, the `tool_call` record opens, the row's
behaviour runs, and the closing pair reports the Disposition. The Execution owns
those records and the Tool does not, because a Hook at the closing boundary may
rewrite the result.
_Avoid_: Pipeline (retired, and it named a Workflow), Executor (a Unit already
refuses that word), dispatch

**Tool Group**:
The calls one Provider response proposed, run as one unit. It is split into
windows: a run of consecutive parallel-safe calls is one window under a bound,
and every other call is a Barrier. Results land in source order whichever call
answered first.
_Avoid_: Batch, wave, round, fan-out

**Barrier**:
A tool call that runs alone inside a Step: everything before it commits before
it starts, and nothing after it starts until it has committed. A call the
runtime has not classified parallel-safe is one, so unclassified fails closed.
_Avoid_: Lock, fence, serial call, Scheduler (a Scheduler admits work to
workers, which is a different thing)

**Steering**:
A line a person says while a Unit is working, delivered at the next structural
boundary. `next-step` is a boundary inside the Prompt that is running: the
response and its tool group are over, and the calls of the windows that never
opened are `skipped`. `next-run` is the whole arc's boundary, so it rides the
next Prompt. A Harness holds the inbox, because only it knows where its next
Step begins.
_Avoid_: Interrupt (that stops work in flight), injection, nudge, barge-in

**Agent half**:
The side of the protocol a Harness implements: create a session, prompt, cancel,
fork, resume, and report updates.

**Client half**:
The side of the protocol Eva implements for a Harness: permission decisions,
questions to the user, file reads and writes, and terminals. A Harness asks; it
does not help itself.
_Avoid_: Host interface, callbacks

**Client**:
The handle a Surface holds: the whole Session API, the Run protocol over it,
and the Client state it reads. The composition root builds one where it builds
the API and hands it on, so a Surface reaches a Session through the client
runtime and no other way. It is a handle, never a plugin — a Surface is what a
person drives; a Client is what a Surface calls through.
_Avoid_: Session client, connection, Surface (a Surface holds a Client)

**Transport**:
Where a contract is answered from: this process, or a wire. A Transport carries
the contract unchanged and decides nothing about the calls it makes. Two seams
have one. The harness seam reaches a Harness by direct calls or by the Agent
Client Protocol over stdio JSON-RPC. The client runtime reaches the Session API
through a Transport that also says whether the pipe is there, so the runtime
never learns which side of a socket it is on.
_Avoid_: Connection, channel, protocol (a protocol is what a Transport speaks)

**Transport health**:
The one fact the client runtime reads about its Transport: `ready` or
`disconnected`. It is about the pipe, never about the runtime — catching up
after a drop is the runtime's own phase and is not a health value.
_Avoid_: Online, connection state, status

**Client state**:
Where the client runtime is, in the three values a Surface acts on: `ready`,
`synchronizing`, `disconnected`. It is built above Transport health, which says
two — `synchronizing` is the runtime refolding after a drop, which the pipe
cannot know. A Surface shows it and decides nothing about it: recovery is the
runtime's, and saying why the words stopped moving is the Surface's.
_Avoid_: Connection state (that is the pipe's), sync status, loading

**Run signal**:
What one open Run says to its caller, on one queue: a payload of the live
stream, or the record that replaced it. A Surface reads both from one place, so
a repaint after a drop arrives in order with the words around it. Always
qualified, because the bare word is a stage 13 domain.
_Avoid_: Signal unqualified, Event (an Event is committed and numbered),
update, message

**Prompt**:
What a person asks Eva, and what a Harness is handed to answer it. It is the one
shape that crosses the harness seam.
_Avoid_: Turn, request, base system prompt

**Template**:
A named body of text with named holes, held as one row of the prompt domain.
Filling one produces an Instruction, and a Template may include another by name.
_Avoid_: Partial (retired — an included Template is still a Template), snippet,
fragment, prompt file, Schema (a Declaration already owns that _Avoid_ line)

**Variable**:
One named hole in a Template, and the text a caller binds to it. A hole nothing
binds is a Gap, and no Instruction is built.
_Avoid_: Placeholder, parameter, argument, Slot (a Slot is an extension point),
token

**Gap**:
A hole a Template could not fill: a Variable nothing bound, an id that names no
Template, or a Template that includes itself. It is data, and it stops the Run
before it spends.
_Avoid_: Error, warning, Finding (a Finding is config that reached nothing and
stops nothing; a Gap stops a Run), missing key

**Instruction**:
The text one Step sends to a model, produced by filling a Template. It is not a
Prompt: a Prompt is what a person asks Eva and the one shape that crosses the
harness seam, and a Step's Instruction crosses nothing.
_Avoid_: Prompt (that is the person's), rendered prompt, message, system prompt

**Validator**:
The Slot that judges whether one Candidate conforms to a JSON Schema, and names
every Fault it found. It judges form, never truth, and it never calls a model.
_Avoid_: Verifier (stage 5's, and it judges work rather than form), Check
(stage 5's), Schema (that is what it checks against, not what checks), parser,
linter

**Provider**:
A model behind one contract: a single method that begins a Provider Turn and
yields payloads of the one Event schema. It knows no Run and no Session.
_Avoid_: Backend, vendor, client

**Namespace**:
The name a Provider claims in the Catalog and in a model reference —
`anthropic`, `openai`. It is not the Provider's id: `eva.provider.openai` names
the plugin and appears in `ProviderError.provider` and in a Claim, while
`openai` appears in `ModelRef.provider`, in the `usage.model` prefix, in the
price lookup, and as the Credential id.
_Avoid_: Prefix, vendor, provider id (that is the other one)

**Catalog**:
The Domain that holds Providers, their models, and the default. Provider plugins
write to it; nothing owns it.
_Avoid_: Registry, model list

**Credential**:
What authenticates Eva to a Provider. Its mode is either an API key from the
environment or a subscription obtained by a Login. The configured mode alone
decides which a Provider Turn uses.
_Avoid_: Token, key, secret

## Permission and containment

**Mode**:
A named set of permissions a Session runs under: `read-only`, `supervised`,
`autonomous`, or `plan`. It selects which tools the tool domain holds and states
mandate at the deciding boundary, so a Mode narrows and never widens. A change
emits a `mode` payload, so which one is open is a fact on the Trace.
_Avoid_: Permission level, policy (a Rule Set is the policy), profile

**Approval**:
A person's answer to one permission request, in one of the Agent Client
Protocol's four options: `allow_once`, `allow_always`, `reject_once`,
`reject_always`. The request names the tool call by its id, and `allow_always`
writes an allow rule into the person's own config and never the repo's.
_Avoid_: Consent, confirmation, Prompt (that is what a person asks for)

**Rule Set**:
The rules under the `policy` config key that the deterministic gate judges a
call against: `allow`, `deny`, or `ask` over the words a command would run, a
position at a time. It is a CI artifact — `eva policy check` reads the file a
Run reads and refuses a malformed one.
_Avoid_: Policy file, permission list, ACL, allowlist

**Protected Path**:
A toolchain-bootstrap file a write is never auto-approved to touch: `.git`,
`.eva`, `.npmrc`, `.mcp.json`, CI config, dependency manifests, and shell rc.
The check runs before the rules and is un-overridable by ordering rather than
by a flag. A read of one is not checked, because the rule is about writes.
_Avoid_: Blocklist, denylist, sacred path

**Opaque Invocation**:
A shell line the gate cannot read as words, because it holds a redirection, a
substitution, a variable, a quotation, a glob, a subshell, a comment, or a
newline. It is matched against no rule and fails closed, which is what closes
`curl … | sh`.
_Avoid_: Unsafe command, unparseable command

**Sandbox**:
The Slot a command starts inside. Containment is how a process starts and not
what it returns, so a Sandbox answers the same live process a Shell does. It
states what it enforces, so a filler that contains nothing says so instead of
looking like one that does.
_Avoid_: Jail, container, Seatbelt (that is one filler of it)

**Sandbox Policy**:
What one command may reach while it runs: readable paths, writable paths, and
the network. It is the second thing in Eva the word _policy_ names, and the
only one: it is the term of art every containment tool uses, and a caller
states one where a Rule Set is never in the room. So it is always spelled in
full — the bare word `policy` is the Rule Set's config key, and a Mode's
`_Avoid_` line holds it there.
_Avoid_: Permissions, sandbox rules, Rule Set (that is what the gate judges a
call against)

## Interfaces

**Console**:
The interactive interface a person types into — the `eva.tui` surface ships one.
It is not a Session; it holds one while it runs. Two folds decide everything it
does: one says what the screen shows, the other says what the loop does next —
which Run is open, which lines wait behind it, and which close closes which Run.
The Surface performs what they decide and holds neither.
_Avoid_: REPL, chat

**Live area**:
The part of an interface that shows a Run as it happens, from the stream and not
from the Trace. When the Run closes, the fold over committed records replaces
it.
_Avoid_: Preview, buffer, transcript

**Command**:
A line a person types at a Console with a leading slash, resolved through the
command domain. Some answer from the Console alone (`/help`), some act on the
Session and record the fact (`/mode`), and some open a Run (`/deploy`). What
starts a process is a flag, not a Command.
_Avoid_: Builtin, directive, macro

**Binding**:
A key chord written as words joined by `+`, in one canonical spelling: the
modifiers in the order `ctrl`, `meta`, `shift`, then the key — and `enter`,
never `return`, and `plus`, never `+`, because the joiner cannot also be a key.
`canonical` in tui-core is the grammar's one home; a string it answers nothing
for names no key, and is said to the person rather than held.
_Avoid_: shortcut, hotkey, keybinding (one word hiding the row/spelling split)

**Note**:
A line a Surface said of its own — command output, a notice, a question Eva
asked. The record cannot rebuild one, so a Note never enters the fold, and it
lasts until the conversation moves on: a Run opens, or the Surface follows
another Session.
_Avoid_: Message (that is the transcript's), system message, log line

**Surface**:
A plugin that ships an interface a person or a program drives Eva through — the
terminal, `--print`, HTTP, the web page. It registers into the surface Domain,
calls the Session API through a Client for everything it shows, and implements
the Frontend contract for everything Eva asks of it. It holds no Session of its
own.
_Avoid_: Client (a Client is the handle a Surface holds), UI, app, Frontend (a
Frontend is the contract; the Surface is the plugin that implements it)

**Session API**:
What Eva exposes and a Surface calls: create, list, attach, watch, submit,
cancel, read and set the model, and answer a request. It is the whole of what a
Surface may do to Eva, and it is the same whether the caller is in this process
or across a socket.
_Avoid_: Control, RPC surface, service interface

**Frontend**:
The contract a Surface implements and Eva calls: the one path Eva uses when it
needs a person, and when the Surface has stopped. Eva reaches a Surface no
other way. What a Surface can do is not here — it is on the Surface's row.
_Avoid_: Callback interface, host interface, Surface (a Surface is the plugin;
the Frontend is the contract it implements)

**Local fact**:
Something a Frontend answers about its own machine — the editor, the working
directory, whether a remedy can run here. No Transport carries one.
_Avoid_: Client info, environment, metadata

**Location**:
A directory a Session belongs to, and the scope a request acts in. Eva holds
many and has no ambient one.
_Avoid_: Workspace (that is created, isolated, and snapshotted), project, folder

**World**:
Everything an app reads from outside itself: the arguments, the environment,
the working directory, and where its words go. One module builds it from the
process; every other module is handed one, so a test drives an app against a
scratch directory.
_Avoid_: Context (that is the plugin's), environment (that is one field),
Console (that is the interface a person types into)

## Deferred

These name machinery we have not built yet, with a guess at which stage brings
each one. Promote any of them the moment a real definition is worth writing —
the stage column is a hint about when that is likely, not a rule about when it
is allowed.

| Term                                                | Arrives at |
| --------------------------------------------------- | ---------- |
| Repomap, Compaction, System Context, Context Source | Stage 3    |
| Workspace, Snapshot, Isolation                      | Stage 4    |
| Verifier, Check, Evidence, Remediation              | Stage 5    |
| Memory, Playbook                                    | Stage 6    |
| Profile, Subagent, Branch, Rewind                   | Stage 7    |
| Suite, Score, Gate                                  | Stage 8    |
| Task, Job, Queue, Worker, Lease                     | Stage 9a   |
| Mandate, Tenant, Attestation                        | Stage 9b   |
| Adapter, Race, Conformance                          | Stage 9c   |
| Skill, MCP                                          | Stage 9d   |
| Merge queue, Review routing                         | Stage 10   |

Two of these are worth naming early, because a system Eva drives already has
them and we will want the same word:

- **System Context** and **Context Source** — OpenCode's vocabulary for what
  conditions a Provider Turn, and how one typed fact enters it.
- **Shadowing** — most-specific-wins name resolution, where a scoped
  contribution replaces its same-named global twin for one scope alone.

## Retired

**Turn** (unqualified): It means the whole arc in the Agent Client Protocol and
in DeepSeek Harness, and one provider exchange in OpenCode and in Eva's Go tree.
Use Run, Step, or Provider Turn.

**Orchestrator**: It named two things that already have names — the Harness,
which owns a tool-calling loop, and the Scheduler, which admits work to workers.

**Service key**: Replaced by Slot. A Slot is late-bound and replaceable; a
service key is fixed at build time.

**Phase**: Boot phases were removed. Dependencies decide load order.

**Pipeline**: It meant a Workflow, and it also names the shell idiom on the same
line as Stage 1's own demo (`git diff --staged | eva run commit-msg`). Two
meanings on one line is what `turn` was retired for. Use Workflow.

**Partial**: It named an included Template, which is a Template. One concept
gets one name. Use Template, and say "a Template another Template includes"
where the distinction matters.
