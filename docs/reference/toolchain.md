# Toolchain

How this repository is built and checked, and what each CI job is for. The
architecture it builds is in [architecture.md](architecture.md); the stage each
package arrives in is in [roadmap.md](../roadmap.md); the workflow fleet, the
release, and the install channels are in [ci-cd.md](ci-cd.md).

## 1. Vite+ and Bun

Vite+ is the VoidZero stack behind one CLI, `vp`. It wraps Vite, Rolldown,
Vitest, Oxlint, Oxfmt, tsdown, and Vite Task into one dependency, `vite-plus`.
Eva runs it on Bun.

| Concern             | `vp` command                        | Under the hood                       |
| ------------------- | ----------------------------------- | ------------------------------------ |
| Package management  | `vp install`, `vp add`, `vp remove` | detected from `bun.lock`             |
| Lint, format, types | `vp check`                          | Oxfmt, Oxlint, tsgolint — one pass   |
| Testing             | `vp test`                           | bundled Vitest                       |
| Package scripts     | `vp run <script>`                   | Vite Task — cached, dependency-aware |
| Packaging           | `vp pack`                           | tsdown + Rolldown                    |

`vp build` is absent from that table on purpose. It builds a Vite app, and this
repository ships no Vite app — the binary and every package are produced by `vp
pack`. `bun run build` is `vp run -r build`, and the only `build` script in the
tree, `apps/cli`, runs `vp pack` too.

One lockfile and one `tsconfig.base.json`. There are two `vite.config.ts`: the
root one below, and `apps/cli/vite.config.ts`, which sets `pack.noExternal` so
the workspace packages are bundled into the binary rather than left as bare
imports Node cannot resolve from source.

Bun is the target runtime because OpenTUI's renderer needs FFI. Under Bun, FFI
is in the runtime. Under Node it needs 26.4.0 with `--experimental-ffi`, plus
`--allow-ffi` and a filesystem grant when the permission model is on.

That asymmetry stops at one module: `packages/tui-renderer/src/renderer.tsx`. The
composition root reaches it through a dynamic import, so Node never loads it —
the stream renderer draws the same `Frame` there instead. Everything else runs on
Node with no flags, and `vp test` proves it on every push: Vitest runs its
workers under Node 22, not under Bun, so every test in the tree answers under
the runtime its package claims. §5 says what this leaves unproven.

## 2. Versions and the gate

Read the root `package.json` for the current lists. Four things in it are
decisions rather than housekeeping.

**The catalog holds every shared version.** A package writes `"effect":
"catalog:"`, never a number, so a bump happens in one place and cannot half-land.

**`effect` is pinned exactly, with no range.** v4 is a release candidate:
`4.0.0-rc.109` is the current `rc` tag and `latest` on npm is still v3. One
surveyed harness runs `4.0.0-beta.83` with a patch, which is a fair signal of
how much the line still moves.

**`@types/node` is pinned to the 22 line, not the newest.** `engines` accepts
Node 22.13 as the oldest runtime — the release where `node:sqlite` stopped
needing a flag — so types from a later release would let a
package call an API that runtime lacks, and nothing would fail until someone ran
it there.

**`vitest` is a direct devDependency even though Vite+ bundles Vitest.** Every
test file writes `import … from "vitest"`, and a declared import must not resolve
through a hoisted transitive dependency. The catalog pins it to the exact version
`vite-plus` carries, so the tree never holds two copies of Vitest.

`verify` is the desk gate — `vp check && vp test && vp run -r pack && bun audit
--audit-level=high`. CI runs `check` and `test` the same way, then `build` in
place of `pack`. The audit step is `audit.yml`'s, for the reason
[ci-cd.md](ci-cd.md) §8 gives. `build` and `pack` are not the same step, and §5
says what that costs.

## 3. One base, one tsconfig per package

`tsconfig.base.json` holds compiler settings only:

```json
{
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024"],
    "module": "preserve",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "noEmit": true,
    "skipLibCheck": true
  }
}
```

Nothing environment-specific lives there. `lib` and `types` are the two settings
a package varies, and they are the only two, so the base can state what is true
everywhere and stay silent about the rest.

Every package carries a `tsconfig.json`, and every one of them is four lines:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src"]
}
```

**A leaf sets `lib`, `types`, and `include`. Nothing else.** Strictness, module
mode, resolution, and target belong to the base, in every package, in every
environment. A leaf that needs to override one of them is a bug in the leaf or a
bug in the base, and either way it is a conversation rather than a config line.
Three leaves differ from the shape above today: `packages/schema` also
includes `fixtures`, `packages/exit-test` also includes `scripts`, and
`apps/cli` also includes its `vite.config.ts`.

The root `tsconfig.json` is no longer a program over the tree. It covers the one
loose file and gives the editor a fallback:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["vite.config.ts"]
}
```

