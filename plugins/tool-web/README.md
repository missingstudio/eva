# @missingstudio/eva-tool-web

The web tool for [Eva](../../README.md). It reads one http or https address
and answers what it holds. It is the one tool of this stage that reaches past
the workspace.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
registers a row in the `tool` domain that
[`@missingstudio/eva-sdk`](../../packages/sdk/README.md) declares. It fills no
slot and reads none: there is no `Fetcher` slot, so the reader that speaks
HTTP is handed to the row when the plugin loads. The glossary in
[docs/context.md](../../docs/context.md) defines **Domain**, **Transform** and
**Slot**, and [architecture.md](../../docs/reference/architecture.md) §4 and
§6 own the domain and the tool boundaries.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). A tool answers an `Effect`.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-tool-web": "workspace:*" } }
```

## Usage

The plugin takes no options. It registers the row and nothing else, so a build
that must not reach the network leaves the plugin out:

```yaml
plugins:
  - id: eva.tool.web
    enabled: false
```

The model calls it `web` and hands it one field:

```json
{ "url": "https://effect.website/docs" }
```

## How a call answers

- One GET, and the body as text. A status inside 2xx is an `ok` result
  carrying the body.
- A status outside 2xx is a `failed` result carrying the status, because the
  model recovers from the number and not from a body a server wrote for a
  browser.
- An address that is not http or https is refused before anything is read:
  `file:` and `data:` reach past the workspace, and the `FileSystem` slot is
  the only way to a file.
- An address nothing answered is a `failed` result carrying what the socket
  said. Nothing throws.

## How it stays testable with no network

The reader is a parameter. `webTool({ get })` takes the one function that
leaves the machine, and the plugin hands in `overFetch` — three lines over the
global `fetch`. A suite hands in its own reader and needs no network, and the
plugin's own end-to-end test binds a server on a loopback port, so `verify`
never reaches beyond this machine.

There is no `Fetcher` slot for the same reason: this stage adds four slots and
a fifth is not one of them. A stage that needs two fetchers — a proxy, a
cache, a recorded cassette — is the stage that adds the seam.

## What it does not do

- It does not follow a redirect chain of its own, beyond what `fetch` follows.
- It does not convert HTML to text, and it does not cap what it answers.
- It does not decide whether the call may run. That is the
  `tool.execute.before` boundary, and an address is exactly the kind of
  argument a gate reads.

## API

- `toolWeb` — the plugin definition, id `eva.tool.web`. It registers the `web`
  row in the `tool` domain, with `overFetch` as its reader.
- `webTool(deps: WebDeps): ToolInfo` — the row, for a suite that hands in its
  own reader.
- `overFetch: Reading` — the reader over the global `fetch`.
- `WebError` — what a reader fails with when nothing answered.

## Development

Tests live beside the sources: [src/web.test.ts](src/web.test.ts) holds what a
call answers, against readers a test hands in, and
[src/index.test.ts](src/index.test.ts) holds the row and two calls end to end
over a loopback server. Run the suite from the repository root:

```bash
bun run test
```
