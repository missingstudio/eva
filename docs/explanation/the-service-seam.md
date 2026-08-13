# The service seam

Eva has one interface today and will have five. A console, a desktop application, a
phone, a browser, and a script all have to drive the same work. This document is the
argument for where the seam between them goes, and what each side of it owns.

It decides nothing about the build order. Every stage in [the roadmap](../roadmap.md)
keeps its number and its exit test. What this document fixes is the *shape* those
stages land into, so that no stage has to move a boundary a later stage depends on.

Read [the ladder](the-ladder.md) for why the rungs exist, [the
primitive](the-primitive.md) for the one type, and
[reference/architecture.md](../reference/architecture.md) for the target. This document
holds the part none of them state: the path from the tree that exists to the tree they
describe, and where an interface attaches.

## The thesis

**Eva is a service, and every interface is a client of it.** The console is a client.
The browser is a client. A script is a client. The managed Console is the same service
under someone else's uptime.

One sentence follows, and most of this document is its consequences: *the seam is the
wire, and the wire is the only promise Eva makes to code it did not write.*

## What is settled, and what is reserved

Two kinds of statement appear below, and confusing them is expensive.

A **settled** decision has an ADR and binds the next commit. A **reserved** decision
names a seam, a directory, or an interface, and builds none of it. Reserving costs a
paragraph. It buys the one thing a retrofit cannot: the boundary is in the right place
before the code arrives on both sides of it.

The rule that governs which is which is already written. [The ladder](the-ladder.md)'s
rule 4 forbids building adapters before stage 8, because the adapter interface is
discovered rather than designed. That rule forbids building. It does not forbid
knowing where the thing will sit.

## The Harness is a layer, and answering a prompt is not a feature

`internal/cli` held three jobs. It parsed a command line, it owned the process, and it
assembled a Session with a Provider and a sink. The third job is not the frontend's. It
is Eva's own Harness, and it sat behind a flag parser.

So `internal/harness` is a layer. It holds the `Harness` contract, the registry that
selects one, and the assembly that opens a Run on a Session and commits what the Harness
emits. `internal/harness/eva` holds Eva's own implementation, which was `internal/loop`.
`internal/cli` keeps the command line, the process, the exit codes, and the wiring — and
nothing else.

The layer graph in [reference/architecture.md](../reference/architecture.md) already
says this. It puts `resume` and `branch` inside `harness/`, and both act on a Session.
The note beside `cli/` in that tree is an instruction: *narrow it when harness lands*.
This is that.

**Selection is a registry with one entry.** `harness.Open` reads a registry, exactly as
`providers.Open` does, and configuration names the default. Eva is that default and
today it is the only name. A second name arrives at stage 9c and changes one line of
configuration. The registry is what makes the difference between adding a Harness and
editing the layer that wires a Run.

**The word "orchestrator" is retired before it reaches code.** It reads as one thing
and denotes three: the adapter that normalizes a foreign Harness, the Scheduler that
picks one, and the assembly that runs it. All three already have names.

## The wire is the public surface

Eva will expose its Harness to code it did not write. There are three ways to make
that promise, and they cost differently.

| Promise             | Shape                                     | Cost                                                      |
| ------------------- | ----------------------------------------- | --------------------------------------------------------- |
| A Go import surface | `import ".../pkg/harness"`                | A version promise on Go types, which nothing can migrate  |
| A wire surface      | An interface a client speaks over HTTP    | A protocol version, which readers migrate on read         |
| A process surface   | Run `eva`, read the Trace                 | Almost nothing; the CLI and the Trace are already the API |

Eva promises the wire. Nothing is promoted out of `internal/`.

The reason is that a version number already exists where the promise belongs. The
Event schema is versioned, and a reader migrates an old record rather than rejecting
it. Go types have no such mechanism, and a semantic-version promise on `core.Session`
would freeze the domain against every later stage.

