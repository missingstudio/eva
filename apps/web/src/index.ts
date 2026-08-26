/**
 * What the page draws, and the one thing it does, for the suites that have to
 * hold the page against something else. `packages/conformance` drives the
 * terminal's mapping and this one from a single fold over the same Trace, and
 * it drives the page over the wire `eva.api` serves — and a plugin may not
 * import a plugin, so the page's half of both is named here rather than
 * reached for by a path.
 *
 * No hook is here: the views take what they draw as props, and the reads and
 * the router live in `routes.tsx`. `follow` is not a hook. It is the page's
 * own protocol over the Cursor — attach, watch from the fold's position, fold
 * again when the watch ends — and it is what converging after a drop and after
 * a reload means.
 */
export * from "./blocks.js"
export * from "./paths.js"
export * from "./session.js"
export * from "./title.js"
export { follow } from "./transcript.js"
