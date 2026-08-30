# Making it good to use

How Eva becomes a thing a person wants to use and a stranger wants to extend,
on top of the base layer that is already built.

The base layer proved the shape. A kernel loads plugins, every capability is
one, every surface is a client of one contract, one fold feeds every renderer,
and one trace holds the truth. That was the right thing to prove first, and it
is proven. It is also, today, the whole of what we have proven: **the system
is correct and it is not yet usable.** A person who installs Eva can be
stopped by a missing key with no message. A Run that fails renders as silence.
A contributor who follows our own plugin walkthrough writes a plugin the
program cannot load.

This document is the design for fixing that, and it is the standard the
gate in [plan.md](plan.md) holds new work to: no stage above the base layer
starts until the base layer meets it. It has three jobs.

1. Say what "better" means here, in terms we can test.
2. Design the interaction — first the model that every surface shares, then
   the terminal, then the page, then how the two stay one product and what
   the desktop and the phone inherit for free.
3. Name the refactoring that has to happen underneath, because most of what
   makes the surfaces good is not surface code.

[roadmap.md](roadmap.md) owns what we build next; this owns how well the
built thing behaves. [design.md](design.md) owns colour, type, and motion, and
[ui-guidelines.md](ui-guidelines.md) owns how those become components on the
websites. Nothing here restates them.

## Part I — What better means

### Two audiences and two clocks

Eva has two users and they fail at different speeds.

**The operator has ten minutes.** They install Eva, connect a model, type
something, watch it work, and hit a wall — no key, a denied write, a dropped
connection, a model that refused. In those ten minutes every wall must say
three things: what happened, why, and what to do next. A wall that says
nothing is worse than a crash, because a crash at least names a line.

**The builder has an afternoon.** They clone the repo, run the verify, read
one document, write a plugin, and load it. If that path has a lie in it — a
snippet that does not compile, a walkthrough that teaches a shape the tree
does not use, a contract they can only learn by reading our source — they do
not file a bug. They leave.

Both clocks are short, and both are currently missed.

### Usable, not feature-rich

Eva has a large surface for its age: four doors, forty plugins, ten domains,
ten slots, a permission gate with four modes, a scheduler, a diff applier.
Adding a fifth door or an eleventh domain would be easy and would make the
product worse. The scarce thing is not capability. It is the number of moments
where the program behaves the way a person expects without being taught.

So the bar is this: **a capability that a person cannot find, cannot
understand when it fails, or cannot trust to tell the truth, does not count as
shipped.** The parity ledger already applies that rule across doors. This
document applies it within a door.

### Readable, because it is open source

The tree is the product's second interface. A person evaluating Eva reads the
code before they trust it with a repository and an API key, and the thing they
are judging is whether they could fix it themselves. That makes readability a
feature with a user, not a matter of taste — and it makes a 670-line closure a
usability defect, not a style preference.

Three properties carry it: a file small enough to hold in one head, a name
that means one thing everywhere ([context.md](context.md) is that contract),
and a boundary that a reader can trust because a machine enforces it rather
than a reviewer remembering it.

### The six rules

Everything below is an application of six rules. They outlive the work that
adopts them, and every new screen, verb, and message is reviewed against
them.

1. **Every failure speaks where the user is looking.** A Run that failed says
   so in the transcript, not only in an exit code. A plugin that failed to
   load says so on the surface, not only on a broadcast nobody subscribes to.
2. **Absent is not zero, and a state is never guessed.** An unreported cost is
   an em dash. A screen shows one of its named states or an honest nothing; it
   never shows a placeholder that implies knowledge it does not have.
3. **Stdout belongs to the caller.** In any machine mode the answer goes to
   stdout and everything else to stderr, asserted per verb rather than left as
   a habit.
4. **One voice.** Every refusal, fault, and notice shares one prefix, one
   shape, and one register, and names the next step whenever one exists.
