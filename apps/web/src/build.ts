/**
 * Which build this page is. Injected by the build, because a page served as
 * static assets carries no manifest to read — `apps/cli/src/version.ts`
 * answers the same fact for the binary, and the release build injects it
 * there for the same reason.
 */
declare const EVA_WEB_VERSION: string | undefined
declare const EVA_WEB_BUILT_AT: string | undefined

const UNBUILT = "unbuilt"

export const VERSION = typeof EVA_WEB_VERSION === "string" ? EVA_WEB_VERSION : UNBUILT
export const BUILT_AT = typeof EVA_WEB_BUILT_AT === "string" ? EVA_WEB_BUILT_AT : UNBUILT

// One line, so a person reading the page and a person reading a bug report
// are looking at the same string.
export const buildLine = (version = VERSION, builtAt = BUILT_AT): string =>
  `${version} · ${builtAt}`
