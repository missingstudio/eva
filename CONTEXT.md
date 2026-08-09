# Eva

Eva is an autonomous, multi-tenant, AI-native software factory. This glossary fixes the words the project uses for its own machinery, so that one concept has one name in the code, the traces, the dashboard, and the operator's mouth.

The operator-facing vocabulary stays deliberately small: **Spec**, **Run**, **Job**, **Worker**, **Mandate**. Everything else here is either a term agents and code need, or a word we have explicitly retired.

## Language

### The work

**Spec**:
A statement of intent whose acceptance criteria a machine can check. A description with no machine-checkable criteria is not a Spec.
_Avoid_: Ticket, story, request

**Unit**:
Anything that takes a Spec and returns an Outcome. A model call, a workflow, an agent, a harness, a factory, and a company are all Units at different timescales.
_Avoid_: Worker (that is the machine), actor, executor

**Job**:
One target of a Run. A Run over three repositories has three Jobs, each failing and retrying independently.
_Avoid_: Attempt, subtask

**Outcome**:
What a Unit returns: Done, Failed, NeedsHuman, or Exhausted. Escalation to a human is an Outcome, not an error.

**Mandate**:
A bounded, expiring grant of authority under which a Run acts, traceable to the human or legal entity that issued it.
_Avoid_: Permission, role, scope (those describe a Mandate's contents, not the grant)

### Execution and continuity

These three were previously used interchangeably. They are distinct.

**Session**:
The durable, resumable transcript. It is what survives `kill -9`, and what resume, branch, and rewind act on.
_Avoid_: Conversation, thread, chat

**Message**:
One entry in the transcript: who said it, and the Blocks of what they said. It is never written, only folded — the Trace holds the records and a Message is what they come back as.
_Avoid_: Turn (that is one exchange with a Provider), entry, line

**Block**:
One piece of what a Message says: words, a tool call, or the result that answers one. A Message is a list of these rather than a string because a turn that calls a tool says two things at once, and the answer has to arrive back paired with what it answers. The set is closed, for the reason the Event kinds are — a Block no Provider has heard of is a request none of them accepts.
_Avoid_: Part, segment, content, chunk (a chunk is a piece of one Block arriving)

**Run**:
One execution of a Unit against a Session. A Session that is resumed twice has one Session and multiple Runs. The Run a prompt opens is the answer's whole account: the intent rides on its opening record, the answer is its Text, and the claim closes it — "this Run answered that prompt" is a complete sentence, and there is no third name for the arc between them.
_Avoid_: Invocation, execution, turn (a turn is one exchange with a Provider, and one Run may hold many)

**Base system prompt**:
What every turn is conditioned on before the transcript. It is compiled into the build, held to a byte budget that CI enforces, and it is not part of the Session — a fold over a Trace gives back what was said, not what the binary said first.
_Avoid_: Preamble, persona, instructions

**Task**:
Retired. A Spec plus its Jobs says the same thing with terms that already exist.

**Worker**:
A machine holding a daemon that pulls work. It advertises capabilities; the control plane decides what it may do.
_Avoid_: Runner, node, agent (an agent is a Unit, not a machine)

**Lease**:
A time-bounded assignment of a Job to a Worker, with a deadline. Implementation detail below the operator vocabulary.

### Evidence and observation

**Event**:
One typed, versioned, sequence-numbered record of something observable. There is exactly one Event schema, and every observable thing is an instance of it.

**Trace**:
The persisted Event stream of a Run. The single source of truth — every projection is a fold over it, and anything a Trace cannot reconstruct is a second source of truth and a bug.
_Avoid_: Trajectory, log, history, audit trail

**Recorder**:
The one path an Event takes to the Trace. It stamps the envelope, commits a group, and publishes what was committed. A Unit says what happened; it does not decide how that is recorded, which is what stops a Unit recording one thing and reporting another.
_Avoid_: Logger, writer, emitter (an emitter stamps, and stamping alone is not recording)

**Subscriber**:
A consumer of committed Events. It sees a record after the Trace holds it, never before, so what a Subscriber shows is the Trace rather than a claim about it. Every projection is one — the transcript, the console, the dashboard.

**Console**:
The interactive interface a person types into. It is not a Session: a Session is the transcript, and one console holds one while it runs. It shows a turn twice — arriving, in the live area, and then as the fold over what was committed.
_Avoid_: REPL (read-eval-print names a loop over expressions, and this is a conversation over turns), chat (retired above, for the Session)

**Live area**:
The part of an interface that shows a turn while it is still happening, from the stream rather than from the Trace. It is erased when the Run closes and replaced by the fold over what was committed, so nothing a person keeps came from anywhere but the record.
_Avoid_: Preview, buffer, transcript (a transcript is the Session, and it is a fold)

**Command**:
A line a person types at a Console that the Console answers itself, written with a leading slash. It opens no Run, reaches no Provider, and leaves no record — it steers the Session rather than adding to it. What a process is started with is a flag, not a Command.
_Avoid_: Builtin, directive, macro

**Evidence**:
The output of a Verifier run against a Spec's acceptance criteria. Distinct from a Claim.

**Claim**:
An assertion of success by whatever did the work. A Claim is never Evidence, however trustworthy its source. A Claim of failure also carries an Error Class.

**Error Class**:
Why an attempt failed, from a fixed set — a rejected credential, a provider that could not be reached, a rate limit, an overloaded or failing provider, a model the provider does not serve, a turn it will not bill, or a failure something looked at and could not place. It rides on a Retry and on the Claim a failed Run closes with, so a reader tells two failures apart without reading the prose beside them. Absent means nobody classified the failure, which is not the same as placing it in "other". Two classes that decide the same thing about retrying are still two classes when they decide different things about what a person does next.
_Avoid_: Error code, error type, reason string

**Verifier**:
The thing that turns acceptance criteria into Evidence. Every timescale needs its own; passing unit tests do not sum into a healthy company.
_Avoid_: Oracle (used informally in prose, never as a type), validator, checker

**Degraded**:
A marker on a Run, an Event, or a field meaning "this data is incomplete, estimated, or unreported". Degraded data is kept, marked, and excluded from eval scoring — never repaired by guessing and never silently dropped.

**Disposition**:
How a tool call ended: ok, denied, failed, skipped, cancelled, unknown tool, or budget denied. Every one of them is data the model can recover from, so a tool call always has a result.
_Avoid_: Status, error, success flag

**Cursor**:
A position in an Event stream that a consumer has durably committed. A reconnecting peer resumes from its last cursor and the peer replays what follows. Only a durable commit advances a Cursor.
_Avoid_: Offset, pointer, checkpoint (a checkpoint is a Session state, not a stream position)

**Retry**:
An attempt that spent money and wall clock and produced nothing. It is a record rather than a detail of one, because the cost of retrying is otherwise invisible — and the rule that decides how long to wait before the next one is one rule, shared by every Provider that answers over a network.
_Avoid_: Backoff (that is the arithmetic, not the attempt), reattempt

### Answering a turn

**Loop**:
The Unit that answers a prompt: it assembles one call out of what it was handed, replays what the Provider yields into the Trace, and closes the Run with the claim of how it went. It runs one turn today and decides nothing between turns; what it grows into is the cycle that proposes, acts, and observes, with the tool dispatch and the gates that go with it. It is named for what it becomes rather than for what it does, because the rename and the move out of the frontend are one act and the type was constructed in one place.
_Avoid_: Agent (an agent is a Unit at a longer timescale), executor, runner, Driver (that is one Provider's half of one turn, a layer below)

**Turn**:
One exchange with a Provider: a request begun, a stream read to its end. It is the providers' word — a Provider begins one, a Wire carries one attempt at one, a Driver pulls one — and it is not a unit of record: what the Trace holds is a Run, and one Run holds many turns the day there are tools to call between them. What answers a prompt is the Run, not the turn the answer arrived on.
_Avoid_: Turn as the prompt-to-answer arc (retired: that arc is a Run, and one concept gets one name), completion, round-trip

**Provider**:
A model behind one contract: one method, which begins a turn and yields payloads of the one Event schema. It knows what happened and not what becomes of it — no Run, no Session, no tenant — so it states each thing where it noticed it and states it once. What selects a Provider is its registry key, which is the only place its name lives.
_Avoid_: Backend, vendor, client (a client is what a Provider holds, not what it is)

**Wire**:
One Provider's own half of a turn: how to make a single attempt, how to read a single frame, how to let go. It is everything that genuinely differs between two Providers — a vendor's SDK against a hand-rolled POST, a typed error document against a status line.
_Avoid_: Transport (that is one Provider's choice of host and headers, a level below), connection

**Driver**:
The state machine every turn runs through, whatever wire carries it: the queue a caller pulls from, the retry that is a record before it is a wait, and the books that close once. Written per Provider it was the same two hundred lines twice.
_Avoid_: Loop (a caller pulls, so nothing here loops on its own), pump, engine

**Transport**:
One Provider's way of reaching its own API — a host, the headers beyond the credential, and what a turn must carry to be accepted there. One Provider can have two: an API key against a public API, a subscription against the vendor's own backend, identical past the dial.

### Credentials

**Credential**:
What authenticates Eva to a Provider. It has a mode — an API key read from the environment, or a subscription obtained by a Login — and the configured mode alone decides which one a turn uses.
_Avoid_: Token, key, secret (those are shapes a Credential takes, not the concept)

**Login**:
The act of obtaining a subscription Credential, and the CLI verb that performs it. A Login reaches the network and waits on a person, which is everything a Command must not do — so it is a word beside init, never a slash.
_Avoid_: Sign-in, connect, authenticate (a turn authenticates; a person logs in)

**Auth store**:
The one file subscription Credentials live in, beside the configuration and private to the user. A Login writes it, a turn's credential resolver reads and renews it, and nothing prints what it holds.
_Avoid_: Keychain, credential cache, token file

### Capability and extension

**Harness**:
Something that owns a tool-calling loop and can be driven behind one adapter contract. Eva is a Harness; so are Claude Code and Codex.

**Profile**:
A named bundle of model, harness, tools, policy, budget, memory, verifier, and environment.

**Workflow**:
A captured procedure that code executes. The sequence is fixed and the model fills the slots. Compiled.

**Skill**:
A captured procedure that the model executes, loaded into context as instructions and resources. Interpreted.

**Hook**:
A subscription to a lifecycle point on the Event stream. A Hook may narrow what a Run may do; it can never widen it.

**Kernel**:
The part of Eva that is never pluggable: the Event schema, the trace store, spec and budget and mandate enforcement, the verifier contract, tenancy, scheduling, and merge authority.