**The compiler holds the runtime boundary.** A portable package claims `node` and
nothing else, so the `Bun` global, `document`, and `import … from "bun:ffi"` each
fail to compile in it.

That guarantee is only as strong as the claim, and a leaf can widen its claim in
one line. This is why the Oxlint `no-restricted-globals` rule stays: it reads the
code rather than the config, so it rejects the `Bun` global in every package
however that package writes its `types`. Widen `types` to `["node", "bun"]` and
the compiler goes quiet while lint still fails the build. `vp check` runs both,
and `vp test` answers under Node behind them (§1).

So a package that needs a Bun capability asks for it by feature — `bun:ffi`,
named in its own `types` — and never through the `Bun` global, which nothing may
use.

The environment a package claims is the whole point. A browser surface claims
`"lib": ["es2024", "dom", "dom.iterable"]` with `"types": []`; an Electron shell
claims `"types": ["node", "electron"]`; a worker claims `"lib": ["es2024",
"webworker"]`. One program could not have held any of them, because widening
`lib` for the browser hands `document` to the kernel, and lint cannot fix the
other direction at all — it bans a global that exists, it cannot declare one that
is missing.

A browser leaf writes `"types": []` rather than leaving the field out. With no
`types` field the compiler walks `node_modules/@types` upward and takes every
ambient package it finds, which is how Node globals reach a browser program by
accident. The empty array says nothing ambient is wanted, and DOM arrives through
`lib` instead.

**A leaf extends `tsconfig.base.json`, whatever framework it holds.** Expo and
Astro both publish a base config of their own, and extending one instead of ours
takes that package out of every standard this file describes — silently, because
the package still compiles. Extend the base and add the framework's settings by
hand. A framework that cannot be reconciled that way is a decision to record, not
a config line to write.

**Electron is two environments in one app.** The main process is Node and the
renderer is a browser, and one `tsconfig.json` cannot hold both apart — the union
of the two is visible to each. Split main and preload into a package separate
from the renderer so each states its own environment.

Because packages resolve each other as source rather than as a built `dist`, a
package is checked once under its own environment and again inside every consumer
that imports it. A package the kernel and a browser surface both use has to
satisfy both, and the compiler proves it on every run.

**There are still no project references.** `noEmit` is on, so TypeScript
produces no output — tsdown does, through `vp pack`, reading each package's own
config. References exist to order and incrementalize emit. With no emit to
order, `composite` would only force declaration emit back into the check.

**Type checking is still one pass.** `vp check` reads every leaf config and
checks the whole tree in about a second. A per-package fan-out was measured
against it and lost — 3.0s to 1.4s — because a process per package costs more
than the checking does. When the tree is large enough for that to invert, each
package gains a `typecheck` script and `vp run -r typecheck` replays the
untouched ones from the Vite Task cache. That day is not close.

## 4. Root `vite.config.ts`

One file configures `pack`, `test`, `lint`, `fmt`, and `staged` for the whole
workspace. The largest block in it is `lint.overrides`, which carries the layer
rule as one `no-restricted-imports` pattern group per layer; that rule is
architecture rather than toolchain, and [architecture.md](architecture.md) §9.1
owns it. Beside it sits the `no-restricted-globals` ban on `Bun` from §3.

Four things about it are easy to get wrong.

**There are no `run.tasks`, and that is deliberate.** A task declared in this
file would run in the workspace root and nowhere else. Per-package work lives in
each package's own `scripts` block — `"pack": "vp pack"` — and the root drives it
with `vp run -r pack`. This is why `run.cache` turns caching on for **scripts**,
not only tasks.

**Nothing declares a task order.** Vite Task reads the `workspace:*` edges
already in the manifests, so `schema → core → kernel → sdk` falls out with no
`dependsOn` anywhere.

**`pack` emits `.mjs`, not `.js`.** tsdown writes `dist/index.mjs`,
`dist/index.d.mts`, and `dist/index.mjs.map`. Each package's `exports` must name
those files. A `./dist/index.js` entry copied from another repo points at nothing
and fails only at publish time.

