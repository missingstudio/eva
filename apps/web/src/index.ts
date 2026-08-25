/**
 * What the page draws, for the one suite that has to hold it against another
 * renderer. `packages/conformance` drives the terminal's mapping and this one
 * from a single fold over the same Trace, and a plugin may not import a
 * plugin — so the page's half of that comparison is named here rather than
 * reached for by a path.
 *
 * Nothing here reads: the views take what they draw as props. The reads and
 * the router live in `routes.tsx`, and `main.tsx` is what a browser loads.
 */
export * from "./blocks.js"
export * from "./paths.js"
export * from "./session.js"
