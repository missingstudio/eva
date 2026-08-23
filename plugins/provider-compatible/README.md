# @missingstudio/eva-provider-compatible

The OpenAI-compatible provider plugin for [Eva](../../README.md). It connects
Eva to any endpoint that speaks the Chat Completions dialect — Ollama,
llama.cpp, vLLM, LM Studio, and the hosted compatibles — each named in
config. [`@missingstudio/eva-provider-openai`](../provider-openai/README.md)
owns the Responses API; the two plugins share nothing on purpose.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
answers the `model.resolve` hook for every namespace its config names, and
writes catalog rows so `/model` can list the endpoint's models — see
[architecture.md](../../docs/reference/architecture.md) for the extension
points and [docs/context.md](../../docs/context.md) for the glossary.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The public API returns `Effect` values.
- An endpoint that serves the Chat Completions API.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-provider-compatible": "workspace:*" } }
```

## Usage

Declare endpoints under the `providers` option in a `.eva` config file. Each
key becomes a namespace and a credential id:

```yaml
plugins:
  - id: eva.provider.compatible
    options:
      providers:
        ollama:
          api: http://localhost:11434/v1
          models: [qwen3-coder]
        together:
          api: https://api.together.xyz/v1
          credential: true
```

Then pick a model with the namespace you named:

```bash
eva --model ollama/qwen3-coder
```

| Key          | Type    | What it does                                                                                            |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------- |
| `api`        | string  | The base URL a curl would take; nothing is appended. Required — an entry without it claims no namespace |
| `name`       | string  | The catalog row's display name; defaults to the key                                                     |
| `credential` | boolean | Whether the endpoint needs a credential; default false                                                  |
| `models`     | list    | Model ids to list in the catalog. An unlisted reference still runs                                      |
| `maxTokens`  | number  | Omitted from the request when absent; the server's own default wins                                     |
| `usage`      | boolean | Whether to ask for usage counters; default true. Set false for a server that refuses `stream_options`   |

An entry with `credential: true` asks the `CredentialStore` for a credential
named like the entry — pair it with
[`@missingstudio/eva-auth`](../auth/README.md)'s `env` mapping to read it
from an environment variable. A keyless entry sends no Authorization header
at all.

## How it works

One plugin serves N providers, so each carries a compound id —
`eva.provider.compatible:ollama` — naming the endpoint rather than only the
plugin. In the CLI build (see
[apps/cli/src/plugins.ts](../../apps/cli/src/plugins.ts)) this plugin loads
after `eva.provider.openai`, so an entry named `openai` overrides the
first-party one: load order is the documented answer, and
[docs/decisions.md](../../docs/decisions.md) records why.

The catalog never learns models from the endpoint, because boot does no
network — the rows come from the `models` list. On the wire,
`reasoning_content` — the extension field compatible servers stream thoughts
in — becomes a `thought` payload, and a `content_filter` finish reason maps
to `refusal`. A server that reports no counters degrades to one usage payload
with every counter null; it never fails the run.

## What it does not do

It never asks an endpoint what models it serves, and it prices nothing: a
compatible namespace has no price, so a run against one reports its cost as
unknown rather than estimating.

## API

- `providerCompatible` — the plugin definition, id `eva.provider.compatible`.
- `makeCompatibleProvider(options: CompatibleOptions): Provider` — builds one
  provider directly, for one endpoint.
- `readEntries(providers)` — reads the raw `providers` mapping into
  `CompatibleEntry` values, one per namespace.
- `PLUGIN_ID` — `"eva.provider.compatible"`, the prefix of every compound id.
- `classify(cause): ErrorClass` — maps an SDK failure to one error class.
- `toStopReason(reason)` — maps a `finish_reason` to Eva's stop reason.
- `toUsage(namespace, model, usage)` — maps the API's counters to one usage
  payload, cached tokens subtracted.
- `toMessages(history)` — folds transcript messages into API messages.
- `makeBlocks()` — numbers runs of one delta kind, because this wire carries
  no block identity.

## Development

Tests live in [src/entry.test.ts](src/entry.test.ts) (config reading),
[src/index.test.ts](src/index.test.ts) (catalog rows and resolution), and
[src/provider.test.ts](src/provider.test.ts) (the wire mapping). The meeting
with `eva.auth` is held in
[packages/conformance/src/compatible.test.ts](../../packages/conformance/src/compatible.test.ts).
Run the suite from the repository root:

```bash
bun run test
```
