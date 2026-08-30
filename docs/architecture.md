# The architecture

What Eva is made of, at full size: one program, the surfaces a person or a
program drives it through, the daemon that owns the work on one machine, the
control plane above the daemons, and the layers a builder writes against.

This document owns the **shape** — which parts exist, what each one is
responsible for, and the boundaries between them.
[reference/architecture.md](reference/architecture.md) owns the **mechanisms**
— the four extension points, the kernel, and every interface, at the depth an
implementer needs. [context.md](context.md) owns the words. Which stage brings
each part is [roadmap.md](roadmap.md)'s to say, and where each part stands is
the execution log in [development.md](development.md) — this document
describes the full-size system and stays true while the work moves.

## One program

Eva is a small kernel and a set of plugins. The kernel holds the plugin
runtime, four extension points, the config source, and location resolution —
nothing else. Every capability is a plugin: the model providers, the tools,
the harnesses, the trace stores, the themes, the surfaces, and the Workflow
itself. There are exactly four ways to extend Eva — a Domain, a Slot, a Hook,
a Broadcast — and no fifth.

Two rules make that composable rather than merely modular:

- **One Slot, one filler, read late.** Exactly one plugin fills a Slot at a
  time, and a consumer reads it at the moment of use. Replacing the plugin
  behind a Slot takes effect in a live process, with no restart and no reload
  cascade.
- **No privileged position.** Eva's own harness is one row in the same domain
  a foreign harness joins. Eva's own terminal is one row in the same domain a
  third-party surface joins. Anything we ship, someone else can replace.

The same binary is every posture. The terminal, the pipe (`--print`), the
served page, and the socket API are doors into one process; local and hosted
are one artifact with different config. There is no build variant per surface
and no demo tier.

## The Session API is the one door

Everything a surface may do to Eva is one contract — create, list, retire,
attach, watch, submit, cancel, read and set the model, answer a request — and
it is the same contract in-process and across a socket. Three rules hold on
either side of it, and the roadmap's exit tests keep checking them:

- Below the line, the factory never knows which surface asked. Every action
  lands in the Trace identically and is attributed to an identity — a person,
  a device, a worker, a mandate — never to a door.
- Above the line, no surface owns client logic or a fold of its own.
  `packages/client-runtime` holds connection, reconnect by Cursor, and the Run
  protocol; `packages/session-view` holds the one fold from the record to
  renderable Blocks. A renderer maps Blocks to its own primitives and decides
  nothing else.
- Every surface is a client, including the first one. The terminal has no
  private path and never gains one.

In the other direction Eva reaches a surface through one contract too — the
Frontend — which is how a permission request finds a person on whichever door
is open, and how the first answer wins when two doors are open at once.

## The surfaces

Eva runs as a CLI, as a web page, as a desktop app, and as a phone app — and
as the doors a program uses: the socket API, a printable contract schema, chat
channels, and the agent protocol itself. Each surface is a lane of the
roadmap's Phase V, independent of the others and parallel to the factory
stages, because every one is a plugin over the same Session API.

**The terminal and the page move together.** The terminal is the reference
surface — every capability reaches a person here first — and the page proves
the same capability crosses a wire.
[reference/parity.md](reference/parity.md) is the ledger: what each door can
do, where each cell is proven, and which cells are honest gaps. A capability
that lands on one door and not the other is named there, never rounded up.

**The desktop and the phone build on what the first two prove.** The desktop
shell renders the same web build a browser gets and adds only what a browser
cannot do — a tray, native notifications, launch at login — and holds no
logic: kill the shell mid-Run and the Run continues. The phone is a companion
— notify, read, steer — that renders its own components over the same client
runtime and the same fold, and never holds a reconnect rule of its own.

**Chat channels are surfaces too**, and the cheapest ones: a chat surface is a
row that reads messages and writes answers over the same Session API — a
phone client the user already installed.

## The daemon

One machine runs one long-lived Eva that owns the work: the Sessions, the
Trace, the harness processes, and the terminals they open. Survival belongs to
that process, not to the window that started the work — close the terminal,
kill the browser, and the Run continues; any surface reattaches and converges
by Cursor.

Today that process is what `eva serve` starts and what the interactive
terminal holds in-process, and `eva attach <url>` is a terminal driving a
runtime another process serves. Stage 9a grows it into `eva daemon`: a
supervisor with a durable queue, a scheduler, budget-aware admission, and a
graceful drain, so a backlog clears overnight with nobody watching.

Clients reach a daemon along a ladder, not through a single transport: the
same machine first, then the local network with a paired device grant, then a
tailnet, then a relay. Each rung is one connection type with a different
address, which is why the phone track needs nothing from the factory beyond
the wire the page already uses.

## The control plane

Daemons join a fleet by enrolling with a control plane — one pasted token,
a scoped credential per worker, revocation within one heartbeat. The field
calls this layer a hub or an orchestrator; Eva's word is **control plane**,
because the Harness and the Scheduler already own the other meanings of
orchestration.

The control plane dispatches work to named machines, projects fleet state,
and meters spend. It does not own the truth: workers are authoritative for
what exists on them, the control plane projects and never reconciles the
world toward a record — except deletion, where a tombstone is durable intent
— and a kill is a request whose actual effect the Trace records. Its
authority is scoped like any client's: a token carries scopes, not a role,
and a control plane holds exactly the methods its scopes name.

**Signals come in at the top.** Demand arrives from outside — chat messages,
issue trackers, error monitors, usage analytics — through the importer domain
(stage 9a) and the signal domain (stage 13), and anything that admits work
autonomously is created disabled until an operator confirms what will run,
where, and when next. The same bridge layer that reads a chat channel as a
surface reads it as an intake, pointed the other way.

