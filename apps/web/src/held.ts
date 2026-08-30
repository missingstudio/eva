import { useEffect, useState } from "react"

/**
 * One answer the whole page reads, and everything drawing it.
 *
 * A page draws one fact in more than one place — what the far side last
 * refused is under the composer and beside the control that was pressed, the
 * listing is on the rail and behind the Session's own Header, and the theme is
 * on the rail and behind every rule — so one page keeps one answer. Two copies
 * of it would be a control that says one thing while the page shows another.
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

const readerSet = <A>(first: A) => {
  let held = first
  const readers = new Set<(now: A) => void>()

  return {
    now: () => held,
    tell: (now: A) => {
      held = now
      for (const wake of readers) wake(now)
    },
    add: (wake: (now: A) => void) => {
      readers.add(wake)
      return () => void readers.delete(wake)
    },
  }
}

// An answer the page works out for itself. Nothing reads it from anywhere,
// so nothing opens and nothing is asked: a caller tells it what it is.
export const holding = <A>(first: A): Held<A> => {
  const one = readerSet(first)
  return { now: one.now, tell: one.tell, reading: one.add }
}

/**
 * One answer the far side pushes, held for the whole page.
 *
 * The channel is opened by the first reader and never closed: the pipe behind
 * it is the page's one pipe, and a fact that arrived while nothing was drawing
 * it is still the last thing the far side said. A channel closed between two
 * routes would be one the page reopens on every navigation, and the moment
 * between the two is a moment nothing is listening in.
 */
export const told = <A>(first: A, open: (tell: (now: A) => void) => void): Held<A> => {
  const one = readerSet(first)
  let opened = false

  return {
    now: one.now,
    tell: one.tell,
    reading: (wake) => {
      const letGo = one.add(wake)
      if (!opened) {
        opened = true
        open(one.tell)
      }
      return letGo
    },
  }
}

/**
 * One answer the page asks the far side for, held for every reader that
 * wants it.
 *
 * One call is in flight however many readers ask at once, so the rail and the
 * Session's own Header are two views of one listing rather than two answers
 * to what Eva holds. Only the call in flight is shared, never the answer: a
 * reader that arrives after one settled asks again, which is what a page that
 * has just opened another Session wants.
 */
export interface Asked<A> extends Held<A> {
  /**
   * Asks again, for every reader at once. The call in flight is let go of
   * first, so what the readers share is the new answer and not the old one.
   */
  readonly again: () => void
}

export const asked = <A>(first: A, ask: () => Promise<A>): Asked<A> => {
  const one = readerSet(first)
  let asking: Promise<void> | undefined

  const run = (): void => {
    /**
     * The answer is told only while this is still the call in flight. A call
     * the page let go of is answering a question that has been asked again,
     * so its answer is older than the one on its way — and a page that took
     * it would draw the listing from before the write that made it re-ask.
     */
    const started: Promise<void> = (asking ??= ask()
      .then((now) => {
        if (asking === started) one.tell(now)
      })
      .finally(() => {
        if (asking === started) asking = undefined
      }))
  }

  return {
    now: one.now,
    tell: one.tell,
    reading: (wake) => {
      const letGo = one.add(wake)
      run()
      return letGo
    },
    again: () => {
      asking = undefined
      run()
    },
  }
}

/**
 * What is held, drawn. The value is read again on mount, so a component drawn
 * after a change reads the change rather than what the page started on.
 */
export const useHeld = <A>(one: Held<A>): A => {
  const [shown, setShown] = useState(one.now)

  useEffect(() => {
    setShown(one.now())
    return one.reading(setShown)
  }, [one])

  return shown
}

/**
 * One read, for as long as the reader draws it, and what stops it.
 *
 * A read outlives a page that navigated away from it, so what settles after
 * the reader has gone is dropped rather than written into a component nobody
 * is drawing. `use` is what the answer is for, and the call it gives back —
 * a fiber to interrupt, a socket to let go of — is run when the reader goes.
 *
 * A plain function and not a hook, so each caller keeps its own `useEffect`
 * and its own dependencies. It is the one answer to what a read that outlived
 * its reader does, because a page holding four answers to that is a page with
 * three of them untested.
 */
export const whileDrawn = <A>(
  read: () => Promise<A>,
  use: (now: A) => (() => void) | void,
): (() => void) => {
  let drawing = true
  let stop: (() => void) | undefined

  void read().then((now) => {
    if (drawing) stop = use(now) ?? undefined
  })

  return () => {
    drawing = false
    stop?.()
    stop = undefined
  }
}
