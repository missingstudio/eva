# The ladder, and the order you climb it

Why a model does not become a factory by adding agents, what each of the ten
rungs holds, and what breaks where one of them is not built. Read this before
the roadmap.

## The ten rungs

A model becomes a company across ten rungs, climbed in order.

**model → workflow → agent → environment + verifier → harness → scheduler + spec → factory → learning loop + economics → intent + authority → company**

|     | Rung                          | What it is                                        |
| --- | ----------------------------- | ------------------------------------------------- |
| 1   | **Model**                     | a next-token function, no state                   |
| 2   | **Workflow**                  | code holds the control flow                       |
| 3   | **Agent**                     | model holds the control flow                      |
| 4   | **Environment + verifier**    | sandbox, tests, a cheap oracle                    |
| 5   | **Harness**                   | context, tools, policy, budget                    |
| 6   | **Scheduler + spec format**   | work queue, machine-checkable acceptance criteria |
| 7   | **Software factory**          | parallel agents, merge queue                      |
| 8   | **Learning loop + economics** | evals, cost per merged change                     |
| 9   | **Intent + authority**        | who decides, who is liable                        |
| 10  | **Autonomous company**        | sets and funds its own goals                      |

**1 → 2.** A model holds no state, so something outside it has to hold the sequence. Code holds it first, because code is the cheapest thing to correct.

**2 → 3.** The control flow changes hands. The difference between a workflow and an agent is *who owns it*, not smart against dumb, so hand it over only where the steps could not have been written in advance. Most agent failures are a workflow handed over too early.

**3 → 4.** An agent that cannot be told that it is wrong does not converge. The oracle has to be cheap, because it runs on every attempt.

**4 → 5.** A verified agent still has no bounds. The harness is where tokens, dollars, wall clock, and permission stop being good intentions.

**5 → 6.** One bounded run is not a queue. A ticket written for a human is not a spec either — it carries no criteria that a machine can check — so the queue and the spec format arrive together or neither works.

**6 → 7.** Only now is "more agents" worth anything. Parallel work needs a merge queue, because eight branches that never land are just eight branches.

**7 → 8.** A factory that cannot measure itself improves nothing. Evals say whether a change was an improvement, and the cost per merged change says whether it can be sold.

**8 → 9.** The specs still arrive from outside. Someone has to decide which work is worth doing, and answer for it when it was not.

**9 → 10.** The goals stop arriving from outside. A factory consumes specs; a company generates them, and funds them.

## The law

The whole ladder is one loop. The loop repeats at longer timescales: token (ms) → task (minutes) → session (hours) → change (days) → product (months).

**Every rung needs the same three things at its own timescale: a verifier, a memory, and a delegated authority.**

**A verifier** — what says the work at that timescale was right. It is the one thing that does not compose upward. Passing unit tests do not add up to a healthy product, so each rung has to invent its own oracle, which is the real work of climbing ([the primitive](the-primitive.md)).

**A memory** — what the next pass at that timescale reads. The Trace is Eva's, at every timescale, which is why invariant 1 admits no quick path around it.

**A delegated authority** — who may decide at that timescale, and how far. The budget is where that stops being a matter of trust, and `NeedsHuman(reason)` is what happens at the edge of it.

## Invariants — hold these from the first commit

These are cheap on day one. They are very expensive to add on day four hundred.

1. **Everything is a trace.** Every model call, tool call, and decision appends to an append-only Trace. There are no quick paths.
2. **All side effects go through the tool registry.** You cannot sandbox, meter, or audit code that touches the filesystem, the network, or the shell outside a registered tool.
3. **Every long operation is resumable.** Keep state on disk, not in a process.
4. **The harness boundary enforces the budgets** — tokens, dollars, and wall clock.
5. **Escalation to a human is a first-class outcome**, not an error. `NeedsHuman(reason)` is a valid return type.
6. **Config is a versioned file, not a flag.**
7. **Tenant and actor are on the primitive from commit one.** See Part 1.
8. **One event schema, everywhere.** Every observable thing is an instance of one versioned, typed event schema. That covers a model chunk, a tool call, a retry, an approval, a diff, and an escalation. Stage 0 defines this schema. The trace is the persisted event stream. Every UI is a fold over the stream. Adapters normalize their output into the schema. Hooks subscribe to the stream. There is no second vocabulary.

