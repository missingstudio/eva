# What Eva is for

Eva is an open-source, AI-native software factory. It runs coding work end to
end — from a spec a machine can check, through a harness that does the work, to
evidence that it was done — across the harnesses you already pay for.

It runs on your laptop as a CLI, and it runs as a service you reach from
anywhere. Those are the same program.

## The problem

You have subscriptions to several coding harnesses. Each is a good
harness. None can tell you what a change cost, none can check another's work,
and none can run twenty tasks overnight and show you the evidence in the
morning. Switching between them means switching tools, losing history, and
starting the accounting again.

And all of them are tied to the machine you are sitting at. Close the laptop and
the work stops.

## What Eva does about it

**One contract over every harness.** Eva's native harness and every foreign one
implement the same interface, so a task runs on any of them without being
rewritten. Eva's own harness has no privileged position.

**One trace.** Everything every harness does lands in one event schema. What a
trace cannot rebuild is a bug.

**One verifier.** Acceptance criteria are checked by Eva, not claimed by the
agent that did the work. A claim is never evidence.

**One bill.** Cost is attributed per task, per merged change, and per harness —
which makes "use this harness for this kind of work" a measurement rather than a
preference.

## Remote-ready, and why it is a property rather than a feature

Every interface Eva has — terminal, print, HTTP, web — is a plugin against one
session API, and that API never assumes the person is on the same machine as the
work. There is no local mode and no remote mode; there is one interface and a
distance that does not matter.

That is what makes the rest possible:

- **Start work anywhere, watch it anywhere.** A session lives on the server and
  survives the client leaving. A surface reconnects by trace position, so a
  dropped connection costs a repaint rather than a Run.
- **Build your own interface.** Terminal, web, phone, editor extension, or a
  script — every one is a row in the same domain, calling the same session API.
  We ship four person-facing surfaces; a third party ships the fifth without
  asking.
- **Your subscriptions, from a machine that is not yours.** The harnesses stay
  installed where they are licensed. The interface does not have to be there.

If local were a special case, half the system would stay untested until the day
it mattered most. So there is no local special case — the terminal you type into
is the same plugin shape as the server you reach.

## The managed service

Eva is the substrate for a hosted product, and the open-source tree is the whole
of it — not a demo that a proprietary version completes.

What the service adds is operation, not capability: enrolled workers behind NAT
taking work from a control plane, per-tenant isolation, spend caps and hard
limits, an audit trail tied to a mandate that expires, and a dashboard that
answers what the factory produced this week and at what cost.

Everything it is built on — the harness contract, the trace, the verifier, the
session API, the plugin system — is in this repository and runs on your laptop
with no account. **Self-hosting is not a downgrade path.** The service exists
because running a fleet is work, not because the tree is missing pieces.

## Who it is for

Someone who already runs coding agents and has hit the ceiling: too many
branches to review, no way to tell which harness is worth its cost, no audit
trail when something lands that should not have, and no way to keep any of it
going once they step away from the desk.

## What it is not

Not a model. Not an IDE. Not a replacement for the harnesses you use — Eva
drives them, and its own harness is one entry in the same registry.

## How it gets built

Nineteen stages build the factory. Twenty more build its surfaces and turn the
control plane into a service. Every one has an exit test it can fail, and they
are all in one document, in one order: [roadmap.md](roadmap.md), which opens
with what to build next.