The process surface comes free and stays supported. `eva -p` answers one turn onto
stdout, and the Trace is the machine-readable record.

### A second protocol is reserved and not built

Editors speak their own protocol to an agent. One such protocol has momentum, and a
shipped tool serves it beside its own interface — so an editor drives that agent without
knowing anything about its native surface.

That is the mirror of a Harness adapter. An adapter lets Eva drive somebody else's agent.
This lets somebody else's editor drive Eva.

It is reserved and not built, for the reason rule 3 gives: a published contract to other
people's code is the expensive kind of shallow, and this would be a *second* wire contract
beside the one above. It also belongs to the same family as the adapters, which land at
stage 9c. So the seam is named here and the work waits until the extension host at stage
6.5 has exercised the first contract.

The shape it takes when it lands: another surface over the same Session API, in the same
layer that serves the wire, translating a foreign vocabulary inward. It is never a second
path to a Run.

## One API, two transports

A frontend holds one API. Two transports carry it.

The **direct** transport is a function call in the same process. The **remote**
transport speaks HTTP to a server. The API, the types, the errors, and the semantics
are identical. Only the distance changes.

Neither is an object that adapts something else to the API. In this process the
assembly *answers* the API — the five methods are its own, contexts and errors
included, because a shape that changed with the distance would be the second code path
this section exists to prevent. The server's half serves the interface rather than an
assembly, so what holds Sessions on the far side is the server's business
([0061](../adr/0061-the-assembly-is-the-session-api-in-this-process.md)).

Both are built, and neither is served. What turns the remote transport's handler into a
Server a person can reach — a listener, a Credential, and the Registration a client finds
it by — is the row below, and the falsifier suite is what drives the remote one today.

This is the literal reading of [the ladder](the-ladder.md)'s rule 8: *keep local and
remote on one code path*. The alternative — a console that wires a Session itself and a
server that does it again — leaves half the system untested until the day a person
needs it.

**Falsifier.** The day the direct transport has a behaviour the remote transport lacks,
this design has quietly become two code paths, and the answer is to delete the direct
transport and make every client remote. That falsifier is worth a test rather than a
sentence: one suite runs against both transports and asserts the same outcomes. It is
written, and it names each place the two genuinely cannot agree rather than leaving one
unasserted. There are two. A client that cancelled its own request cannot also be handed
the reply, so what the two agree on there is the record. And an error's identity does not
survive a wire while its account of itself does, so the remote transport hands back the
far side's words — which is asserted as the difference it is, not smoothed over.

The payoff is what makes the process model below affordable. "Serve" and "listen on a
socket" stop being the same word. `eva -p` builds the service in its own process and
calls it. No socket, no child process, no startup cost, and the same code.

## What crosses the wire, and what cannot

`tui.Control` was the interface the console needed, defined where it was needed. It had
eight methods, and three of them cannot cross a wire. It has since split, and what
follows is the argument that decided where.

- `Editor` returns a program to start. A program starts on the machine a person sits at.
- `About` reports the build, the branch, and the directory. Over a wire, whose?
- `Remedy` reports what was checked about this machine after a turn failed.

So the interface splits along the line the wire draws.

**The session API** is what a client drives: answer a prompt, watch what happens, read
and set the model, and clear the transcript. Five methods. This is what the remote
transport carries and what the server implements.

**Local facts** are what a frontend asks of its own process: the editor, the build, and
the remedy. Three methods, and no transport carries them. A remote console reports its
own machine, which is the true answer rather than a convenient one.

The split also repairs a rule this repository already holds. An interface past four
methods is usually two interfaces, and this one was eight.

## The record and the live area, on a wire

A turn is shown twice. The Live area shows it arriving, from the stream. The transcript
shows it afterwards, as a fold over what was committed. Only the record is kept.

In one process this is two paths: a chunk goes to whoever is watching, and a committed
group goes to the Recorder. Over a wire a client needs both, and it has to know which
one it holds.