**`test.include` lists four globs over three directories, and a new directory is
invisible until it is added.** Tests outside `apps/*/src`, `packages/*/src`, and
`plugins/*/src` run nowhere, and `passWithNoTests` keeps the suite green while
they do. `packages/exit-test` leans on exactly that line: its tests sit in
`src/`, so they run in `verify` on every push, while its recorder and runner sit
under `scripts/`, which the globs never reach — a run that needs a key, a
hundred minutes and $20 must not be in the gate, and the two deliberate generators
(`packages/schema/fixtures/generate.ts`, `plugins/catalog-prices/fixtures/generate.ts`)
are the precedent for that split.

## 5. CI

`vite-plus` is a devDependency, so `bun install` puts `vp` on the path. There is
no `setup-vp` action anywhere in this workflow — a second installer only adds a
way for two copies to disagree.

`.github/workflows/ci.yml` is the source of truth for how each job runs. What
each one is _for_ is below, because a job whose purpose is not written down gets
deleted the first time it is inconvenient.

| Job        | What fails it                                          |
| ---------- | ------------------------------------------------------ |
| `verify`   | `bun run check`, `bun run test`, or `bun run build`    |
| `rehearse` | the release path breaks on a change that can reach it  |
| `gate`     | a job it needs did not succeed, a skipped job included |

**Three jobs, and the count is a decision.** A job asserts something about the
tree, and so does a test — but a test says it in one file, runs at a desk, and
costs no runner. The guarantees that once had a job of their own are tests
instead:

| The guarantee                                    | Where it is asserted                    |
| ------------------------------------------------ | --------------------------------------- |
| every plugin disabled resolves to an empty build | `packages/kernel/src/config.test.ts`    |
| boot loads exactly what the config resolved to   | `packages/boot/src/boot.test.ts`        |
| a plugin unloads and reloads in one live process | `packages/kernel/src/plugin.test.ts`    |
| a disabled trace plugin degrades, never crashes  | `packages/boot/src/session.test.ts`     |
| a sink is swapped with no restart                | `packages/conformance/src/swap.test.ts` |

So `verify` covers nearly every way the tree itself can be wrong. `vp check`
holds the runtime boundary of §3 and type-checks every leaf, and `vp test` runs
the whole suite. A fourth job has to fail for a reason those two cannot, and
when a test can hold the guarantee instead, write the test.

`build` is the one step where CI and the desk part. `bun run build` is `vp run -r
build`, and `apps/cli` holds the only `build` script in the tree, so CI packs the
binary and nothing else. The desk's `vp run -r pack` packs every workspace
package. Nothing in CI does — `rehearse` compiles the binary and does not pack
the workspace either.

`rehearse` is the one job that is not about the tree, and
[ci-cd.md](ci-cd.md) §7 owns it. `gate` is the one check branch protection
requires, and [ci-cd.md](ci-cd.md) §1 says why it is a job rather than a list of
job names in a ruleset.

Add a job in the commit that makes it meaningful. A job that cannot fail is
worse than no job. A job written into this table before it exists in `ci.yml` is
worse still, because a reader trusts the table.

Every job installs with `bun install --frozen-lockfile`, never `vp install`. `vp`
delegates to the detected package manager, and going direct removes one layer of
guessing from the least-proven seam in the stack.

**Three things no workflow proves.** Each is named here rather than papered
over. A reader who trusts a green gate should know what the gate does not read.

**The rich renderer's draw.** `packages/tui-renderer/src/render-check.tsx` draws eleven
screens through the real `App` and asserts on `captureCharFrame()`. It cannot be
a test file: Vitest runs its workers under Node, and OpenTUI's renderer needs
Bun's FFI (§1). It is a Bun script instead, so `test.include` never reaches it
(§4). This is the rich renderer's only gate, and it runs by hand:

```bash
bun packages/tui-renderer/src/render-check.tsx
```

**Every package packing.** A package whose `exports` names a file `pack` never
writes fails at publish time and nowhere earlier (§4). `bun run verify` at a
desk is what catches it.

**The binary starting.** The tests above prove the config resolves to an empty
build and that boot loads what it resolved — the bare kernel in parts. Nothing
starts the packed CLI under Bun and under Node and asserts that it answers.

## 6. Day-to-day commands

```bash
bun install
```

```bash
vp check --fix
```

Run one package's tests by path. `vp test` hands its arguments to Vitest, which
filters by file path and rejects `--filter` outright — `--filter` is a `vp run`
flag and belongs to Vite Task, not to the test runner:

```bash
vp test packages/kernel
```

```bash
bun run verify
```