## The relay

A relay lets a device reach a daemon behind NAT, and it is deliberately dumb:
it carries ciphertext it cannot read and composes nothing. Pairing is
authenticated from the first commit, and the end-to-end keys exchange at
pairing — so the relay's privacy claim is a property of the design, not a
policy of the operator. Where a hosted posture must display something about a
Run, it shows a redacted projection the daemon published on purpose, never
the Trace.

## The harness seam

A harness is anything that takes a Prompt and drives it to a Stop Reason, and
the contract is the Agent Client Protocol, both halves. Eva ships two
harnesses of its own — the Workflow, a declared list of Steps with no agency,
and the Loop, propose → act → observe — and neither holds a privileged
position.

Foreign harnesses arrive at stage 9c as implementations of the contract that
already exists: one shared protocol runtime, plus a thin launcher entry per
vendor — an install spec, a credential probe, a readiness verdict, a launch
template — and at most four hooks where a vendor differs. Every one runs
under Eva's permission gate and inside Eva's workspace boundary, so a race
between three harnesses is one spec, one verifier, one Trace, and one bill.
What each harness can actually do is measured by a conformance suite and
published as a capability matrix with checked dates, never assumed.

**The model layer is provider-agnostic the same way.** A Provider is a model
behind one contract; provider plugins claim namespaces in the Catalog; and a
Credential is an API key from the environment or a subscription obtained by a
login, where a vendor permits one — the configured mode alone decides. Any
compatible endpoint joins by config, and a model nobody can price reports
cost as unknown rather than guessing.

## Profiles

A profile composes harness, model, tools, policy, budget, and environment
into one named agent (stage 7). Several profiles run side by side against one
fleet — a fixer under a tight budget in a worktree, a reviewer that is
read-only, a foreign harness under the same verifier — and a fork or a resume
records its lineage, so a surface can always answer where a Run came from.

## The layers a builder writes against

The package layering is enforced by lint, not convention:
[reference/architecture.md](reference/architecture.md) §9 carries the import
graph. What each layer is for:

| Layer                     | What a consumer gets                                                           |
| ------------------------- | ------------------------------------------------------------------------------ |
| `packages/schema`         | the one Event schema and the fold — the record every part agrees on            |
| `packages/acp`            | the agent protocol: types, codec, and the mapping into Eva's record            |
| `packages/core`           | the contracts: the Session API, the Harness, and every Slot interface          |
| `packages/kernel`         | the plugin runtime — only the composition root touches it                      |
| `packages/sdk`            | what a plugin author writes against: domains, slots, hooks, broadcasts         |
| `packages/client-runtime` | the non-visual client half every surface shares: transport, reconnect, the Run |
| `packages/session-view`   | the one fold from the record to renderable Blocks                              |
| `packages/boot`           | assembly: a Build plus config becomes a running kernel                         |
| `packages/testkit`        | boots plugins under test, with fakes for every ground Slot                     |
| `packages/conformance`    | the cross-plugin contract suites — proof, not shipped code                     |

Read the table as the SDK story. A **plugin author** needs `sdk` and the
contracts it re-exports, and
[reference/writing-plugins.md](reference/writing-plugins.md) is the
walkthrough. A **surface author** needs `client-runtime` and `session-view`
and never a renderer we chose. A **program** needs no package at all: the
Session API is on the socket through `eva.api`, and `eva api schema` (stage
C4) prints the contract as versioned JSON Schema, so version skew is a
negotiation rather than a crash.

## The SDK family

The layers above grow into a family of SDKs — vendor-neutral,
provider-agnostic, each usable standalone or to extend Eva. Every one arrives
the same way: a package that holds contracts, plugins that fill them, and a
stage in the roadmap that proves it with an exit test. Eight are planned, and
the table says where each stands:

| SDK              | What a builder does with it                                             | Where it stands                                        |
| ---------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| **core**         | the contracts: the Session API, the Harness, every Slot interface       | `packages/core`, shipped                               |
| **client**       | build a surface: connection, reconnect, the Run protocol, the fold      | `packages/client-runtime` + `session-view`, shipped    |
| **harness**      | write a harness, native or over the agent protocol                      | inside `packages/sdk` today; the adapter runtime at 9c |
| **a2a**          | agent-to-agent: both halves of the protocol, Eva as client or agent     | `packages/acp` today; `eva serve --acp` at 9c          |
| **agent**        | compose profiles: model, harness, tools, policy, budget, environment    | stage 7                                                |
| **sandbox**      | workspace and containment drivers: worktree, container, remote VM       | stage 4                                                |
| **memory**       | project and procedural memory behind one Slot                           | stage 6                                                |
| **orchestrator** | drive the control plane: enroll a daemon, dispatch work, read the fleet | stage 9b                                               |

The shape a builder should expect is one handle with the domains on it —
`client.session.watch(id)`, `client.harness.create(spec)` — the same calls at
every distance, because a Transport carries the contract unchanged and
decides nothing.

## The boundaries that hold it together

Every part above stays replaceable because five boundaries stay closed, and
the roadmap names them as the five ways the plan fails: a surface that
reaches past the Session API, a second fold, a shell that grows logic, a
phone-shaped rule inside the phone app, and a relay that can read the Trace.
One more is the SDK's own: every domain draft and hook context stays
serializable, so a plugin can run out of process and a contract can cross a
wire — reviewed when an extension point is added, not when it is too late.
