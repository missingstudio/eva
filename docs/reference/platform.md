# Production platform

> **Status: draft.** This describes what Eva will be, not what it is.
> Only stage 0 is built. Where this and an ADR in [`../adr/`](../adr/) disagree,
> the ADR wins. Verification basis: the tip of `main` on 2026-08-09.

Tenancy, execution isolation, the three compute modes, security and
compliance, billing, and deployment topology.

## Tenancy model

The control plane can be shared. **The data plane never can.**

| Concern                        | Isolation                                                                                                 | Why                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Task graph, specs, projections | shared DB, `tenant_id` on every row, enforced at the **query layer** (RLS or a non-bypassable repository) | cheap, data is small                                               |
| Traces and artifacts           | shared object store, tenant-prefixed keys, **per-tenant envelope encryption**                             | large; cheap to segregate by key; satisfies deletion               |
| **Execution**                  | **hard isolation, one tenant per VM, destroyed per task**                                                 | you are running model-generated code                               |
| Secrets                        | per-tenant vault namespace, separate KMS key                                                              | blast radius                                                       |
| Scheduling                     | per-tenant queues, weighted fair share                                                                    | one tenant's 500-task backlog must not starve another's urgent one |

**Application-layer tenant filtering is not isolation.** If a missing `WHERE tenant_id = ?` can leak data, you will ship that bug in the end. Bind the tenant to the connection, not to an argument.

## Execution isolation

You operate a code-execution service. The threat model is Modal or Fly, not a normal SaaS.

- Use a microVM (Firecracker) or gVisor. Do not use containers on a shared kernel.
- Start a fresh rootfs from a snapshot. Destroy it after the task. Never reuse a rootfs across tenants.
- Deny egress by default. Use a per-profile allowlist.
- Give no access to the cloud instance metadata. That is the classic SSRF-to-credentials path.
- Set hard caps on CPU, memory, disk, PIDs, and wall clock. The platform enforces these caps. The good behaviour of the agent does not.
- Inject secrets at the env boundary as short-lived scoped credentials. Never use long-lived credentials. Never put a secret in a trace.

**Buy this layer first.** Put E2B, Modal, Daytona, or Fly Machines behind the existing `Env` interface, and ship. Your own microVM orchestration is a year of work, and no customer pays extra for it. The `Env` abstraction makes a later change of vendor a config change. Examine this decision again when compute becomes a material share of COGS.

**Warm pools:** the cold start controls the perceived latency. Pre-warm a pool for each popular image. Snapshot after the dependency install. Restore one instance for each task. Target less than 2 seconds to the first agent token.

## The three compute modes

All three run the same daemon binary, the same enrollment flow, the same stream.

**Managed sandboxes (default).** Eva hosts ephemeral microVMs. They autoscale. You bill them by the second. They need no setup. This is the self-serve product, and it gives most of your compute revenue.

**Registered fleet (BYO compute).** The customer runs the daemon in their VPC, their cluster, or on bare metal. This needs one command and a token. Their code never leaves their perimeter. This answers data residency. It gives access to internal git and staging with no tunnel into your cloud. It cuts your COGS to almost zero. It is often the fastest path into a regulated enterprise. Price it as control-plane seats plus task volume, not as compute.

**Local dev machine.** The same daemon runs on a laptop. Use it for "run this against my working tree" and for pre-commit evaluation.

### Networking, stated precisely

- **Enrollment and work delivery need no tunnel.** The daemon dials out over TLS. Hotel wifi, corporate NAT, and CI runners all work.
- **Tunnels are for the reverse direction.** They serve the UI terminal attach, the preview URLs for a dev server that the agent started, and interactive debugging. Multiplex a reverse channel over the existing stream, or run your own relay. Do not make the customer install Tailscale for this. Tailscale is a dependency that fails in exactly the locked-down networks where you most want to work.
- **Tailscale or WireGuard is correct** when a *managed* sandbox must reach *customer-internal* resources. But prefer to move the worker into their network (registered fleet). Do not tunnel their network into your cloud. The worker in their network gives a smaller attack surface, better latency, and an easier security review.

## Security and compliance