So one stream carries both, and each Event says which it is. An Event that was
committed carries its durable position. An Event that was not carries none. The rule a
client then holds is the rule the Cursor already states: **only a durable Event moves a
Cursor.**

This is why a client resumes by Trace position rather than by wire position. A Worker
that reconnects is replaying a connection, so it resumes by `WireSeq`. A frontend is
folding a Session, so it resumes by `Seq`. The two sequences were separated for this
reason, and this is the first place the separation pays.

A dropped connection is therefore a reconnection and nothing else. Everything committed
is on disk, and an interrupted Run closes. A client reattaches with its Cursor and the
server replays what follows.

## The schema, and the clients

`internal/events` stays hand-written Go, and it stays canonical.

The seal is why. The closed kind set is enforced by an unexported method on `Payload`,
and generated Go cannot carry one. A schema compiler that owned the Go types would
therefore delete a kernel property, and the kind set would go back to being enforced by
review.

So the generation runs the other way. The payload registry that already makes the
round-trip test exhaustive also describes the schema, and an interface document is
generated from it. Clients for other languages are generated from that document. The
server needs no new runtime dependency, and every generator runs at build time.

**Two version numbers, and neither reaches the other's ground.** The schema version
governs stored records and nothing else. The service version governs the wire surface
and nothing else. They move at different rates: a new method touches no record, and a
new payload field touches no method. The discipline is one line long — the service
version never appears inside a record, and the schema version never gates a method.

**A stale document fails the build.** A generated artifact that still compiles while
describing an older schema is the worst of the three outcomes, because nothing reports
it.

## The processes

There is one service. There are several ways to reach it.

| Command                | What happens                                                      |
| ---------------------- | ----------------------------------------------------------------- |
| `eva`                  | Uses the background server, starting it when it is not running    |
| `eva --standalone`     | Runs a private server for this process alone                      |
| `eva --server <url>`   | Drives a server somewhere else                                    |
| `eva -p "<prompt>"`    | One turn, direct transport, no socket and no child process        |
| `eva serve`            | Runs the API and the web interface in the foreground              |
| `eva serve --register` | The same server, writing the registration a client finds it by    |
| `eva service start`    | Manages the background server: start, restart, status, stop       |
| `eva pair`             | Mints a pairing token and shows how to reach this server          |
| `eva api <operation>`  | Makes one request against the running server                      |
| `eva export`           | Writes a Session as JSON                                          |
| `eva import`           | Reads one back, from a file or an address                          |

The port is ephemeral unless a person names one, and the registration carries the address
the operating system chose. So there is no port already in use, no default that collides
with something else, and no reason two Servers cannot run at once.

The background server persists. That is what makes it a service, and it is what lets a
desktop application attach to the Session a person just left. `--standalone` is the
path that leaves nothing behind.

`eva service` supervises. It does not implement a second server. What it installs runs
`eva serve`, so there is one server and one lifecycle. A `service` that forked its own
daemon would make "is the server running" a question with two answers.

`eva api` is nearly free once the interface document exists, and it earns its place
twice. It is the shortest path to debugging the wire. It also tests the document: a
capability `eva api` cannot reach is a capability the document describes wrongly.

### A pairing token is printed, and a credential is not

The background server holds a long-lived credential in a private file, generated once
and kept across restarts. Nothing prints it. `eva service password` may rotate it and
may not reveal it.

`eva pair` mints something else: a short-lived, single-use token, and it prints that.
Printing is the token's entire purpose, and it is worthless a few minutes later.

This is the token ladder in
[reference/architecture.md](../reference/architecture.md), applied to a frontend rather
than to a Worker. The acts are the same shape. A short single-use grant bootstraps a
longer rotating credential, which authorizes narrower per-action grants. A phone
joining over a local network is a less trusted principal than a build runner, so it
gets the same ladder rather than a weaker one.

