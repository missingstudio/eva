import { buildLine } from "./build.js"

/**
 * W1's walking skeleton: the page names the build that served it, and
 * nothing on it reads a Session. The wire arrives with the page code that
 * calls it, one method at a time.
 */
export const Page = () => (
  <main>
    <h1>Eva</h1>
    <p className="build">
      the page that watches · build <code>{buildLine()}</code>
    </p>
    <p className="note">Nothing here reaches Eva yet.</p>
  </main>
)