| Module       | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authn/`     | email + OAuth self-serve; SAML/OIDC SSO and SCIM for enterprise                                                                                                                                                                                                                                                                                                                                                                                           |
| `authz/`     | org → workspace → project; roles: owner, admin, operator, reviewer, viewer; service accounts for CI                                                                                                                                                                                                                                                                                                                                                       |
| `secrets/`   | per-tenant vault namespace, envelope encryption, short-lived credential minting, rotation                                                                                                                                                                                                                                                                                                                                                                 |
| `redact/`    | **redaction at the trace sink, not after** — "written then scrubbed" is a breach with extra steps                                                                                                                                                                                                                                                                                                                                                         |
| `attest/`    | immutable signed action log: action → lease → credential → mandate → human grantor. Governance primitive and SOC2 evidence in one                                                                                                                                                                                                                                                                                                                         |
| `retain/`    | per-tenant retention, hard delete, full export                                                                                                                                                                                                                                                                                                                                                                                                            |
| `residency/` | region pinning for control-plane data and execution                                                                                                                                                                                                                                                                                                                                                                                                       |
| `trust/`     | trust grants for repo-checked-in packages, skills, hooks, and config; per-tenant policy on what repo content may execute where. **Per-tenant governors for the enterprise:** managed-only mode (reject all third-party hooks / MCP servers / permission rules), MCP allow/deny lists, a needed version range, and a switch that rejects side-loaded config flags. **Version pinning applies to Eva's own harness as much as to foreign ones** (risk #4) |

**Compliance sequencing:** get SOC 2 Type I before the first enterprise deal. Get Type II within a year. Nobody gives an agent write access to their monorepo without it. With `attest/` you already have most of the evidence. Budget calendar time for this, not engineering time.

**The most dangerous failure mode is prompt injection that reaches merge authority.** Content in an issue, in a dependency README, or in a fetched page instructs the agent, and the change lands. There are four defenses. Never auto-merge changes to CI config, to auth code, or to dependency manifests. Treat all fetched content as untrusted data, and drop tool access for it. Risk-score every diff, and route a high-risk diff to a human, whatever the test status. Defend also at composition time. Prompts label trusted instructions and conditions separately from untrusted observations. They also carry a standing instruction: revalidate the live state before a mutation (stage 9a).

## Billing and metering

Agents are not seats. Per-seat pricing collapses the moment a customer runs a hundred parallel tasks.

**Meter:** compute-seconds by sandbox class, model tokens by provider and model, tasks attempted, tasks merged, storage, human-review minutes.

**Meter from provider-reported usage, never from a client-side estimate.** A harness's self-reported `total_cost_usd` is an estimate and can differ from the actual bill; if Eva bills on it, the estimate is a liability. Meter from provider usage, reconcile against invoices, and mark any run whose cost is only an estimate as `degraded`. This is the same rule 8 that governs fabricated trace data. The token accounting the meter needs (reasoning tokens, cached-input tokens, per-retry spend) is already in the event schema by invariant 8.

**Charge:** a platform fee for each workspace (control plane, dashboard, policy, audit), plus usage. For registered-fleet customers, remove the compute component. That discount closes enterprise deals, and it costs you nothing.

**Customers demand these controls on day one.** Hard spend caps for each workspace and each task. Budget alerts, per-project attribution, and a visible estimate before a task runs.

**Sell on human minutes per merged change.** Do not sell on tokens, on tasks, or on seats.

## UI surface — build in this order

1. **Onboarding.** The user connects a git host with the GitHub or GitLab App, selects a harness, and runs a first task. This must take less than five minutes, or self-serve fails.
2. **Task view.** It shows the spec, the live event stream, the terminal attach, the diff review, the cost so far, and a cancel control. The user attaches and detaches from any device, and the task continues. Supervision is stateless. The daemon owns the session. This is pi-web's remote-first rule.
3. **Escalation inbox.** This is the one surface that a human must open each day. It ranks the items by the cost of delay. If this surface is correct, the product feels autonomous. If it is wrong, nothing else matters.
4. **Fleet.** It shows managed pool utilization, registered machines, the harness inventory of each worker, health, and token management.
5. **Queue and roadmap.** It shows the backlog, the priorities, the blocked tasks, and agent-proposed items that wait for approval.
6. **Money.** It shows spend by project, by harness, and by model, the cost for each merged change, and the burn against the caps.
7. **Quality.** It shows the eval trend, pass@1 by harness, the revert rate, and the human-touch rate.
8. **Admin.** It shows RBAC, SSO, policies, mandates, and audit log export.

## Deployment topology

```
region/
  api            stateless HTTP + WebSocket/gRPC terminators, horizontally scaled
  scheduler      leader-elected, leases + fair-share admission
  projector      folds the trace stream into read models
  relay          reverse tunnels for terminal attach and preview URLs
  postgres       tenants, task graph, leases, mandates, billing (RLS on)
  objectstore    traces, artifacts, snapshots (content-addressed, per-tenant keys)
  queue          durable work queue (Postgres-backed is fine well past 100 customers)
  sandboxpool    microVM fleet, warm pools per image
  vault          per-tenant secret namespaces
```

**Operational invariants:**
- You must be able to rebuild the projector from the trace stream at any time. State that the traces cannot reconstruct is a second source of truth and a permanent consistency bug.
- You must be able to restart the scheduler in mid-flight. Leases have deadlines. A restart expires nothing early, and it loses nothing.
- Every side effect carries an idempotency key. A requeue after a lease expiry will occur.
- Keep platform observability separate from the agent traces. Do not debug API latency inside the trace store.

---