5. **A door names itself.** Every surface tells a person what they can do from
   where they are standing, without documentation.
6. **Teach the code that exists.** A snippet compiles, an example matches the
   tree's conventions, and a comment that names a verb names a verb that
   exists.

### How we know it worked

The roadmap makes a stage prove itself with an exit test. Usability gets the
same treatment, because "it feels better" does not survive a refactor. Three
kinds of proof are available to us, and every ticket names one:

- **A conformance test.** The strongest. A Run closed by each error class
  produces a visible Block at every interactive door — that is a test, and it
  fails when a renderer regresses.
- **A ledger citation.** The parity suite already fails the build when a proof
  is renamed or deleted. Extending the matrix extends that guarantee.
- **A written walkthrough somebody new performs.** For the ten-minute and
  afternoon paths, where no test can watch a person be confused. Performed on
  a clean machine, by someone who did not write the code, once per release.

## Part II — The interaction model

This part is surface-neutral. It is what every door must express, so that the
terminal, the page, the window, and the phone are four renderings of one
design rather than four designs.

### The unit of attention is a Run

A person watching Eva is watching one question get answered. Everything on
every screen exists to answer four questions about that Run: is it moving,
what is it doing, does it need me, and how did it end. The Trace already holds
the answers; the fold in `packages/session-view` already turns them into
Blocks. What is missing is that the fold does not carry all four.

### The five moments

Every Run passes through five moments, and every surface owes each one a
distinct rendering.

| Moment      | What the person needs to know                                  | Today                                            |
| ----------- | -------------------------------------------------------------- | ------------------------------------------------ |
| **Idle**    | that Eva is ready, what it will use, what they can type        | terminal: a hint line. Page: nothing.            |
| **Working** | that it is moving, what it is doing now, what it has spent     | both stream words; tool activity is thin         |
| **Asking**  | that it is stopped on them, what is being asked, how to answer | terminal: an overlay. Page: a prompt. Both good. |
| **Done**    | the answer, and what it cost                                   | both render the words; cost is terminal-only     |
| **Failed**  | that it stopped, why, and what to do                           | **nothing, at either door**                      |

The last row is the single worst defect in the product. The fold drops the
`finished` record ([packages/schema/src/fold.ts](../packages/schema/src/fold.ts)),
so a Run that ends in `auth_failed`, a budget stop, a provider refusal, or
"no harness answers that name" renders as a spinner that stops. The record
holds the reason. No renderer can reach it.

**The design.** The Block vocabulary gains an outcome Block, carrying the
Claim's result, its summary, and its error class when it has one. It is the
fold's job, so every renderer gets it at once and no renderer invents its own
version. This one change is the highest-value fix in this document, and it is
about forty lines in the fold plus a draw in each renderer.

### The permission moment

The most important interaction Eva has is the moment it stops and asks whether
it may do something. It is where trust is won or lost, and it is the moment
that justifies the phone existing at all.

Four rules, all of which the base layer already half-holds:

- **A decision cannot scroll away.** In the terminal a permission request is
  an overlay, not a line — a decision that scrolls out of view is a decision
  nobody made. The base layer does this correctly today.
- **The question carries the act.** A write shows the diff it would make; a
  command shows the words it would run. The gate already resolves the same
  preview the tool would apply, which is what makes the question honest.
- **One question, one answer, whichever door answers it.** Two open doors race
  and the first answer wins; the loser retires its prompt rather than
  recording a second Resolution. The base layer proves this, and it is the
  hardest thing in the product to retrofit, so it is worth saying that we got
  it right early.
- **A door that cannot ask says so.** A non-interactive caller turns an ask
  into a refusal rather than hanging. Also already true.

The work left here is not mechanism. It is that the four options need words a
person understands without a manual — allow once, allow always, reject once,
reject always are protocol names, and "always" needs to say _where_ the rule
will be written, because it writes into the person's own config and never the
repository's.

