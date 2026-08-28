import { buildLine } from "./build.js"
import { Main, TopBar } from "./shell.js"

/**
 * The main pane with no Session in it.
 *
 * The listing used to be here. It is on the rail now, where it stays whichever
 * route is drawn, so this pane is what is left: which page this is, which
 * build it is, and the invitation the rail answers. Nothing is read here —
 * every read this route needs is the shell's, and the shell keeps it across
 * the navigation into a Session.
 */
export const Page = () => (
  <Main>
    <TopBar title="Eva" />
    <div className="idle">
      <p className="idle-mark">Eva</p>
      <p className="idle-line">the page that prompts</p>
      <p className="idle-line">
        build <code>{buildLine()}</code>
      </p>
    </div>
  </Main>
)
