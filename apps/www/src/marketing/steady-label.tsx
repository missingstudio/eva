/**
 * A label that never changes the width of the control it sits in.
 *
 * Every option is rendered into the same grid cell and all but the current one
 * is hidden, so the control is always as wide as its widest label. Without it a
 * control whose text changes resizes, and everything laid out around it moves:
 * the navigation island is centred and sized to its contents, so cycling
 * "System" to "Dark" pulled both of its edges inward.
 *
 * `visibility: hidden` rather than `opacity: 0`, because it keeps the box for
 * layout and takes the text out of the accessibility tree — the control has one
 * accessible name, not three.
 */
export function SteadyLabel({ options, current }: { options: readonly string[]; current: string }) {
  return (
    <span className="grid text-center">
      {options.map((option) => (
        <span
          key={option}
          className={`col-start-1 row-start-1 ${option === current ? "" : "invisible"}`}
        >
          {option}
        </span>
      ))}
    </span>
  )
}
