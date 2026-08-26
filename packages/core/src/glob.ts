// Characters a regular expression reads and a glob pattern does not.
const LITERAL = /[.+^${}()|[\]\\]/g

const expressionOf = (pattern: string): string => {
  let out = ""
  let index = 0
  while (index < pattern.length) {
    const rest = pattern.slice(index)
    // A double star followed by a separator crosses any number of segments,
    // and matches none of them as well.
    if (rest.startsWith("**/")) {
      out += "(?:[^/]+/)*"
      index += 3
      continue
    }
    if (rest.startsWith("**")) {
      out += ".*"
      index += 2
      continue
    }
    const one = rest.charAt(0)
    if (one === "*") out += "[^/]*"
    else if (one === "?") out += "[^/]"
    else out += one.replace(LITERAL, "\\$&")
    index += 1
  }
  return `^${out}$`
}

/**
 * What a glob pattern means, for every FileSystem. `*` matches any run of
 * characters inside one path segment, `?` matches one character in a
 * segment, and a double star crosses segments. A double-star segment matches
 * nothing at all as well, so a pattern that opens with one finds a file at
 * the root. Nothing else is special: no braces, no character classes, and a
 * leading dot is an ordinary character.
 *
 * A path is relative to the root, and its segments are separated by `/`.
 *
 * The rule lives beside the contract because two fillers of one Slot must
 * answer the same paths — one walking a disk and one walking a map — and a
 * rule each spelled for itself is two rules.
 */
export const globMatcher = (pattern: string): ((path: string) => boolean) => {
  const expression = new RegExp(expressionOf(pattern))
  return (path) => expression.test(path)
}
