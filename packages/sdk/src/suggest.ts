// Edit distance, one row at a time: enough to rank near misses, and small
// enough to carry rather than take a dependency for.
const distance = (one: string, other: string): number => {
  let row = Array.from({ length: other.length + 1 }, (_, at) => at)
  for (let here = 1; here <= one.length; here += 1) {
    const next = [here]
    for (let there = 1; there <= other.length; there += 1) {
      const swap = one[here - 1] === other[there - 1] ? 0 : 1
      next[there] = Math.min(
        (next[there - 1] ?? 0) + 1,
        (row[there] ?? 0) + 1,
        (row[there - 1] ?? 0) + swap,
      )
    }
    row = next
  }
  return row[other.length] ?? one.length
}

/**
 * The candidate a word was most likely meant to be, or nothing when none is
 * close. A name that reached nothing is usually a misspelling of one that
 * would have worked, and naming the replacement saves the reader from
 * reading a list. The tolerance grows with the candidate's length, so a
 * short name needs a near-exact match and a long one forgives more.
 */
export const nearest = (word: string, candidates: readonly string[]): string | undefined => {
  const near = candidates
    .map((candidate) => ({ candidate, away: distance(word, candidate) }))
    .filter((one) => one.away <= Math.max(2, Math.floor(one.candidate.length / 3)))
    .sort((one, other) => one.away - other.away)
  return near[0]?.candidate
}
