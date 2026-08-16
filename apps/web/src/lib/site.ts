import { links } from "@missingstudio/eva-brand"
import data from "./site-data.json" with { type: "json" }

export const site = links(import.meta.env.DEV)

/**
 * Live numbers, fetched at build time by scripts/site-data.ts and committed
 * as a fallback. Nothing here runs in the browser, so the page renders
 * correctly with JavaScript disabled and can never be more than one deploy
 * stale.
 */
export const siteData: { version: string; stars: number | null } = data