The alternative is a static password in an environment variable that defaults to
absent. That is the design this repository already rejected in writing: rotation
detects theft, and a static token does not.

It also means the output of `eva pair` is safe to photograph, paste, or render as a
code. The durable credential appears nowhere.

## The interfaces

Everything a person drives Eva through lives in this repository. The hosted Console does
not.

**There is one web interface, and one interface toolchain beside Go.** The browser loads
it from the Server. The desktop application is a shell around it. A phone reaches it over
a Pairing token on the local network, and discovery makes that one step rather than two.

Three native interfaces would be three folds over one Event stream, and four folds are
four chances to disagree with the Trace. What one interface cannot give a phone is named
rather than discovered: notifications, working with no network, and a presence in an
application store. The day one of those is required, mobile goes native and pays for its
own toolchain.

The Console shares the interface rather than a copy of it. That is what keeps the claim
about running everything locally true as the Console grows.

The web interface ships inside the binary. One checksummed artifact is the whole
install story, and an interface that needs to fetch itself breaks the case that the
customers who want a managed service care about most: a machine with no route out.

Three consequences bind, and they are the reason the claim "run everything locally"
stays true as the hosted Console grows.

1. **The web interface never calls an endpoint the local server lacks.**
2. **Console-only surface is a separate service the interface composes.** Organizations,
   seats, and billing are not extensions of the session API.
3. **A test drives a full turn through the web interface against a local `eva serve`,
   on a machine with no route to the Console.**

The third is an exit test rather than an intention. Without it the first two decay the
first time a feature is easier to write against the Console.

**The managed Console is not a second product.** It is this service, with tenancy,
billing, and someone else's uptime. That is the whole of what it sells: a person who
does not want to run the infrastructure does not have to.

## Authentication has two subjects

Two different things authenticate, and one verb cannot own both.

A Provider credential says how a turn reaches a model. A Console credential says who a
person is to the managed service. They live in different places and expire for
different reasons.

So the verb lives under the noun that owns it. `eva provider login` and `eva console
login`. `eva login` and `eva auth status` fail with the command that replaced them,
rather than becoming aliases. A removed key fails loudly with migration guidance in
this repository, and a permanent alias is the silent version of that.

The mechanism is already built. The existing device-code flow — a user code, a poll
interval, and a timeout — is what a Console login needs, and the auth store is already
the one file a credential lives in.

`eva provider` also gives a home to something the registry can already answer. Listing
the Providers a person may select is reading a map that exists.

## What a repository may contribute

One server serves many working directories. A Session carries the directory it belongs
to, and the server holds no ambient project. So one process reads configuration from
repositories nobody vetted.

Today that is safe, and it is safe for a stated reason: a repository may choose how Eva
looks and not what it does. That boundary comes under pressure the first time a
repository can contribute a Hook.

So the grant arrives now, while the only thing behind it is colours. Repository-local
configuration loads after an explicit grant for that directory, recorded in the
person's own configuration rather than in the repository's. A `.eva/` directory in a
cloned repository is untrusted content, in the same category as a fetched web page.

Writing the grant later means every existing person meets a dialog about something that
already worked, and learns to dismiss it.

## The path from here

Nothing below changes a stage number or an exit test.

| Piece                                                     | Lands       |
| --------------------------------------------------------- | ----------- |
| `internal/harness`, the registry, `harness/eva`            | Landed      |
| The session API and the local-facts split                 | Landed      |
| The direct transport, and `eva -p` through it              | Landed      |
| The generated interface document and the Go client         | Next        |
| `eva serve`, `eva service`, `eva pair`, `eva api`          | Next        |
| The web interface, embedded                                | Next        |
| The per-directory trust grant                              | With the above |
| `eva console login`, `eva provider login`                  | With the Console |
| Durable `eva resume`, `branch`, `rewind`                    | Stage 7     |
| The editor protocol surface                                 | After 6.5   |
| The `Harness` adapters and the conformance suite            | Stage 9c    |
| Enrollment, leases, and the control plane                   | Stage 9b    |