### Honesty on screen

Four rules that the fleet views later depend on, and that the base layer
should establish now because they are cheap now and expensive later.

- **Absent is not zero.** A cost nobody reported renders as an em dash. A Run
  that predates a counter was not free; we do not know what it cost.
- **Derived, never self-reported.** What a screen says about a Run comes from
  the Trace. A surface that keeps its own counter will disagree with the
  record, and the record is right.
- **Waiting and stranded are different.** Queued while its worker is reachable
  is waiting its turn. Queued while its worker is gone means nobody is coming.
  They must not render the same. This matters at one Run and it matters more
  at twenty.
- **A path never renders raw.** Not in a tooltip, not in an accessibility
  label. Screenshots and screen shares leak whatever a screen draws.

### Designing now for many Runs

The base layer shows one Session at a time. The roadmap goes to a fleet, and
the decision that makes the fleet view cheap or expensive is made here, in how
the base layer models attention.

The expensive path is to treat a Session list as the primary object and bolt
urgency onto it later. The cheap path is to notice that **attention is
derived, and it is a fold over the Trace like everything else**: a Run is
blocked with a reason, or waiting on a person, or moving, or finished. Build
the fold that answers "what needs me" while there is one Session, and the
fleet view is a renderer over a fold that already exists. Skip it, and the
fleet view brings its own fold, and the two disagree — the second of the five
ways the roadmap says this plan fails.

So: the session rail and the session list, in both surfaces, order by what
needs a person first, even when the answer is "nothing does."

## Part III — The terminal

The terminal is the reference surface. Every capability reaches a person here
first, because a terminal costs no build step and no window, and if a
capability lands in the browser first then the terminal quietly becomes the
degraded door.

### The first ten minutes, beat by beat

This is the path a new user actually walks, with what should happen at each
beat.

**Beat 1 — they run `eva` with no key.** Today: the surface opens, they type,
they wait, and nothing happens, because the failure is invisible. It should
be caught before a prompt is spent:

```
eva
  Eva is ready, but no model is connected.
  Set a key and start again:
      export ANTHROPIC_API_KEY=sk-ant-…      # or OPENAI_API_KEY
  Other endpoints — Ollama, vLLM, a gateway — are named in config.
      eva config show   says what is set now
```

The credential mapping already exists in the auth plugin. The surface has a
notice channel. The two are simply not connected.

**Beat 2 — they type a question and it works.** The status line is where the
program continuously tells the truth about itself, and it should carry the
four facts a person needs and no others: which model, which mode, what this
session has spent, and whether the pipe is up.

```
  anthropic/claude-opus-5 · supervised · $0.04 · ready
  type /help · ctrl+k commands
```

Mode belongs there because it is the answer to "can this thing edit my files
right now," and that question should never require a command to answer.

**Beat 3 — the model asks to write a file.** The overlay is already right.
What needs work is the wording of persistence, and that the preview says how
much of the diff it is showing when it cannot show all of it.

**Beat 4 — something fails.** Currently silent. With the outcome Block:

```
  ✗ the run stopped · auth_failed
    anthropic rejected the key. Check ANTHROPIC_API_KEY, then try again.
```

Error class, one sentence of what it means, one action. The eight error
classes are a closed set, so this is eight sentences written once, in one
place, read by every surface. That is a small table and it is the difference
between a product and a prototype.

**Beat 5 — they want the page too.** They run `eva --web`, and the URL is
printed to stdout underneath a full-screen renderer, where it is invisible.
It belongs in the surface's own notice area. This is a two-line fix that
currently hides the second door entirely.

### The voice

Five different error shapes exist in the tree today: a prefixed one, an
unprefixed one, a `refused:` one, a stringified `Error` that leaks its class
name, and a bare summary with a parenthesised class. A person reads all five
in one session and cannot tell which are Eva speaking and which are a crash.

One helper, one prefix, one shape, everywhere:

