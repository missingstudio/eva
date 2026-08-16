import { applyTheme, readTheme, type Theme } from "@missingstudio/eva-brand"
import { useEffect, useState } from "react"
import { SteadyLabel } from "./steady-label.js"

// System first, because it is the resting state, then the two overrides.
const order: Theme[] = ["system", "light", "dark"]
const label: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" }

/**
 * The theme control. One button that cycles all three states rather than a
 * select, because a native select cannot be styled to the system — it brings
 * the platform's own control chrome and its own focus ring — and a two-state
 * switch cannot say "follow the system".
 *
 * The current state is the button's visible text, so the setting is readable
 * without opening anything, and the sr-only prefix makes the accessible name
 * say what the word refers to.
 */
export function ThemeControl() {
  // The server cannot know the reader's preference. "system" is what an
  // untouched browser resolves to, so it is what renders until the client says
  // otherwise — and the scheme itself is already right, because the pre-paint
  // script set the class before this component existed.
  const [theme, setTheme] = useState<Theme>("system")
  const [announce, setAnnounce] = useState("")

  useEffect(() => setTheme(readTheme()), [])

  const cycle = () => {
    // The step is taken from the cookie rather than from the rendered state,
    // because the cookie is the record and it is already current. Reading the
    // state would step from whatever the last render captured.
    const next = order[(order.indexOf(readTheme()) + 1) % order.length]!
    applyTheme(next)
    setTheme(next)
    setAnnounce(`Theme: ${label[next]}`)
  }

  return (
    <>
      {/*
        The name is explicit rather than built from the content. The label
        reserves the width of all three states, so two of them are always in
        the markup under `visibility: hidden` — and name-from-content is only
        as reliable as each engine's handling of hidden text. The visible word
        is inside the name, which is what SC 2.5.3 asks for.
      */}
      <button
        type="button"
        onClick={cycle}
        aria-label={`Color theme: ${label[theme]}`}
        className="btn-header"
      >
        <SteadyLabel options={order.map((t) => label[t])} current={label[theme]} />
      </button>
      {/* The change announces without moving focus. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
    </>
  )
}
