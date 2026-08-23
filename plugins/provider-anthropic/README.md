# @missingstudio/eva-provider-anthropic

The Anthropic provider plugin for [Eva](../../README.md). It connects Eva to
the Anthropic API: it answers every model reference in the `anthropic`
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
- An Anthropic API key.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-provider-anthropic": "workspace:*" } }
```

## Usage

Export a key and start Eva. The key never reaches a settings file, a log, or
the session record:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
eva
```

Pick a model for one run with the global `--model` flag. The part before the
slash is the namespace this plugin claims:

```bash
eva --model anthropic/claude-opus-5
```

The plugin declares one option, `maxTokens`. A set value wins; otherwise the
request's own value; otherwise 64,000 — this API demands a ceiling, so the
provider cannot leave it unset:

```yaml
plugins:
  - id: eva.provider.anthropic
    options: { maxTokens: 32000 }
```

## How a turn is mapped

A text delta becomes a `text` payload and a thinking delta a `thought`. A
delta the payload union has no kind for is preserved as `unknown` rather than
dropped. The stop reasons `max_tokens` and `refusal` map to themselves, a
stop sequence and `tool_use` read as `end_turn`, and a message that names no
reason reports none — silence is not `end_turn`.

Every failure carries one of the eight error classes: 401 and 403 are
`auth_failed`, 404 `no_such_model`, 429 `rate_limit`, 529 `overloaded`, 5xx
`server_error`, a billing error `billing` whatever the status, a connection
failure `unreachable`, and anything else `other`. The SDK client runs with
zero retries of its own — the retry decision belongs to
[`@missingstudio/eva-provider-retry`](../provider-retry/README.md), on the
record.

Two more rules. The plugin resolves even when no credential is found:
`available()` then answers false, so the run closes `auth_failed` rather than
claiming the model does not exist. And Anthropic reports token counts and
never a request cost, so `costTicks` stays absent on every usage payload —
the estimate belongs to the catalog's prices, not here.

## API

- `providerAnthropic` — the plugin definition, id `eva.provider.anthropic`.
- `makeAnthropicProvider(options: AnthropicOptions): Provider` — builds the
  provider directly. Options: `credential`, `maxTokens`, and an injectable
  `client` for tests.
- `PROVIDER_ID`, `NAMESPACE` — `"eva.provider.anthropic"` and `"anthropic"`.
  The first names the plugin in a `ProviderError`; the second appears in a
  model reference, the `usage.model` prefix, and as the credential id.
- `classify(cause): ErrorClass` — maps an SDK failure to one error class.
- `toStopReason(reason)` — maps Anthropic's stop reason to Eva's.
- `toMessages(history)` — folds transcript messages into API messages.
- `REPORTS_COST` — `false`: Anthropic reports counters, never a request cost.

## Development

Tests live in [src/provider.test.ts](src/provider.test.ts); they drive a fake
SDK stream through the mapping rules above. Run the suite from the repository
root:

```bash
bun run test
```
