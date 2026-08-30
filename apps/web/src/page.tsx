import { Button } from "@missingstudio/ui/components/button"
import { PlusIcon } from "lucide-react"
import { buildLine } from "./build.js"
import { useRefusal } from "./refusals.js"
import { opening } from "./sessions.js"
import { Main, TopBar } from "./shell.js"

/**
 * The main pane with no Session in it.
 *
 * The listing used to be here. It is on the rail now, where it stays whichever
 * route is drawn, so this pane is what is left — and what is left has a job:
 * say what this is, offer the one thing a person can do here, and name the
 * gesture the field has, because a door nobody names is a door nobody finds.
 *
 * Which build it is stays at the foot. A person reading the page and a person
 * reading a bug report are looking at the same string.
 */
export const Page = () => {
  // What the far side refused, because the one action on this pane is a write
  // and a button that reached nothing would look like a button nobody pressed.
  const refused = useRefusal()

  return (
    <Main>
      <TopBar title="Eva" />
      <div className="idle">
        <p className="idle-mark">Eva</p>
        <p className="idle-line">the page that prompts</p>
        <p className="idle-said">No Session is open.</p>
        {/*
           The one action, and the other way to the same place. The rail holds
           every Session Eva has; below the width where it has a column of its
           own it is behind the trigger in the bar, so it is named as the
           listing rather than as a direction to look in.
        */}
        <div className="idle-do">
          <Button onClick={opening}>
            <PlusIcon aria-hidden="true" />
            Start a Session
          </Button>
          <span className="idle-line">or open one from the listing</span>
        </div>
        {/*
           The gesture, taught where a first visitor is rather than in
           documentation. It is what the field does, so it is said in the
           future tense this pane is in: there is no field here yet.
        */}
        <p className="idle-line">
          In a Session, type <code>/</code> for commands
        </p>
        <p className="idle-line">
          build <code>{buildLine()}</code>
        </p>
        {refused.said === undefined ? null : (
          <p className="refusal" role="status">
            {refused.said}
          </p>
        )}
      </div>
    </Main>
  )
}
