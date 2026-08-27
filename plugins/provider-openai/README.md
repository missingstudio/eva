# @missingstudio/eva-provider-openai

The OpenAI provider plugin for [Eva](../../README.md). It connects Eva to the
OpenAI Responses API: it answers every model reference in the `openai`
namespace and streams one provider turn into payloads of Eva's one event
schema.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
answers the `model.resolve` hook that
[architecture.md](../../docs/reference/architecture.md) describes, and reads
its credential from the `CredentialStore` slot that
[`@missingstudio/eva-auth`](../auth/README.md) fills. The glossary in
[docs/context.md](../../docs/context.md) defines the terms used here.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The public API returns `Effect` values.
- An OpenAI API key.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-provider-openai": "workspace:*" } }
```

## Usage

Export a key and start Eva:

```bash
export OPENAI_API_KEY=sk-...
eva
```

Pick a model for one run with the global `--model` flag. The part before the
slash is the namespace this plugin claims:

```bash
eva --model openai/gpt-5.4
```

The plugin declares one option, `maxTokens`. Unset, it omits
`max_output_tokens` and leaves the provider's own ceiling in place — a cap
invented here would truncate an answer OpenAI would have finished:

```yaml
plugins:
  - id: eva.provider.openai
    options: { maxTokens: 32000 }
```

## How a turn is mapped

Every request goes out with `store: false` and no `previous_response_id`. Eva
sends the whole transcript on every provider turn, so the trace stays the
only record of the run. The SDK client runs with zero retries of its own —
the retry decision belongs to
[`@missingstudio/eva-provider-retry`](../provider-retry/README.md), on the
record.

The usage mapping does two things worth naming. OpenAI's cached count is a
subset of `input_tokens`, so it is subtracted here or those tokens bill twice
at two rates. The reasoning count stays inside `output_tokens`, because
OpenAI bills it there. The payload names the model the response reported — a
dated id such as `gpt-4o-mini-2024-07-18` — and a dated id still prices from
the undated catalog row.

Failures carry one of the eight error classes. A 429 that carries
`insufficient_quota` reads as `billing`, not `rate_limit` — a dead account is
not a failure the retry policy should keep asking again. The plugin resolves
even when no credential is found: `available()` then answers false, so the
run closes `auth_failed` rather than `no_such_model`.

## What it does not do

It does not speak Chat Completions — that wire belongs to
[`@missingstudio/eva-provider-compatible`](../provider-compatible/README.md),
and the two share nothing on purpose. It reports no cost, because OpenAI
reports counters and never what a request cost.

It does not carry `ProviderRequest.tools`, so a Harness that offers tools over
this namespace is offered none back and its Prompt ends at the first Step.
Carrying them is this plugin's own change and reaches no other.

## API

- `providerOpenAI` — the plugin definition, id `eva.provider.openai`.
- `makeOpenAIProvider(options: OpenAIOptions): Provider` — builds the
  provider directly. Options: `credential`, `maxTokens`, and an injectable
  `client` for tests.
- `PROVIDER_ID`, `NAMESPACE` — `"eva.provider.openai"` and `"openai"`. The
  first names the plugin in a `ProviderError`; the second appears in a model
  reference, the `usage.model` prefix, and as the credential id.
- `classify(cause): ErrorClass` — maps an SDK failure to one error class.
- `toStopReason(settled, refused)` — reads the stop reason from the response
  status and the refusal delta.
- `toUsage(model, usage)` — maps the API's counters to one usage payload.
- `toInput(history)` — folds transcript messages into API input.
- `makeBlocks()` — mints one stable block number per content part.
- `REPORTS_COST` — `false`: OpenAI reports counters, never a request cost.

## Development

Tests live in [src/index.test.ts](src/index.test.ts), which boots the plugin
through the testkit, and [src/provider.test.ts](src/provider.test.ts), which
drives a fake SDK stream through the mapping rules above. Run the suite from
the repository root:

```bash
bun run test
```