```
eva: <what happened>
     <why, when it is not obvious>
     <the next step, when there is one>
```

Two rules about content follow from it. **No internal vocabulary reaches a
user.** A refusal that says "tokens arrive at 9b" is telling a stranger about
our roadmap; it should say that a non-local bind is not authenticated yet. A
message that says to run a toolchain command should only say so when the user
is running from source — someone who installed a binary has no such command.

And **a refusal names its subject.** Every declined action says which rule
declined it, from a closed set of reasons, so a person can act. A silent
no-op is never acceptable; it is the pattern that makes people distrust an
autonomous tool, because they cannot tell refusal from failure.

### The terminal as a program

The pipe is a surface with one user and that user is a script. Its whole
contract is that stdout is the answer. Today `eva -p` appends a cost line to
stdout, which breaks the promise the README makes, and which the tree
already states as a rule elsewhere. Cost is commentary; commentary goes to
stderr.

The general form is worth writing down now because later stages depend on it:
**every verb that answers has a machine mode whose stdout is exactly its
answer**, and that is asserted per verb rather than trusted. `eva config
show` needs a JSON mode for the same reason — it is the one command that
answers "what would this run use," and today its output is truncated at 44
columns and cannot be pasted into a bug report.

### What the terminal should not become

A window manager. The terminal renders one Session well and, later, a fleet
summary. It does not grow panes, tabs, or a mouse-driven layout, because the
moment it does, the page and the terminal stop being two renderings of one
design and start being two products.

## Part IV — The page

The page is not a demonstration that the wire works. It is the surface a
person uses when they want to see more at once than a terminal shows, and it
has to be worth opening on its own.

### What a first-time visitor sees

Today, an idle page renders a title, a subtitle, and a build string. It offers
nothing: no way to start, no explanation of the rail, no hint that `/`
commands exist, and no statement of what this thing is for. The terminal
prints a hint line and says in a comment that a door nobody names is a door
nobody finds. The page names none of its doors.

The idle state should do three things — say what this is, offer the one
action, and teach the one gesture:

```
        Eva

        No Session open.

        [ Start a Session ]     or pick one from the left

        Type / for commands · ⌘K to search
```

That is the design system's own rule for an empty state: say what is missing
and how to fill it.

### States, honestly

The page's read models are modelled as two states — reading, then read — with
a comment saying there is no third. That is true only while the transport
retries forever and nothing is ever refused, and neither holds. Two
consequences are live defects.

**A dead pipe is invisible on the index.** The connection notice is drawn
inside a Session view, so a visitor whose server is gone sees "Reading the
Sessions…" forever. The notice belongs in the shell, where every route
inherits it.

**A refused write is swallowed.** A 4xx dies inside the transport, and every
call site ignores the failure. Pick a model the Catalog does not hold and the
picker shows the new name while the server keeps the old one. The page is
lying, quietly, in the one place where trust is cheapest to lose.

The client runtime already publishes the three states a surface should act
on — ready, synchronizing, disconnected — and the field's strongest pattern
here is that a resync is invisible while a _refusal_ is loud. Adopt exactly
that split: never surface a gap the runtime is already closing; always
surface a decision the server made.

### The session rail

The rail is the page's real advantage over the terminal, and it is where the
fleet view is quietly being designed. Three properties now, cheap now:

- **Ordered by attention**, not by recency alone. A Session waiting on a
  person sorts above one that is merely newest.
- **One derived collection, per-row selection.** Each row reads its own slice,
  so twenty moving Runs repaint twenty rows and not the page. This is the
  difference between a fleet view that stays smooth and one that is rewritten.
- **A row shows one of its named states, or nothing.** No skeleton that
  implies a Session is loading when the pipe is down.

### The composer

The composer is good — prompt, queue, steer, stop, model picker, all crossing
the wire and racing the terminal for one gate. Three additions finish it: the
hint line the terminal already has, a place where a refusal appears, and a
visible queue depth so a person who typed three lines while a Run was open
knows all three are waiting.

