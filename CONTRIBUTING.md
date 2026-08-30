# Contributing

This page is the short path: a clone, a green `verify`, and a plugin that
loads. It is everything you need to make a first change. The long documents
are listed at the end as reference, and not one of them is a prerequisite.

## Prerequisites

- [Bun](https://bun.sh) 1.4 or newer. It is the runtime, the package manager
  and the test runner, and it is the whole toolchain.
- Git.

No model key is needed for anything on this page, because no test calls a
model.

## A green verify

```bash
git clone https://github.com/missingstudio/eva.git
cd eva
bun install
bun run eva --version
bun run verify
```

A development run has no build step: `bun run eva` runs the CLI from source.

`bun run verify` is the gate at your desk. It checks the format, the lint
rules and the types, runs every test, and packs every package. CI runs the
same checks, so a green `verify` is a pull request that passes. Run it before
you push.

While you work, run one package rather than all of them:

```bash
bun run test plugins/tool-glob
bunx vp check plugins/tool-glob
```

`bunx vp check --fix` formats and fixes what a machine can.

## A plugin that loads

Every capability in Eva is a plugin, and the smallest one is fifteen lines.
Four files make one, and all four are here.

```bash
mkdir -p plugins/hello/src
```

**`plugins/hello/src/index.ts`** — a plugin that adds one command row:

```ts
import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

export const hello = define({
  id: "eva.hello",
  effect: Effect.fn("eva.hello")(function* (ctx) {
    yield* ctx.command.transform((draft) => {
      draft.set({
        id: "hello",
        description: "Says hello",
        run: (command) => Effect.sync(() => command.write("hello\n")),
      })
    })
  }),
})
```

The export is named, because the composition root imports it by that name. A
command writes through the context it is given and never through
`console.log`, because the surface owns the screen.

**`plugins/hello/src/index.test.ts`** — a test sits beside the source it
tests, because the runner looks for `plugins/*/src/**/*.test.ts`:

```ts
import { withPlugin } from "@missingstudio/eva-testkit"
import { describe, expect, it } from "vitest"
import { hello } from "./index.js"

describe("eva.hello", () => {
  it("registers a command row", async () => {
    const rows = await withPlugin(hello, (kernel) => kernel.domains.command.get)
    expect(rows.map((row) => row.id)).toContain("hello")
  })
})
```

**`plugins/hello/package.json`** — `exports` names the source, because nothing
in the workspace is built until it is packed:

```json
{
  "name": "@missingstudio/eva-hello",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "publishConfig": {
    "exports": {
      ".": {
        "types": "./dist/index.d.mts",
        "default": "./dist/index.mjs"
      }
    }
  },
  "scripts": {
    "pack": "vp pack"
  },
  "dependencies": {
    "@missingstudio/eva-sdk": "workspace:*",
    "effect": "catalog:"
  },
  "devDependencies": {
    "@missingstudio/eva-testkit": "workspace:*",
    "@types/node": "catalog:",
    "typescript": "catalog:"
  }
}
```

The formatter reads this file too, so keep one key per line. A manifest
written compact fails `bun run verify` on the format check alone.

**`plugins/hello/tsconfig.json`** — every package states the environment it
runs in, and a plugin runs on Node:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"]
  },
  "include": ["src"]
}
```

## Register it

The Build is closed. There is no discovery, no directory scan and no
entry-point convention, so a plugin loads only where a composition root names
it. The one Build in this repository is the import table in
`apps/cli/src/plugins.ts`, and registering takes three edits.

**One.** Add the package to the dependencies of `apps/cli/package.json`:

```json
"@missingstudio/eva-hello": "workspace:*",
```

**Two.** Run `bun install`. The workspace links packages in isolation, so a
package the composition root does not name is a package it cannot import —
`Cannot find module` at run time, and TS2307 in every file at once.

**Three.** Add two lines to `apps/cli/src/plugins.ts`:

```ts
import { hello } from "@missingstudio/eva-hello"

export const BUILT_IN: readonly Plugin[] = [
  // ...
  hello,
]
```

The table is in load order, and the order carries meaning: transforms replay
in it, a same-id `set` later in it wins, and the first interactive surface
takes the interactive branch. Read the comments above the table before you
choose a position.

Now prove it:

```bash
bun run test plugins/hello
```

That is green, and the row is in the command domain the terminal draws its `/`
list from. Start `bun run eva` and press `/` to see it.

[docs/reference/writing-plugins.md](docs/reference/writing-plugins.md) is the
whole walkthrough: the config keys a plugin declares, cleaning up after
itself, filling a Slot and reading one.

## One change

1. Cut a branch, named `type/kebab-case-description`.
2. Make the smallest correct change, and keep the package boundaries.
3. Run the package's tests while you work, and `bun run verify` before you
   push.
4. Commit one logical change. Work that spans more gets more commits.

A commit message is `type(scope): description` — lowercase, no full stop, and
the description is a sentence that says what is true after the change:
`fix(kernel): a plugin loads whole, or not at all`.
[AGENTS.md](AGENTS.md) owns both rules in full.

## The pull request

Open it against `main`. The template asks what changed, why, and what you ran.
CI runs the same checks `verify` does, and a change merges when they pass.

Write prose the way the repository writes it: short literal sentences, in the
words the glossary already uses.

## Where to read more

None of these is needed for a first change.

|                                                                        |                                                 |
| ---------------------------------------------------------------------- | ----------------------------------------------- |
| [docs/README.md](docs/README.md)                                       | The map of every document                       |
| [docs/reference/writing-plugins.md](docs/reference/writing-plugins.md) | The whole plugin walkthrough                    |
| [docs/context.md](docs/context.md)                                     | The glossary. One concept, one name             |
| [docs/architecture.md](docs/architecture.md)                           | The shape of the whole system                   |
| [docs/reference/command-line.md](docs/reference/command-line.md)       | Every command and flag                          |
| [docs/reference/toolchain.md](docs/reference/toolchain.md)             | The build, the test runner, and CI's jobs       |
| [docs/development.md](docs/development.md)                             | Running Eva on Eva, and where each stage stands |
