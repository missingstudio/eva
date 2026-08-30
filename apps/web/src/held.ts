import { useEffect, useState } from "react"

/**
 * One answer the whole page reads, and everything drawing it.
 *
 * A page draws one fact in more than one place — what the far side last
 * refused is under the composer and beside the control that was pressed, and
 * the theme is on the rail and behind every rule — so one page keeps one
 * answer. Two copies of it would be a control that says one thing while the
 * page shows another.
 *
 * It is held outside the components rather than in a Context, because it
 * outlives them: a reader drawn after the change reads what changed rather
 * than the value the page started on.
 */
export interface Held<A> {
  // What is held now, for a caller that is not drawing.
  readonly now: () => A
  // The new answer, told to every reader at once.
  readonly tell: (now: A) => void
  // Draws this reader from now on, until the returned call lets it go.
  readonly reading: (wake: (now: A) => void) => () => void
}

export const holding = <A>(first: A): Held<A> => {
  let held = first
  const readers = new Set<(now: A) => void>()

  return {
    now: () => held,
    tell: (now) => {
      held = now
      for (const wake of readers) wake(now)
    },
    reading: (wake) => {
      readers.add(wake)
      return () => void readers.delete(wake)
    },
  }
}

// What is held, drawn. The value is read again on mount, so a component drawn
// after a change reads the change rather than what the page started on.
export const useHeld = <A>(one: Held<A>): A => {
  const [shown, setShown] = useState(one.now)

  useEffect(() => {
    setShown(one.now())
    return one.reading(setShown)
  }, [one])

  return shown
}
