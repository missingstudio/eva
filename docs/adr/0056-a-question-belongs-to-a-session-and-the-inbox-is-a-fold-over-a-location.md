---
status: accepted
---

# A Question belongs to a Session, and the inbox is a fold over a Location

A Question is addressed to the Session whose Trace holds it. A cross-Session inbox is a
fold, scoped by Location. A Location is the directory a Session belongs to, and it is
also the scope a request acts in.

## Two lists, and only one of them is a store

**By Session.** The Questions a Session is waiting on. This is a fold over that
Session's Trace: every `NeedsHuman` with no matching `Resolved` (ADR 0055).

**By Location.** The Questions every Session in a directory is waiting on. This is the
same fold, over more Sessions.

Neither is a table. Both are projections, which is what keeps a pending-Question list
from becoming a second source of truth that can disagree with the Trace.

## Why the inbox needs a Location

`reference/architecture.md` describes the Attention view as *"the escalation inbox — the
only view a human must open daily."* A per-Session list cannot build it, so the inbox
needs a boundary.

Tenant is too wide: a Tenant may hold every Session in an organization, and a person
sitting in one repository does not want the others. Run is too narrow: a Run ends and a
Question outlives the turn that raised it.

Location is the boundary a person actually holds. It is where they are.

## Location is a request parameter, not only a Session property

A Session carries the directory it belongs to. That is true and it is not enough.

A Server holds no ambient directory (ADR 0054), and it serves many. So a request that
lists anything — Sessions, Questions, pending permissions later — has to say which
Location it means. A list with no stated boundary either returns everything the Server
holds, or silently returns one Location the client did not choose. Both are wrong, and
the second is worse because nothing reports it.

So Location travels on the request. The Session's Location is what the request selects
against.

## The two directories are not the same directory

A remote Console running in one directory can drive a Session in another. Both facts are
true at once, and they live on different sides of the seam.

The **Session's** Location travels on the wire, because the Server needs it to select.
The **client's** own directory is a Local fact, reported by `About` (ADR 0048), because
it describes the machine a person sits at.

Naming them separately is what stops a remote Console from reporting the Server's
directory as its own, or from asking for Sessions in a directory that exists only on the
other machine.

## Considered options

- **Session-scoped only.** Rejected. The Attention view is in the design and cannot be
  built from per-Session lists.
- **Run-scoped.** Rejected. A Question outlives the turn that raised it, and resume acts
  on Sessions rather than Runs.
- **A pending-Question table beside the Trace.** Rejected. It is a second source of
  truth for a fact the Trace already holds, and the two can disagree with nothing to
  report it.
- **Tenant-scoped inbox.** Available later and not instead. A Tenant-wide Attention view
  is what an operator of a fleet wants, and it is the same fold with a wider boundary.

## Consequences

**Location earns a glossary entry.** It is not a Workspace: a Workspace is created,
isolated, and snapshotted at stage 4, and a Location is only where. A Session's Workspace
is what its Location resolves to once Workspaces exist.

**The trust grant and the request scope agree.** ADR 0054 grants trust per directory, and
a request names the directory it acts in. One concept carries both, so a granted
directory and a requested Location are the same string.

**A Location the Server does not hold is an empty answer, not an error.** A directory
with no Sessions has no pending Questions, which is a fact rather than a fault.