### The tab, and the small things

Five open Sessions are five identical browser tabs titled "Eva". The header
already carries a title the top bar draws. Setting the document title, adding
a favicon, and adding a description is an hour of work that changes the page
from a demo into something a person keeps open all day.

Theme is the other small thing, and the decision is made: **the page is dark
only**, the way every Eva surface is — the design system ships one dark
instrument panel and no light scheme, and the page joins it rather than
following the operating system. Switching a theme means switching among Eva's
own theme rows — the same default, high-contrast, and monochrome rows the
terminal draws — so `/theme` typed into the page works, and a page control
offers the same three. What goes: the `prefers-color-scheme` following in the
page's HTML, and the half-working state where `/theme` reaches a plugin that
correctly reports this surface draws no colours.

## Part V — Keeping the two doors one product

### Parity is a practice, not a milestone

The parity ledger is the best artefact in the repository: eight interactions,
four doors, a named test behind every proven cell, and four cells that
honestly say they are neither proven nor refused. Its blind spot is that it
grades only the chat interaction. A user's real first hour includes running a
Workflow, setting config, granting trust, and checking a policy — and not one
of those four has a row, or a web equivalent.

Extending the matrix by those four rows is the cheapest way to make the
CLI-and-web gap visible in the place the maintainer already looks. Some of the
new cells will be refusals, and that is a fine answer: a door that declares
what it cannot do is at parity with one that can.

### One fold, one runtime, and what they buy

The two rules that make four surfaces affordable are already held: no surface
owns client logic, and there is exactly one fold. Everything in Parts III and
IV lands in one of three places — the fold, the client runtime, or a
renderer — and the first two are shared. The outcome Block is written once and
appears at every door. The error-class sentences are written once. The
attention ordering is written once.

That is also the test of whether a proposed fix is in the right place. **If a
fix has to be written twice, it is in the wrong layer.**

### What the desktop and the phone inherit

Neither exists yet, and everything above decides how much they cost. A shell
that renders the same page build and holds no logic is a window, a tray, and a
notification. A phone that reads the same fold and holds no reconnect rule is
a renderer and a push token. Every rule in this document that lands in the
fold or the runtime is a rule those two surfaces get for free — and every one
that lands in a renderer is one they must reimplement.

The rule that matters most for them is the one from Part II: the machine
composes what a person reads. A notification's words come from the daemon
that owns the Trace, never from a relay, because a relay that can read the
Trace turns a privacy property into a privacy policy.

## Part VI — The developer experience

### The five-minute plugin

The DX headline is the path from clone to a loaded plugin, and today it has a
break in the middle: the walkthrough teaches `export default`, no plugin in
the tree uses it, and the composition root imports named bindings — so a
contributor who follows the document exactly produces a plugin that cannot be
loaded. The walkthrough now matches the tree and ends with the registration
step, which is the part that was missing entirely: the Build is closed, there
is no discovery, and a plugin the import table does not name does not exist.

That honesty has a second half. "Everything is a plugin" is the product's
loudest claim, and today no package is published and nothing loads from
outside the tree. The claim as stated is not yet true for a stranger. Either
the SDK packages ship, or the sentence says "every capability is a plugin,
in-tree, and external distribution arrives at its stage." Both are fine. The
current version is the one that is not.

### The contract is the product's API

A builder should never have to read our implementation to learn our contract.
Three things follow.

**The SDK is one entrypoint with a discoverable shape.** A plugin author
reaches domains, slots, hooks, and broadcasts from one package, and the layer
rules keep the kernel out of reach so that the wrong import is a build error
rather than a working accident.

