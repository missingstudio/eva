/**
 * The browser's half of the wire, and the one entry point in this repository
 * that is not `.`: a page must not pull `node:http` into its bundle, so the
 * routes and the Transport ship behind two names. Nothing reachable from here
 * imports a `node:` module, ever.
 */
export * from "../wire.js"
export * from "./transport.js"