Reconnection ships with the wire, because it is a property of the wire. Durable resume
after `kill -9` is stage 7's exit test and is only reserved here: the Cursor on the
wire, a Session-scoped API, and `harness/` owning the mechanism.

## A Question is a record, and so is its answer

The schema already holds the question. `NeedsHuman{Question, Resume}` is a registered
Kind. Nothing recorded the reply, so a Session that escalated and was answered could not
be rebuilt from its Trace.

One Kind closes that. `Resolved` names the Question by the Event identity the Recorder
already assigned, and says how it ended: answered, rejected, expired, or cancelled. A
rejection is a person declining to answer, which is data rather than an error, so neither
`Outcome` nor `ErrorClass` widens.

A Question belongs to the Session whose Trace holds it. The Inbox across Sessions is a
fold over a Location, not a table, so it cannot disagree with the record. And a
`NeedsHuman` with no matching `Resolved` **is** the blocked state — the scheduler's
`blocked-on-human` needs no state field, because it is a fold over two records.

The falsifier for this design half fired. A shipped tool exposes pending questions over
its own interface, with reply and reject as separate verbs, and that shape is worth
adopting. The other half did not fire. Nothing ships this through a lease, with a paused
deadline, for a fleet where the human is never at the Worker.

## What is not decided

One thing, and it is named rather than assumed.

**The lease clock, while a Run is blocked on a human.** A lease has a deadline. A Run
waiting on a person is idle by design, so its deadline must pause or extend, or the
escalation races the deadline and the Job requeues under the operator's nose. The answer
must also re-enter the exact call on the resume Cursor rather than restarting the Run.

That needs a lease, and leases arrive at stage 9b. What lands now is the record the pause
will read: a Question, its Resolution, and the Cursor the answer re-enters at. The
mechanism is Eva's to invent, and the falsifier stands — if a tool ships a genuine
elicitation-through-lease, adopt its shape instead.

## Prior art

One tool has shipped most of this shape, and reading it changed two decisions here.

Its background server keeps a registration file naming a URL, a process, and a version,
beside a private credential file. A client checks health, checks the version, and
starts a detached server when it finds none. It guards every signal it sends by
re-reading the registration, so it never stops a process it did not start.

Its interface is defined in code, an interface document is generated from the
definitions, and clients are generated from the document. Its Event stream is
server-sent, and each Event carries an optional durable position. Its interface is a
loopback address rather than a local socket, because a browser cannot open a socket.

Two of this document's decisions come from that reading. The schema generation runs
from code outward, rather than from a schema compiler inward. The background server
listens on a loopback address, rather than on a local socket, because the embedded web
interface has to reach it.

Eight further mechanisms are taken from it: the flag that makes a foreground server the
Service, the ephemeral port with the address in the registration, the bounded replay a
client may ask for, the Location as a request parameter, the registration re-read before
and after a signal, the development build that never reuses a Service, discovery on the
local network, and exporting a Session as JSON.

Four things were left where they were, and each has a reason.

Its version lives in a local file, so its check cannot work for a client that arrived over
a network. Here the version travels in the health response, because a browser has no file
to read.

It kills an incompatible server without asking whether it is busy. Here an interrupted Run
closes with a recorded claim, so killing a busy Service would write a failure caused by a
client upgrade.

Its server password is readable by a command. Here it is not, because a credential a
command prints is a credential in a terminal history.

Its discovery flag widens the bind address. Here discovery announces and authorizes
nothing, and widening the bind still requires the Credential.

One thing is flagged rather than taken. It exposes Provider credentials over its interface,
which is how its web interface configures a Provider. That collides with the rule that a
credential never reaches a record, and it needs a decision of its own rather than arriving
as a default.
