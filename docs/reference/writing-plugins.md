# Writing a plugin

Everything in Eva except the kernel is a plugin. This is how you write one.

Read [architecture.md](architecture.md) first — it defines the four extension
points a plugin registers into (domain, slot, hook, broadcast) and the contract
it implements. This page is the walkthrough.

## 1. The smallest one

```ts
import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

export default define({
  id: "eva.hello",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.command.transform((command) => {
      command.set({
        id: "hello",
        description: "Says hello",
        run: () => Effect.sync(() => console.log("hello")),
      })
    })
  }),
})
```

**A row arrives whole.** `set` registers the Info the domain holds, and
replacing one keeps its position. `update` edits a row that already exists and
leaves alone an id nothing registered — use it only to add to another plugin's
row, the way `eva.print` supplies the `run` for the `/cost` that `eva.commands`
describes.

**A transform replays.** The domain is rebuilt from initial state on every
plugin load, unload, and replace, and every registered transform runs again
each time. So a transform is a pure edit of its draft: no I/O, no side
effects, nothing counted outside it. Work that runs once — a fetch, a file
read — belongs in the plugin's effect, before the `transform` call; the
transform closes over the result and registers the fact. For the same reason
a Domain holds only what transforms put there: state that accumulates at
runtime lives behind a Slot or in the Trace, because the next rebuild wipes
anything else without a word.

## 2. Naming the config keys you read

A plugin declares the keys it reads, and reads them through that declaration.
A key nothing declares reached nothing, and a run names it against the file
that set it — so an undeclared option looks like a typo to whoever wrote it.

```ts
import { declare, define } from "@missingstudio/eva-sdk"

const KEYS = declare({ greeting: "string" })

export default define({
  id: "eva.hello",
  reads: KEYS.shapes,
  effect: Effect.fn(function* (ctx) {
    const greeting = KEYS.read(yield* ctx.config, "greeting", "hello")
    yield* Effect.log(greeting)
  }),
})
```

`declare` returns both halves: `shapes` goes beside the id, and `read` takes a
key it declared. A key spelled two ways used to compile — declared `greeting`,
read `greetings`, accepted in config and then ignored. Now the second spelling
is checked against the first, and the shape decides what comes back, so a key
declared `number` cannot be read with a string default.

The shapes are `string`, `number`, `boolean`, `list`, `mapping`, and `name` —
`name` takes a bare string or a mapping with an `id`. The sweep that reports a
misshapen key asks the same reader, so a value it passes is a value you can
read.

**Options under your own `plugins` entry are declared too**, as `takes`, and
they arrive on `ctx.options` rather than `ctx.config`:

```ts
const OPTIONS = declare({ maxAttempts: "number" })

export default define({
  id: "eva.hello",
  takes: OPTIONS.shapes,
  effect: Effect.fn(function* (ctx) {
    const attempts = OPTIONS.read(ctx.options, "maxAttempts", 3)
  }),
})
```

Only the top level used to be swept, so `maxAttmpts:` under a plugin entry fell
back to the default in silence while the same mistake one level up was named.
For a key whose name is known only when it runs — `eva.auth` reads
`<provider>.auth` — `stringOption` reads one by name.

## 3. Cleaning up

Anything registered through `ctx` is removed when the plugin unloads. For a
resource the kernel does not own, attach a finalizer. **The finalizer is an
`Effect`, not a function.**

```ts
effect: Effect.fn(function* (ctx) {
  const scope = yield* Scope.Scope
  const timer = setInterval(() => console.log("heartbeat"), 5000)
  yield* Scope.addFinalizer(
    scope,
    Effect.sync(() => clearInterval(timer)),
  )
})
```

`Scope.addFinalizer(scope, () => clearInterval(timer))` does not compile in
Effect v4. The signature is `addFinalizer(scope: Scope, finalizer:
Effect<unknown>)`. Use `Effect.sync`. The function form is `addFinalizerExit`,
and its argument is the exit.

## 4. Filling a slot

```ts
export default define({
  id: "eva.trace.memory",
  effect: Effect.fn(function* (ctx) {
    const events: Event[] = []
    yield* ctx.slot.traceSink.provide(ctx.id, {
      append: (group) =>
        Effect.sync(() => {
          events.push(...group)
          return group
        }),
      replay: (session) => Stream.fromIterable(events.filter((one) => one.session === session)),
      sessions: Effect.sync(() => [...new Set(events.map((one) => one.session))]),
      close: Effect.void,
    })
  }),
})
```

## 5. Reading a slot

Read at the point of use with `peek`, and never capture.

A slot may be empty, and that is Degraded rather than an error. Answer for
your own capability and carry on: nothing filling the credential store means
the Run reports `auth_failed`, and nothing filling the trace sink means the
Recorder marks the Run rather than ending it.

```ts
// Correct: reads the current implementation each time, and degrades.
const commit = Effect.fn(function* (payloads: Payload[]) {
  const recorder = yield* ctx.slot.recorder.peek
  if (recorder === undefined) return

  yield* recorder.commit(payloads)
})

// Wrong: holds an implementation that hot replace will invalidate.
const recorder = yield * ctx.slot.recorder.peek
const commit = (payloads: Payload[]) => recorder?.commit(payloads)
```

`get` answers the same value and dies when the slot is empty. It is what a
test reaches for once it has filled the slot; a plugin uses `peek`, because a
plugin that dies on an empty slot ends a Run the design says should continue.

## 6. Adding a package

```bash
mkdir -p plugins/my-plugin/src
```

A test file sits beside the source it tests: the globs are
`plugins/*/src/**/*.test.ts`, so a `test/` directory holds tests nothing runs.

`plugins/my-plugin/package.json`:

```json
{
  "name": "@missingstudio/eva-my-plugin",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "publishConfig": {
    "exports": { ".": { "types": "./dist/index.d.mts", "default": "./dist/index.mjs" } }
  },
  "scripts": { "pack": "vp pack" },
  "dependencies": {
    "@missingstudio/eva-sdk": "workspace:*",
    "@missingstudio/eva-core": "workspace:*",
    "effect": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "typescript": "catalog:"
  }
}
```

`plugins/my-plugin/tsconfig.json` — every package states its environment, and a
plugin runs on Node:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src"]
}
```

Without this file the package has no program of its own and nothing checks it.
[toolchain.md](toolchain.md) §3 has the rule about what a leaf may set.

**`exports` points at source; `publishConfig.exports` points at `dist`.** In the
workspace nothing has been packed yet, so a manifest that names `dist/index.mjs`
resolves to a file that does not exist and every importer fails until someone
runs `vp pack`. Bun rewrites `exports` from `publishConfig` at publish time, so
the published package still names the built files. Get this backwards and the
failure arrives at import time in development, or at publish time in CI —
neither of them where you made the mistake.

The `dist` names are not arbitrary. tsdown writes `dist/index.mjs`,
`dist/index.d.mts`, and `dist/index.mjs.map`; a `./dist/index.js` entry copied
from another repo points at nothing.
