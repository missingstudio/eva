# Eva

Eva is an autonomous, multi-tenant, AI-native software factory. This glossary fixes the words the project uses for its own machinery. One concept gets one name, in the code, the traces, the dashboard, and the operator's mouth.

The operator-facing vocabulary stays deliberately small: **Spec**, **Run**, **Job**, **Worker**, **Mandate**. Every other word here is either a term the code and the agents need, or a word this project has retired.

## How to read this

Entries are written in **ASD-STE100 Simplified Technical English**, under four rules:

- **One definition, at most three sentences.** Define what the term *is*, never what it does.
- **No sentence over 25 words.** One topic per sentence, active voice, present tense.
- **The terms themselves are Technical Names**, which STE exempts from its approved-word list. `Trace`, `Fold`, `Wire`, and `Run` stay as they are, because the code, the traces, and the ADRs share them.
- **Rationale lives in `docs/adr/`, not here.** An entry that needed a *why* carries a `_See_` line instead.

`_Avoid_` names the words this project rejected for that concept. Using one in code, a comment, or a commit message is a defect.

## Language

### The work

**Spec**:
A statement of intent whose acceptance criteria a machine can check. A description with no machine-checkable criteria is not a Spec.
_Avoid_: Ticket, story, request

**Unit**:
Anything that takes a Spec and returns an Outcome. A model call, a workflow, an agent, a harness, a factory, and a company are all Units at different timescales.
_Avoid_: Worker (that is the machine), actor, executor

**Job**:
One target of a Run. A Run over three repositories has three Jobs, and each Job fails and retries on its own.
_Avoid_: Attempt, subtask

**Outcome**:
What a Unit returns: Done, Failed, NeedsHuman, or Exhausted. Escalation to a human is an Outcome, not an error.

