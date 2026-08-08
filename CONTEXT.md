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

**Run**:
One execution of a Unit against a Session. A Session that is resumed twice has one Session and multiple Runs.
_Avoid_: Invocation, execution, turn

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
A consumer of committed Events. It sees a record after the Trace holds it, never before, so what a Subscriber shows is the Trace rather than a claim about it. Every projection is one — the transcript, the machine-readable stream, the dashboard.

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
An assertion of success by whatever did the work. A Claim is never Evidence, however trustworthy its source.

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
