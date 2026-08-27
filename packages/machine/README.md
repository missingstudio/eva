# @missingstudio/machine

What both websites are built from, and what they serve a reader that is not a
person: the origins and the entities, the capability vocabulary, the documents
an agent fetches by name, the resource catalog, the JSON-LD graphs, the Agent
Skills index, and the content types a route answers with.

It renders nothing. `@missingstudio/ui` is the front-end system; this is the
set of facts underneath it, and the two are separate because they answer to
different readers.

## Usage

```ts
import { docSlugs, entity, origin } from "@missingstudio/machine"
import { markdown, plain } from "@missingstudio/machine/serve"
```

## It imports nothing

Not a style rule — a build constraint. `apps/www/vite.config.ts` reads
`agents.ts` and `apps/docs/vite.config.ts` reads `site.ts`, both through Node
rather than through the bundler. Node resolves a bare specifier without the
bundler's `.js`-means-`.ts` rule and fails on a package's own internal imports,
so one bare import anywhere in those two modules' graph breaks both builds.

`machine.test.ts` checks it. The rule used to live in a comment.

## The serve module knows no framework

`serve.ts` returns a `Response` and nothing else — no route options, no handler
shape. A route composes it; the Cloudflare worker path could too. It states
each format's content type once, the `Vary: Accept` a negotiated twin travels
with, and what a resource nobody wrote answers with.
