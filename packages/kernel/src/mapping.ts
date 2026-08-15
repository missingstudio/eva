/**
 * The merge law, in one place. Config and the resource directories both
 * produce mappings, so both merge by the same rules.
 */

export const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Every leaf path in a mapping, dotted. A list is a leaf, because a list
 * replaces rather than merges. An empty mapping is a leaf too, so a key
 * that sets nothing still names the file that set it.
 */
export const leaves = (raw: Record<string, unknown>, prefix = ""): readonly string[] =>
  Object.entries(raw).flatMap(([key, value]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`
    return isMapping(value) && Object.keys(value).length > 0 ? leaves(value, path) : [path]
  })

// Mappings merge key by key. A scalar or a list from the later layer wins.
export const deepMerge = (
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(over)) {
    const prior = merged[key]
    merged[key] = isMapping(prior) && isMapping(value) ? deepMerge(prior, value) : value
  }
  return merged
}