**The schema must be complete at stage 0**, because a field added later breaks every registered adapter and every stored trace. Completeness means three things. Retries are events, because they spend money and wall clock but emit no tool call. Every event carries parent linkage, for subagent attribution. Usage accounts separately for cache **writes** and cache **reads**, which are priced differently. It also accounts for reasoning tokens, where a provider reports them at all. A schema missing these silently corrupts the cost numbers the business is sold on (Part 3).

The schema is now settled: see `docs/adr/0001`–`0008` for the decisions and Part 2 for the shape. An unreported field is `nil`, never `0`. Anthropic bills thinking tokens inside output tokens and reports no reasoning figure. A zero there would be a confident lie rather than a measurement.

9. **Every mutation is idempotent.** Every mutating call carries a request key: task creation, trigger admission, and enrollment. An exact replay returns the original record. A reuse of the key with different input is a visible conflict. Machine-generated work uses deterministic keys in a reserved namespace. A crash or a lost response can never produce zero records or two records.

---

1. **Over-invest in stage 5.** The verifier sets the ceiling for everything above it. Agents converge where a good oracle exists. Agents fail where no oracle exists, whatever the model.
2. **Stage 8 feels like overhead.** It is also the reason that stages 9–12 are possible at all.
3. **Stages 3, 6, and 7 can be shallow, and you can deepen them later. Stages 4, 5, 6.5, 8, and 10 cannot.** For those stages, shallow means that you rebuild them. A shallow stage 6.5 means that you rebuild it *and break the ecosystem*: a published hook API is a promise to other people's code.
4. **Do not build adapters before stage 8.** You can discover the adapter interface only after you know what a good harness needs. If you start pluralistic, you get the union of everyone's failure modes and the ability to fix none.
5. **Do not let the dashboard become the source of truth.** Traces are.
6. **Do not ship remote workers before the sandbox is real.** Stage 4 is a hard prerequisite for 9b.
7. **Do not normalize what a harness does not emit.** Fabricated cost data or trace data poisons the eval suite, the one instrument that you have. Mark it degraded and exclude it.
8. **Keep local and remote on one code path.** If local is a special case, half of your system stays untested until the day when you need it most.
9.  **Rent the sandbox layer for the first year.** Your own microVM orchestration is a year of work, and no customer pays extra for it.
10. **Dogfood the hook API.** Build as an extension every Eva feature that an extension can express. If an extension cannot express it, correct the API, not the feature. And freeze the API only after stage 8 exercises it. This is the same logic as rule 5: you discover interfaces, you do not design them.
11. **A product concept must earn its place through operator behaviour, not through speculative reuse.** This is factory's rule, learned when they shipped eight nouns and collapsed them to five. The operator-facing vocabulary stays small — spec, run, job, worker, mandate — and attempts, leases, and admission records stay implementation detail inside them.
12. **Fail closed, fail loud.** Workspace cleanup deletes only the work that is provably clean and published. It keeps dirty, failed, or uncertain work for inspection. A removed config key fails with migration guidance. The system never ignores it silently. When a value hits a bound, the system rejects it visibly. It never truncates silently.
13. **The docs are part of the factory.** Every design doc has a status — implemented, draft, or superseded — and a verification-basis commit. Both are written once, in `docs/product.md`, so a stage that ships resets one line rather than six. Each opinion carries a falsifier ("this changes if…"). The repo's AGENTS.md points agents at these docs. It tells them to update the docs in the same commit as a behaviour change. The workers of this factory are agents.

## Risks, ranked by how badly they end you

1. **Cross-tenant escape.** One breach ends the business. This is the one place where payment to a vendor is strictly correct.
2. **Prompt injection that reaches merge authority.** Assume that an attacker will try it. Defend at the merge boundary, not at the prompt. Config, skills, hooks, and extensions that are checked into a repo are untrusted content — the same category as a fetched web page. They load under the trust gate, at the wasm tier only, and never on a worker that holds secrets.
3. **Eval suite pollution.** If you lose the instrument, you lose the ability to know whether you improve.
4. **Harness dependency.** You depend on the CLIs of other people, and an upstream change breaks your adapters. Run the conformance suite each night, and pin the version for each tenant. Keep Eva's own harness good enough to be a fallback for every task class.
5. **Margin compression.** Compute and tokens pass through with a thin markup. The margin is in the control plane, in the eval data, and in the routing intelligence. Price for that from the start.

## If you only get halfway

Stages 0–8 give a genuinely excellent coding agent, and they are a good place to stop. They are a very bad place to have skipped stage 5.
