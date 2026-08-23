# @missingstudio/eva-provider-retry

The retry plugin for [Eva](../../README.md). It decides whether a failed
provider turn is worth another attempt, and how long the run waits before it
— so a rate limit or a flaky connection recovers on its own, with the wait on
the record.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
answers the `provider.retry` hook; core writes the `retry` record inside the
same open run and does the waiting. When no plugin answers the hook, nothing
retries. The glossary in [docs/context.md](../../docs/context.md) defines
**Retry**, and [architecture.md](../../docs/reference/architecture.md)
describes the hook mechanism.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The plugin definition is an `Effect`
  program; the helper functions are plain.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-provider-retry": "workspace:*" } }
```

## Usage

Without options the defaults apply. Tune them in a `.eva` config file:

```yaml
plugins:
  - id: eva.provider.retry
    options: { maxAttempts: 3, baseMs: 500, capMs: 30000 }
```

| Option        | Type   | Default | What it does                       |
| ------------- | ------ | ------- | ---------------------------------- |
| `maxAttempts` | number | 3       | Total attempts, the first included |
| `baseMs`      | number | 500     | Delay before the second attempt    |
| `capMs`       | number | 30000   | The delay never exceeds this       |

The delay doubles per attempt from `baseMs`: 500, 1000, 2000, and never past
the cap.

## When a retry happens

The hook fires only when a provider turn failed — a refused turn that spent
money and wall clock and produced nothing. A failed turn delivers no usage
payload, so it commits no usage; the run's only trace of it is the `retry`
record, which carries the attempt number, the cap, the delay, and the error
class, so a reader can see how long the run waited and why.

Only four error classes are worth another attempt: `rate_limit`,
`overloaded`, `unreachable`, and `server_error`. An auth failure, a missing
model, and a billing problem do not improve by being asked again.

An answer that arrived and did not conform is a repair, not a retry — this
plugin never sees one.

## What it does not do

It writes no record and sleeps for nobody; core does both with the decision
it returns. The delay carries no jitter.

## API

- `providerRetry` — the plugin definition, id `eva.provider.retry`. It reads
  the options above and answers the `provider.retry` hook.
- `RETRYABLE` — the set of the four error classes another attempt can fix.
- `DEFAULTS` — `{ maxAttempts: 3, baseMs: 500, capMs: 30000 }`.
- `backoff(attempt, options?)` — the delay in milliseconds: exponential from
  `baseMs`, capped at `capMs`.
- `shouldRetry(errorClass, attempt, options?)` — whether the class is
  retryable and the attempt cap is not reached.
- `BackoffOptions` — the options type the two functions take.

## Development

Tests live in [src/index.test.ts](src/index.test.ts). The run-level half — a
refused attempt becomes a `retry` record inside the same open run — is
core's, held by
[packages/core/src/hooks.test.ts](../../packages/core/src/hooks.test.ts).
Run the suite from the repository root:

```bash
bun run test
```
