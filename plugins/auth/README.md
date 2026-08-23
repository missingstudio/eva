# @missingstudio/eva-auth

The credential plugin for [Eva](../../README.md). It answers the question of
what authenticates Eva to a provider: an API key read from the environment,
or a login stored on disk. The configured mode alone decides which one a
provider turn uses — there is no precedence chain, because the failure a
chain produces is a stale exported key silently outranking the login somebody
just completed, billing an account they did not choose.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
fills the `CredentialStore` slot that
[`@missingstudio/eva-core`](../../packages/core/README.md) defines; the
provider plugins read it when they resolve a model. The glossary in
[docs/context.md](../../docs/context.md) defines **Credential**, and
[architecture.md](../../docs/reference/architecture.md) describes slots.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The public API returns `Effect` values.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-auth": "workspace:*" } }
```

## Usage

With no config at all, an exported key is the whole setup. The built-in
`ENV_KEYS` map `anthropic` to `ANTHROPIC_API_KEY` and `openai` to
`OPENAI_API_KEY`:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
eva
```

The plugin declares two options in a `.eva` config file. `authStore` names
the file the durable half writes — `~/.eva/auth.json` by default — and `env`
maps a namespace to its environment variable name, merged over the built-in
`ENV_KEYS`. That is how an endpoint that
[`@missingstudio/eva-provider-compatible`](../provider-compatible/README.md)
names in config reaches the environment too:

```yaml
plugins:
  - id: eva.auth
    options:
      env:
        together: TOGETHER_API_KEY
```

A per-provider mode is read by name from the same options, under the key
`<namespace>.auth` — `api_key` (the default) or `oauth`. Under `api_key` the
environment is read and a stored login is ignored; under `oauth` the stored
login is read and an exported key is ignored.

## How the store works

The file store writes through a temporary file and a rename, so a crash
mid-write leaves the previous store rather than half of the new one. The file
is `0600` in a `0700` directory, and a missing or unreadable file reads as
empty — a provider turn then fails with `missing`, which names the fix.

An oauth login is renewed inside a sixty-second window before expiry, once
per id however many provider turns start together, and the renewed token is
persisted before it is answered with. A refresh that fails re-reads the store
first: a refresh token is single-use, and another process sharing the store
may have rotated it. The plugin also writes one integration row per provider:
how it would authenticate, and whether that way is live.

## What it does not do

Nothing performs a login yet. `OAUTH_PROVIDERS` is empty — Anthropic is
absent by decision, not omission: its consumer-subscription OAuth client
belongs to Claude Code and is not offered to third-party tools. The plugin
wires no refresher either, so a stored login that expires fails with
"nothing can renew it".

## API

- `auth` — the plugin definition, id `eva.auth`. It reads the options above
  and provides the `CredentialStore` slot.
- `makeCredentialStore(options: StoreOptions)` — the two modes behind one
  store: environment under `api_key`, the durable store under `oauth`.
- `makeFileStore(options: FileStoreOptions)` — the durable half: the JSON
  file, the renewal, the single-flight refresh.
- `defaultStorePath(home)` — `<home>/.eva/auth.json`.
- `ENV_KEYS` — the built-in namespace-to-variable map.
- `OAUTH_PROVIDERS` — which providers may hold an oauth login; empty.
- `modeOf(options, id)` — reads `<id>.auth` and answers the mode.
- `CredentialError` — re-exported from core; carries the id and a reason.
- `Refresher`, `FileStoreOptions`, `StoreOptions` — the option types.

## Development

Tests live in [src/index.test.ts](src/index.test.ts) (the mode boundary) and
[src/store.test.ts](src/store.test.ts) (the durable half). The meeting with
`eva.provider.compatible` is held in
[packages/conformance/src/compatible.test.ts](../../packages/conformance/src/compatible.test.ts).
Run the suite from the repository root:

```bash
bun run test
```
