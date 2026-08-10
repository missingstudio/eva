# How to read the trace

Query the record Eva writes, to answer what a run did, what it spent, and why it
failed. At the end you will be able to pull any of those out with one command.

The trace is the single source of truth. Everything on screen is a fold over it, so
anything you can see, you can read here.

## Before you start

- At least one completed run. See [tutorial/first-run.md](../tutorial/first-run.md).
- `jq`. Any JSON reader works; the recipes below use `jq`.

Default location is `~/.eva/trace.jsonl`, one JSON object per line. `[trace] path` in
`config.toml` moves it, and `EVA_HOME` moves the directory.

## The envelope

Every record carries the same envelope, whatever its kind:

| Field                      | What it is                                                  |
| -------------------------- | ----------------------------------------------------------- |
| `id`                       | This record's identity                                      |
| `seq`                      | Trace position, per Session, assigned by the sink at commit |
| `wire_seq`                 | Wire position, per connection, assigned by the producer     |
| `at`                       | `wall` for reading and ordering, `mono_ns` for latency      |
| `version`                  | The schema version this record was written under            |
| `kind`                     | Which payload it carries, from a closed set                 |
| `tenant`, `actor`          | Who it is attributed to                                     |
| `run`, `session`, `parent` | What it belongs to                                          |
| `payload`                  | Display detail, shaped by `kind`                            |

`seq` and `wire_seq` are different sequences and diverge by construction. The sink
coalesces many wire chunks into one record. See
[adr/0008](../adr/0008-wire-position-and-trace-position-are-two-sequences.md).

## Recipes

**What happened, in order:**

```bash
jq -r '"\(.seq)\t\(.kind)"' ~/.eva/trace.jsonl
```

**What one run cost:**

```bash
jq 'select(.run == "run_1" and .kind == "usage") | .payload' ~/.eva/trace.jsonl
```

Read absence carefully. A `null` counter means the provider reported nothing. It does
not mean zero. `usd` is `null` unless a provider returned a real figure, because Eva
never estimates a dollar amount.

**Why a run failed:**

```bash
jq 'select(.kind == "finished") | .payload.claim' ~/.eva/trace.jsonl
```

```json
{
  "result": "failed",
  "summary": "provider anthropic: auth_failed: 401",
  "error_class": "auth_failed"
}
```

`result` is one of `done`, `failed`, `needs_human`, or `exhausted`. `error_class`
comes from a fixed set, so you can group failures without parsing prose. An absent
`error_class` means nobody classified the failure, which is not the same as `other`.

**Every retry, with what it cost you in wall clock:**

```bash
jq 'select(.kind == "retry") | .payload' ~/.eva/trace.jsonl
```

A retry spends money and wall clock and produces no tool call. It is a record of its
own so that a turn which cost four requests never reports one.

**Runs that are marked incomplete:**

```bash
jq 'select(.kind == "degraded") | {run, missing: .payload.missing}' ~/.eva/trace.jsonl
```

A `degraded` record means data is missing, estimated, or unreported. Its presence is
the flag. Exclude these runs from any scoring you do.

**One session's whole transcript:**

```bash
jq -r 'select(.session == "sess_1" and .kind == "text") | .payload.chunk' \
  ~/.eva/trace.jsonl
```

## Verify

`seq` is dense and gapless within a Session. Check it:

```bash
jq -r 'select(.session == "sess_1") | .seq' ~/.eva/trace.jsonl | \
  awk 'NR-1 != $1 { print "gap at " NR-1; bad=1 } END { if (!bad) print "dense, no gaps" }'
```

A gap would mean the sink lost a commit. That is the one lie no reader could detect,
which is why the sink reads the file back when it opens it. See
[adr/0027](../adr/0027-a-sink-recovers-the-position-the-trace-reached.md).

## Troubleshooting

| What you see                         | What it means                                                                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No file                              | No run has completed yet, or `[trace] path` points elsewhere.                                                                                                                                                   |
| A kind you do not recognise          | A record from a build that knew a kind yours does not. Its bytes are kept intact and the run is marked `degraded`, never dropped. See [adr/0002](../adr/0002-unknown-event-kinds-are-preserved-not-dropped.md). |
| The file ends mid-line after a crash | It should not. A killed writer leaves no partial record and no partial group. If you can reproduce a torn line, that is a bug worth reporting.                                                                  |
| `usd` is always `null`               | Expected. Neither Anthropic nor OpenAI returns a dollar figure with a response.                                                                                                                                 |

## Related

- [reference/architecture.md](../reference/architecture.md) — every kind and payload
- [CONTEXT.md](../../CONTEXT.md) — Trace, Run, Session, Claim, Error Class
- [decisions.md](../decisions.md) — the schema decisions on one page
