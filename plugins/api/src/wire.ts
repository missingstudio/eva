import type { ModelRef, SessionHeader } from "@missingstudio/eva-core"
import { sessionID } from "@missingstudio/eva-schema"

export const API_PLUGIN = "eva.api"

/**
 * Where the wire is. The paths are rooted and never absolute, because one
 * port serves the page and the calls: the page asks the host that served it,
 * and no address is built into the artifact.
 */
export const API_ROOT = "/api"
export const SESSIONS = `${API_ROOT}/sessions`

export const modelPath = (session: string): string =>
  `${SESSIONS}/${encodeURIComponent(session)}/model`

/**
 * What travels: the contract's own shapes, with nothing wrapped around them.
 * `SessionHeader` and `ModelRef` are JSON already, so the wire adds no
 * envelope and no rendering — and the half that reads a shape is the half
 * that says whether what arrived is one.
 *
 * The readers live beside the paths rather than in the client, because both
 * halves of one wire have to agree about a shape and a copy of an agreement
 * is one that keeps passing after the agreement moves.
 */
const objectIn = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const stringAt = (row: Record<string, unknown>, name: string): string | undefined => {
  const found = row[name]
  return typeof found === "string" ? found : undefined
}

export const headerIn = (value: unknown): SessionHeader | undefined => {
  const row = objectIn(value)
  if (row === undefined) return undefined
  const id = stringAt(row, "id")
  if (id === undefined) return undefined

  const title = stringAt(row, "title")
  const updatedAt = stringAt(row, "updatedAt")
  return {
    id: sessionID(id),
    ...(title === undefined ? {} : { title }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  }
}

export const headersIn = (value: unknown): readonly SessionHeader[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const listed: readonly unknown[] = value

  const rows: SessionHeader[] = []
  for (const one of listed) {
    const row = headerIn(one)
    // One row this cannot read makes the whole listing unreadable. A Session
    // dropped in silence is worse than a call that waits and asks again.
    if (row === undefined) return undefined
    rows.push(row)
  }
  return rows
}

export const modelIn = (value: unknown): ModelRef | undefined => {
  const row = objectIn(value)
  if (row === undefined) return undefined
  const provider = stringAt(row, "provider")
  const model = stringAt(row, "model")
  return provider === undefined || model === undefined ? undefined : { provider, model }
}