**The composition root's special cases are documented or removed.** Five
plugins are structurally required today — the approval plugin's grant
memory, the policy checker, the default model, and the two the serving path
rewires — each with a good local reason, and together they mean the tree
contradicts its own headline. Naming them as required is honest and costs
nothing. Moving them behind seams is better and costs more. Either beats the
current silence.

**A message is part of the contract.** An unknown config key reports a
Finding with the nearest spelling and the file it came from, rather than being
refused — that is the design the config layer already holds, and it is exactly
right, because refusing unknown keys would make every new plugin option a
kernel change. The same generosity should reach every other place a builder
can be wrong.

### Readability as a feature

Four concrete properties, each with a defect in the tree today.

- **A boundary a machine enforces.** The lint layer rules are the best thing
  in the build, and they stop at two places: the web app has no rule, so
  nothing prevents the kernel entering a browser bundle, and the terminal's
  attach path imports the _page's_ plugin to reach the ask channel, which
  belongs beside the wire.
- **A file one person can hold.** The terminal surface is a 670-line closure
  with five pieces of mutable state, and the wire's router is a 178-line
  nested chain of regexes. Both have neighbours that already show the
  extraction pattern.
- **A comment that is true.** Comments referencing a verb that does not exist,
  and stage labels a reader cannot resolve, are worse than no comment, because
  a reader trusts them. The multi-paragraph design essays are genuinely good
  and belong in decision records with a pointer left behind.
- **A dependency that is used.** Forty-eight of seventy shipped UI components
  have no importer, and they drag their dependencies with them.

### Decision records

The reasoning behind this architecture is its most valuable documentation, and
894 lines of it were deliberately removed from git, with the record directory
ignored. The intent was sound — plans are working state, and a plan's
conclusions belong in the roadmap and the glossary. The effect is that a
contributor cannot read why any of it is the way it is, fifteen documents
pointed at a file that is not there, and the two live records exist only in
one person's checkout, where a lost laptop loses them.

The recommendation is to reverse it: decision records return to git. It is the
one item in this document that reverses a maintainer's decision, so it is
theirs to make, and the ticket that proposes it says so.

## Part VII — The refactoring this requires

Grouped by what each group unlocks, because that is how they should be
scheduled. Nothing here adds a capability; every item makes an existing one
visible, honest, or reachable.

### Group 1 — make failure visible

The fold gains an outcome Block, both renderers draw it, and the eight error
classes get their one-sentence table. The composition root subscribes to
plugin-load failures and reports them in the one voice. This group alone
converts the most common bad first experience — silence — into a sentence.

### Group 2 — one voice, one truth

One error helper, used by every writer including the two refusal paths.
Internal vocabulary removed from user-facing strings. The build-from-source
remedy shown only when running from source. Refusal reasons come from a closed
set.

### Group 3 — the page tells the truth

The connection notice moves to the shell. Refusals surface at the call sites
that discard them. The idle state offers its doors. The tab identifies its
Session.

### Group 4 — the seams the surfaces need

The ask channel moves from the page's plugin to the wire, where any surface
can reach it. A command's Location is injected rather than read from the
process inside a plugin, so a slash command dispatched from the page acts in
the caller's directory rather than the server's. The web app gets the lint
boundary every other layer has.

### Group 5 — the code a stranger reads

The long closures split along the seams their neighbours already use. The
router becomes a table. Unused components and their dependencies leave. The
two websites' duplicated machine layers fold into the package that already
owns what both sites are built from. The plugin naming exception is removed so
one rule transliterates directory, package, and id everywhere.

### Group 6 — the way in

A contributing path that is short. A walkthrough that compiles. Comments that
name real verbs. An honest statement of what is in-tree only. Decision records
back in git, if the maintainer agrees.

## What this document refuses

No new stages, no new extension points, no redesign of a shipped contract, and
no feature borrowed because somebody else has it. The roadmap owns growth;
this owns whether the thing we already built is good. When the base layer
meets it, this document does not shrink: it stays as the standard every later
surface stage is reviewed against.
