/**
 * The reveal system's one moving part.
 *
 * `.js` on the root is what arms every hidden state in motion.css, so a page
 * with no JavaScript never hides anything — it simply renders. An observer
 * then marks each element as it arrives and stops watching it; nothing
 * re-hides on the way back up.
 *
 * Two kinds of target, two trigger lines. A `.reveal` block is released a
 * little before it is fully on screen. A `.word` in the tagline band is
 * released as it crosses a line low in the viewport, so the sentence lights up
 * in reading order rather than flipping at once.
 *
 * Both are IntersectionObservers. A scroll listener would run on every frame
 * of every scroll and reflow the page doing it.
 */
const show = (element: Element) => {
  ;(element as HTMLElement).dataset["shown"] = ""
}

const release = (selector: string, rootMargin: string) => {
  const targets = document.querySelectorAll<HTMLElement>(selector)
  if (targets.length === 0) return

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        show(entry.target)
        observer.unobserve(entry.target)
      }
    },
    { rootMargin },
  )

  for (const element of targets) observer.observe(element)
}

export function armReveals() {
  const root = document.documentElement
  root.classList.add("js")

  // A reader who asked for less motion gets the settled state immediately.
  // The hidden states are inside `prefers-reduced-motion: no-preference`, so
  // this only has to stop the observers from running.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (const element of document.querySelectorAll(".reveal, .word")) show(element)
    return
  }

  release(".reveal", "0px 0px -12% 0px")
  release(".word", "0px 0px -30% 0px")
}