**Mandate**:
A bounded grant of authority that expires. A Run acts under one, and the Mandate names the human or legal entity that issued it.
_Avoid_: Permission, role, scope (those describe a Mandate's contents, not the grant)

### Execution and continuity

Three terms that were once used interchangeably. They are distinct.

**Session**:
The durable, resumable transcript. It survives `kill -9`, and resume, branch, and rewind all act on it.
_Avoid_: Conversation, thread, chat

**Message**:
One entry in the transcript: who spoke, and the Blocks of what they said. Nothing writes a Message; the Trace holds the records, and a fold gives the Message back.
_Avoid_: Turn (that is one exchange with a Provider), entry, line

**Block**:
One piece of what a Message says: words, a tool call, or the result that answers a call. The set is closed, as the Event kinds are.
_Avoid_: Part, segment, content, chunk (a chunk is a piece of one Block arriving)
_See_: [0039](docs/adr/0039-a-transcript-entry-is-blocks-so-a-tool-exchange-can-be-rebuilt.md)

**Run**:
One execution of a Unit against a Session; a Session resumed twice has several Runs. A Run is the whole account of one answer: the intent opens it, the Text is the answer, and the Claim closes it.
_Avoid_: Invocation, execution, turn (a turn is one exchange with a Provider, and one Run may hold many)

**Base system prompt**:
What conditions every turn, ahead of the transcript. It is compiled into the binary, held to a byte budget, and it is not part of the Session.
_Avoid_: Preamble, persona, instructions
_See_: [0020](docs/adr/0020-the-base-system-prompt-is-compiled-in-and-its-size-is-a-gate.md)

**Task**:
Retired. A Spec plus its Jobs says the same thing with terms that already exist.

**Worker**:
A machine that runs a daemon and pulls work. It advertises its capabilities, and the control plane decides what it may do.
_Avoid_: Runner, node, agent (an agent is a Unit, not a machine)

**Lease**:
A time-bounded assignment of a Job to a Worker. It carries a deadline, and it sits below the operator vocabulary.

### Evidence and observation

**Event**:
One typed, versioned, sequence-numbered record of something observable. There is exactly one Event schema, and every observable thing is an instance of it.

**Trace**:
The persisted Event stream of a Run, and the single source of truth. Every projection is a fold over it, and anything a Trace cannot rebuild is a bug.
_Avoid_: Trajectory, log, history, audit trail

**Recorder**:
The one path an Event takes to the Trace. It stamps the envelope, commits a group, and publishes what it committed. A Unit says what happened; it does not decide how that is recorded.
_Avoid_: Logger, writer, emitter (an emitter stamps, and stamping alone is not recording)
_See_: [0011](docs/adr/0011-one-recorder-is-the-only-path-to-the-trace.md)

**Subscriber**:
A consumer of committed Events. It sees a record only after the Trace holds it, so it shows the Trace and never a claim about it. Every projection is one: the transcript, the console, the dashboard.

**Console**:
The interactive interface a person types into. It is not a Session; it holds one while it runs. It shows a turn twice: first in the Live area, then as the fold over what was committed.
_Avoid_: REPL (read-eval-print names a loop over expressions, and this is a conversation over turns), chat (retired above, for the Session)

**Live area**:
The part of an interface that shows a turn as it happens, from the stream and not from the Trace. When the Run closes, the fold over the committed records replaces it.
_Avoid_: Preview, buffer, transcript (a transcript is the Session, and it is a fold)

**Command**:
A line a person types at a Console, written with a leading slash, that the Console answers itself. It opens no Run, reaches no Provider, and leaves no record. What starts a process is a flag, not a Command.
_Avoid_: Builtin, directive, macro

**Evidence**:
The output of a Verifier run against a Spec's acceptance criteria. It is distinct from a Claim.

**Claim**:
An assertion of success by whatever did the work. A Claim is never Evidence, whatever its source. A failed Claim also carries an Error Class.

**Error Class**:
Why an attempt failed, from a fixed set of eight: `rate_limit`, `overloaded`, `auth_failed`, `unreachable`, `server_error`, `no_such_model`, `billing`, and `other`. It rides on a Retry and on the Claim that closes a failed Run. A reader then tells two failures apart without the prose beside them. An absent class means nobody classified the failure, which is not the same as `other`.
_Avoid_: Error code, error type, reason string
_See_: [0038](docs/adr/0038-a-failed-claim-carries-a-class-and-a-projection-spends-the-class.md), [0041](docs/adr/0041-a-remedy-is-checked-and-the-layer-that-can-check-it-is-not-the-layer-that-says-it.md)

**Verifier**:
What turns acceptance criteria into Evidence. Every timescale needs its own, because unit tests that pass do not sum into a healthy company.
_Avoid_: Oracle (used informally in prose, never as a type), validator, checker

**Degraded**:
A marker on a Run, an Event, or a field: this data is incomplete, estimated, or unreported. Eva keeps Degraded data, marks it, and holds it out of eval scoring. Eva never guesses a repair, and never drops it in silence.

**Disposition**:
How a tool call ended: `ok`, `denied`, `failed`, `skipped`, `cancelled`, `unknown_tool`, or `budget_denied`. Each one is data the model can recover from, so a tool call always has a result.
_Avoid_: Status, error, success flag

**Cursor**:
A position in an Event stream that a consumer committed durably. A peer that reconnects resumes from its last Cursor, and the other peer replays what follows. Only a durable commit moves a Cursor.
_Avoid_: Offset, pointer, checkpoint (a checkpoint is a Session state, not a stream position)

**Retry**:
An attempt that spent money and wall clock and produced nothing. It is a record of its own, and one shared rule decides how long to wait before the next attempt.
_Avoid_: Backoff (that is the arithmetic, not the attempt), reattempt
_See_: [0012](docs/adr/0012-retries-are-payloads-so-every-attempt-is-a-record.md)

### Answering a turn

**Loop**:
The Unit that answers a prompt, and Eva's own entry in the Harness registry. It holds what a build gave it, is handed one Prompt, assembles one call, replays what the Provider yields into the Trace, and closes the Run with a Claim. It runs one turn today and decides nothing between turns; it grows into the cycle that proposes, acts, and observes.
_Avoid_: Agent (an agent is a Unit at a longer timescale), executor, runner, Driver (that is one Provider's half of one turn, a layer below)
_See_: [0037](docs/adr/0037-a-prompt-is-answered-by-a-run-and-a-turn-is-one-provider-exchange.md)

**Prompt**:
What a person asks Eva, and what a Harness is handed to answer it: the ask itself and the Run that is already open to answer it in. It is the one shape that crosses the Harness seam, so the layer that opens a Run and the layer that answers in it describe the work the same way.
_Avoid_: Turn (that is one exchange with a Provider, and answering one Prompt holds as many as there are tools to call), request, job (a Job is one target of a Run), Base system prompt (that conditions every turn and is not what anybody asked)
_See_: [0062](docs/adr/0062-a-harness-holds-what-a-build-gives-it-and-is-handed-the-prompt-to-answer.md)

**Turn**:
One exchange with a Provider: a request starts, and a stream is read to its end. It is the providers' word, and it is not a unit of record. The Trace holds Runs, and one Run holds many turns once there are tools to call between them.
_Avoid_: Turn as the prompt-to-answer arc (retired: that arc is a Run, and one concept gets one name), completion, round-trip

**Provider**:
A model behind one contract: a single method that begins a turn and yields payloads of the one Event schema. It knows no Run, no Session, and no tenant, so it states each thing once, where it noticed it. Its registry key selects it, and that key is the only place its name lives.
_Avoid_: Backend, vendor, client (a client is what a Provider holds, not what it is)

**Wire**:
One Provider's own half of a turn: how to make one attempt, how to read one frame, how to let go. It is everything that genuinely differs between two Providers, such as a vendor's SDK against a hand-rolled POST.
_Avoid_: Transport (that is one Provider's choice of host and headers, a level below), connection

**Driver**:
The state machine every turn runs through, whatever Wire carries it. It holds the queue a caller pulls from, the Retry that is a record before it is a wait, and the books that close once.
_Avoid_: Loop (a caller pulls, so nothing here loops on its own), pump, engine
_See_: [0034](docs/adr/0034-one-driver-pulls-a-turn-and-a-provider-is-a-wire.md)

**Transport**:
One way of reaching an API. It carries the calls and decides nothing about them, so two Transports for one API are identical past the dial. A Provider's Transport is a host and the headers beyond the Credential. The Session API's two are the Direct and the Remote.
_Avoid_: Connection, channel, protocol (a protocol is what a Transport speaks, not the reaching)
_See_: [0047](docs/adr/0047-one-api-and-two-transports-carry-it.md)

### Credentials

**Credential**:
What authenticates Eva to a Provider. Its mode is either an API key read from the environment, or a subscription obtained by a Login. The configured mode alone decides which one a turn uses.
_Avoid_: Token, key, secret (those are shapes a Credential takes, not the concept)
_See_: [0031](docs/adr/0031-a-credential-has-a-mode-and-the-mode-alone-decides.md)

**Login**:
The act that gets a subscription Credential, and the CLI verb that performs it. A Login reaches the network and waits on a person, which is what a Command must never do. So it is a word beside `init`, never a slash.
_Avoid_: Sign-in, connect, authenticate (a turn authenticates; a person logs in)
_See_: [0032](docs/adr/0032-a-login-is-a-cli-verb-and-its-credential-lives-in-one-auth-store.md)

**Auth store**:
The one file subscription Credentials live in, beside the configuration and private to the user. A Login writes it, a turn's credential resolver reads and renews it, and nothing prints what it holds.
_Avoid_: Keychain, credential cache, token file

### The service and its interfaces

**Session API**:
What a client drives: answer a prompt, watch what happens, read the model, set the model, and clear the transcript. Five methods, and a Transport carries them unchanged.
_Avoid_: Control (retired for this: the console's old interface held local facts too), RPC surface, service interface
_See_: [0048](docs/adr/0048-the-session-api-crosses-the-wire-and-local-facts-do-not.md)

**Local fact**:
Something a Frontend answers about its own machine. The editor, the build and directory, and the Remedy checked after a turn failed. No Transport carries one.
_Avoid_: Client info, environment, metadata

**Direct Transport**:
The Session API called in the same process. It opens no socket and starts no child, which is what lets one turn on a command line cost nothing to serve. The Assembly answers it, so nothing stands between the two.
_See_: [0061](docs/adr/0061-the-assembly-is-the-session-api-in-this-process.md)

**Remote Transport**:
The Session API spoken over the wire to a Server. It is the public surface, and it is the only promise Eva makes to code it did not write.

**Frontend**:
Anything a person or a script drives Eva through: the Console, the desktop application, the phone, the browser, a script. Every Frontend is a Subscriber and holds no Session of its own.
_Avoid_: Client (a client is what speaks a Transport, and a Frontend is what a person uses), UI, app

**Server**:
The process that holds Sessions and answers the Session API over the wire. It holds no ambient directory; a Session carries its own.
_Avoid_: Backend, host, instance

**Service**:
The Server run in the background, kept across a Frontend leaving. What manages it starts, restarts, stops, and reports on the same Server rather than implementing a second one.
_Avoid_: Daemon (a daemon pulls work from a control plane; a Service answers Frontends)

**Pairing token**:
A short-lived, single-use grant that a client exchanges for a Credential of its own. It is printed, because being read is its whole purpose, and it is worthless once used or expired.
_Avoid_: Password, server key, secret (the Credential it buys is those things, and nothing prints one)
_See_: [0051](docs/adr/0051-a-pairing-token-is-printed-and-the-credential-it-buys-is-not.md)

**Location**:
A directory a Session belongs to, and the scope a request acts in. A Server holds many and has no ambient one, so a request that lists anything names the Location it means.
_Avoid_: Workspace (that is created, isolated, and snapshotted; a Location is only where, and a Workspace is what one resolves to), project, folder
_See_: [0056](docs/adr/0056-a-question-belongs-to-a-session-and-the-inbox-is-a-fold-over-a-location.md)

**Registration**:
What a Service writes about itself so a client can find it: the address it answers on, its process, and its service version. A client reads one rather than being told an address.
_Avoid_: Lock file (a lock says something runs; a Registration says how to reach it), discovery record, pid file
_See_: [0060](docs/adr/0060-the-service-registers-itself-and-a-client-never-stops-a-stranger.md)

**Service version**:
The version of the wire surface, separate from the Event schema's. It travels in the health response, and a client speaks one major. It never appears inside a record, and the schema version never gates a method.
_Avoid_: API version, protocol version (a protocol is what a Transport speaks), build version
_See_: [0050](docs/adr/0050-the-go-schema-is-canonical-and-the-wire-schema-is-generated-from-it.md), [0057](docs/adr/0057-the-service-version-travels-on-the-wire-and-a-busy-service-is-not-replaced.md)

### Escalation

**Question**:
What a Run asks a human when it cannot proceed alone. It is a record, and a Run blocked on one is blocked by design rather than stalled.
_Avoid_: Prompt (that is what a person asks Eva), elicitation, ask

**Resolution**:
How a Question ended, from a closed set of four: `answered`, `rejected`, `expired`, and `cancelled`. A rejection is a person declining to answer, which is data rather than an error.
_Avoid_: Disposition (that is how a tool call ended, and half its values cannot happen to a Question), status, reply
_See_: [0055](docs/adr/0055-an-answer-is-a-record-and-a-rejection-is-one-of-its-resolutions.md)

**Inbox**:
The pending Questions across every Session in a Location. It is a fold over Traces, never a table, so it cannot disagree with the record.
_Avoid_: Queue (a queue holds work; this holds questions), attention list, escalation store

### Capability and extension

**Harness**:
Something that owns a tool-calling loop and can be driven behind one adapter contract. Eva is a Harness; so are Claude Code and Codex. A registry selects one by name, and Eva is the configured default.
_Avoid_: Orchestrator (retired: it named three things that already have names), engine, backend
_See_: [0045](docs/adr/0045-the-harness-is-a-layer-and-eva-is-one-entry-in-its-registry.md)

**Assembly**:
Everything one Session's turns are answered with: the Harness that answers, the Provider it reaches, the sink every Event lands in, and the Session all of it folds into. It opens one Run per prompt and guarantees that Run closes, and it is the Session API in the process it runs in.
_Avoid_: Driver (that is one Provider's half of one turn, a layer below), runtime, context

**Profile**:
A named bundle of model, harness, tools, policy, budget, memory, verifier, and environment.

**Workflow**:
A captured procedure that code executes. The sequence is fixed and the model fills the slots. Compiled.

**Skill**:
A captured procedure that the model executes, loaded into context as instructions and resources. Interpreted.

**Hook**:
A subscription to a lifecycle point on the Event stream. A Hook may narrow what a Run may do; it can never widen it.

**Kernel**:
The part of Eva that is never pluggable. It holds the Event schema, the trace store, the Verifier contract, tenancy, scheduling, and merge authority. It also enforces Spec, budget, and Mandate.
