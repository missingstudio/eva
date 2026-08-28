import {
  idle,
  stepped,
  type Client,
  type LoopAction,
  type LoopStep,
} from "@missingstudio/eva-client-runtime"
import { optionFor, type FrontendAnswer, type Transcript } from "@missingstudio/eva-core"
import type { SessionID } from "@missingstudio/eva-schema"
import {
  dispatch,
  namesCommand,
  type CommandInfo,
  type FrontendRequest,
  type KeymapInfo,
  type PickRow,
  type Running,
} from "@missingstudio/eva-sdk"
import {
  canonical,
  conflicts,
  makeKeymap,
  themeColors,
  type KeyPress,
  type Renderer,
  type ThemeColors,
} from "@missingstudio/eva-tui-core"
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Queue,
  Schedule,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect"
import { branchOf, shortPath } from "./banner.js"
import { apply, backStep, frameOf, initial, type ConsoleEvent, type Place } from "./console.js"
import { edit, pasted, type LineAction, type LineCommand } from "./line.js"
import {
  commandRows,
  completed,
  completionQuery,
  opened,
  pickRows,
  selectedRow,
  COMMANDS_HINT,
  COMMANDS_TITLE,
  PICK_HINT,
  type OpenOverlay,
} from "./overlay.js"

export const TUI_SURFACE = "eva.tui"

/**
 * Where the work happens, as this door knows it.
 *
 * A door in the same process knows the directory: the Session it opens
 * belongs to it, and the banner reads this repository's branch out of it. A
 * door at the end of a socket knows only the address it dialled — the runtime
 * is somewhere else, so a branch read here names the wrong repository and a
 * path here is a path nobody is working in. It names no location either, and
 * the serving process answers with its own.
 */
export type Where =
  | { readonly kind: "directory"; readonly path: string }
  | { readonly kind: "runtime"; readonly origin: string }

export interface SurfaceDeps {
  readonly client: Client
  readonly renderer: Renderer
  // Read at the point of use, so a plugin loaded later is reachable.
  readonly commands: Effect.Effect<readonly CommandInfo[]>
  readonly keymap: Effect.Effect<readonly KeymapInfo[]>
  readonly where: Where
  /**
   * How a line runs, when it does not run in this process. Absent is the
   * local dispatch, which is what every in-process door does.
   *
   * A command reaches Domains rather than a Session, and it changes state
   * where it runs: a `/mode` dispatched here would move the approval state of
   * the process nobody is talking to and leave the runtime under the mode it
   * already had.
   *
   * `commands` stays this process's rows even then. It is what the panel and
   * the completion list, and a listing changes nothing: a name the far side
   * does not answer comes back from it in words, with the near miss it knows.
   */
  readonly run?: Running
  // The app owns the manifest, so the app says which version this is.
  readonly version: string
  // The colors configuration chose. They reach the renderer as a fact of
  // every Frame rather than as something the renderer was built with, which
  // is what lets a theme be chosen while the surface runs.
  readonly theme?: ThemeColors
  // What went wrong on the way here — a theme that named no row, say. The
  // surface shows them where the person is looking, until the first fold.
  readonly notices?: readonly string[]
  readonly now?: () => number
  // How long the Live area may take to drain after its Run has closed.
  // Named here so a test can reach the stop without waiting for it.
  readonly settle?: number
}

// How often the spinner turns. Fast enough to read as motion, slow enough
// that a redraw is not what the terminal spends its time on.
export const TICK = 100

/**
 * A choice a command is waiting on: the rows as the command offered them,
 * and what the screen was painted in before the panel opened. Esc means keep
 * what you had, and what you had includes the colors.
 */
interface Waiting {
  readonly rows: readonly PickRow[]
  readonly deferred: Deferred.Deferred<PickRow | undefined>
  readonly theme?: ThemeColors
}

/**
 * A panel's own query is a line with no bindings on it: the keys that
 * submit and cancel belong to the surface, and the query only collects
 * what was typed. The editor is reused rather than rewritten, so a caret
 * behaves the same wherever there is text.
 */
const QUERY_KEYS = makeKeymap(new Map())

/**
 * What the loop acts on: a line's command, the word that an open Run
 * settled, or one of the panel's own. `settled` names the Run it closes, so
 * a Run that ended while a cancel was landing cannot close the one that
 * follows it.
 *
 * The panel's three are here rather than in the key handler because every
 * one of them may run a command, and a command is an Effect.
 */
type LoopSignal =
  | LineCommand
  | { readonly kind: "settled"; readonly run: number }
  | { readonly kind: "palette" }
  // The line changed, so what completion offers may have changed with it.
  | { readonly kind: "completing" }
  // A row was taken: run what it names, or leave it on the line to finish.
  | { readonly kind: "took"; readonly how: "run" | "complete" }

/**
 * The terminal surface: a thin shell around the Console. The Console holds
 * every rule of what the screen shows; this wires the world to it — keys in,
 * frames out, Session API calls at the edge — and keeps no state of its own.
 * The loop takes keys while a Run is open, so a cancel acts on the Run it
 * was pressed against.
 */
export const makeSurface = Effect.fn("eva.tui.start")(function* (deps: SurfaceDeps) {
  const scope = yield* Effect.scope
  const now = deps.now ?? (() => Date.now())
  const finished = yield* Deferred.make<void>()
  const keys = yield* Queue.unbounded<LoopSignal>()

  /**
   * Where this run is, which no Run changes. Only the model is read again.
   *
   * An attached terminal names the runtime it dialled and no branch: the
   * repository is on the machine the runtime is on, and this one's branch is
   * a fact about a directory the work never touches.
   */
  const where = deps.where
  const local = where.kind === "directory" ? where.path : undefined
  const place: Place = {
    version: deps.version,
    branch: where.kind === "directory" ? branchOf(where.path) : "",
    directory: where.kind === "directory" ? shortPath(where.path) : where.origin,
  }

  // The Console is the state; every event is drawn, so the screen is never
  // behind what happened.
  let state = initial(yield* deps.client.api.create(local))
  const on = (event: ConsoleEvent) => {
    state = apply(state, event)
    deps.renderer.draw(frameOf(state, place))
  }

  /**
   * Where the runtime is, on the screen. It is the one fact this surface
   * reads about the pipe: a drop is the runtime's to recover from, and what
   * a person needs is to be told why the words stopped moving.
   *
   * `changes` replays the value the ref holds now, so the first frame says
   * where the runtime is rather than assuming it is up.
   */
  yield* Effect.forkIn(
    Stream.runForEach(SubscriptionRef.changes(deps.client.state), (one) =>
      Effect.sync(() => on({ kind: "connection", state: one })),
    ),
    scope,
  )

  // The keymap Domain decides what a key means on this surface. A row
  // another surface claimed is not a binding here.
  const rows = (yield* deps.keymap).filter(
    (row) => row.surface === undefined || row.surface === TUI_SURFACE,
  )
  const bindings = makeKeymap(new Map(rows.map((row) => [row.binding, row.command])))

  // A binding that cannot fire and a key bound twice are degraded outcomes,
  // said where the person is looking rather than passed over. This is the
  // one place rows collapse into a keymap, so it is the one place that asks.
  const notes = [
    ...(deps.notices ?? []),
    ...rows
      .filter((row) => canonical(row.binding) === undefined)
      .map((row) => `key binding ${row.id} names no key this surface knows: ${row.binding}`),
    ...conflicts(rows).map(
      (one) => `${one.binding} is bound twice (${one.ids.join(", ")}); the last one wins`,
    ),
  ]

  // The choices open, by the number that names each request. A panel that
  // closes late cannot answer a question nobody asked.
  const waiting = new Map<number, Waiting>()
  let picks = 0

  /**
   * The screen while a row is only being looked at. A row that names colors
   * paints them; one that names none paints nothing, which is why moving
   * through the model picker never switches a model — that is a fact of the
   * Session, and it happens when a row is taken.
   */
  const preview = (request: number, id: string | undefined): void => {
    const colors = waiting.get(request)?.rows.find((row) => row.id === id)?.colors
    const gated = colors === undefined ? undefined : themeColors(colors)
    if (gated !== undefined) on({ kind: "themed", colors: gated })
  }

  /**
   * A choice, answered. The panel leaves the screen as it found it — what it
   * painted while a row was under the selection was a look, not a decision —
   * and what the command does with the row it took is the command's to say.
   */
  const resolved = (request: number, id?: string): void => {
    const one = waiting.get(request)
    if (one === undefined) return

    waiting.delete(request)
    on({ kind: "themed", ...(one.theme === undefined ? {} : { colors: one.theme }) })
    Deferred.doneUnsafe(one.deferred, Effect.succeed(one.rows.find((row) => row.id === id)))
  }

  /**
   * The `pick` a command is given here. It is a Deferred the panel answers:
   * enter carries the row back, esc carries nothing — and nothing means the
   * person kept what they had, which no command may read as a choice.
   */
  const pick = Effect.fn("eva.tui.pick")(function* (title: string, rows: readonly PickRow[]) {
    picks += 1
    const request = picks
    const deferred = yield* Deferred.make<PickRow | undefined>()
    waiting.set(request, {
      rows,
      deferred,
      ...(state.theme === undefined ? {} : { theme: state.theme }),
    })
    on({
      kind: "opened-overlay",
      overlay: opened(title, pickRows(rows), "", { kind: "pick", request }, "query", PICK_HINT),
    })
    return yield* Deferred.await(deferred)
  })

  // The screen's colors, changed by a command that decided them. A row that
  // is not a theme paints nothing: the contract's own gate says which is
  // which, and the command that offered the colors says why.
  const paint = (colors: Record<string, string>): void => {
    const gated = themeColors(colors)
    if (gated !== undefined) on({ kind: "themed", colors: gated })
  }

  /**
   * Every open choice, answered with nothing. The loop is waiting on the
   * panel, so a cancel or a quit reaches the loop only once the command
   * holding it has been let go — a surface that is going away answers every
   * question the way esc does.
   */
  const abandon = (): void => {
    const panel = state.overlay
    if (panel?.intent.kind !== "pick") return

    on({ kind: "closed-overlay" })
    resolved(panel.intent.request)
  }

  /**
   * The keys a panel claims while one is open, answered here and never
   * passed on. Everything it does not claim falls through to the line —
   * which is what keeps typing typing, whatever is on the screen.
   */
  const overlayKey = (open: OpenOverlay, key: KeyPress, action: LineAction): boolean => {
    if (key.key === "up" || key.key === "down") {
      on({ kind: "stepped", by: key.key === "up" ? -1 : 1 })
      const moved = state.overlay
      if (open.intent.kind === "pick" && moved !== undefined) {
        preview(open.intent.request, selectedRow(moved)?.id)
      }
      return true
    }
    // Tab completes a line, and a choice is not a line. A panel filled by a
    // command claims it for nothing.
    if (key.key === "tab" && open.intent.kind === "command") {
      Queue.offerUnsafe(keys, { kind: "took", how: "complete" })
      return true
    }
    if (action.kind === "submit" || (action.kind === "editing" && key.key === "return")) {
      if (open.intent.kind === "pick") {
        const row = selectedRow(open)
        on({ kind: "closed-overlay" })
        resolved(open.intent.request, row?.id)
        return true
      }
      Queue.offerUnsafe(keys, { kind: "took", how: "run" })
      return true
    }
    // A panel with its own query is typed into; one that follows the line
    // lets the line take the key, and follows it.
    if (open.source === "query" && action.kind === "editing") {
      const query = { buffer: open.query, cursor: Array.from(open.query).length }
      const typed = edit(query, key, QUERY_KEYS)
      if (typed.kind === "editing") on({ kind: "filtered", query: typed.line.buffer })
      return true
    }
    return false
  }

  const stopKeys = deps.renderer.onKey((key) => {
    const line = { buffer: state.buffer, cursor: state.cursor }
    const action = edit(line, key, bindings, state.recall !== undefined)

    /**
     * One key, one meaning: step back. The Console decides what that means
     * from what is open, and it is asked before the event is applied — the
     * step it names is the step this press performs, and interrupting is
     * the one of them the surface has to do itself.
     */
    if (action.kind === "back") {
      const step = backStep(state)
      const panel = state.overlay
      on({ kind: "backed" })

      // A panel that a command is waiting on is answered with nothing, which
      // is what keeping what you had is called. A command never hears that a
      // panel closed; it hears that nobody chose.
      if (step === "close-overlay" && panel?.intent.kind === "pick") {
        resolved(panel.intent.request)
      }
      if (step === "interrupt") Queue.offerUnsafe(keys, { kind: "cancel" })
      return
    }

    // An interrupt a person armed and then typed past is not armed any
    // more, so nothing is ever interrupted by a key pressed for something
    // else.
    if (state.armed) on({ kind: "disarmed" })

    if (action.kind === "palette") {
      Queue.offerUnsafe(keys, { kind: "palette" })
      return
    }

    if (state.overlay !== undefined && overlayKey(state.overlay, key, action)) return

    if (action.kind === "editing") {
      on({ kind: "typed", buffer: action.line.buffer, cursor: action.line.cursor })
      // Completion follows the line: what the line is still naming is what
      // the panel offers, and a line that has stopped naming closes it.
      Queue.offerUnsafe(keys, { kind: "completing" })
      return
    }

    if (action.kind === "history") {
      on({ kind: "recalled", direction: action.direction })
      return
    }

    // Stopping outranks a question: a cancel or a quit has to reach the
    // loop, and while a panel is open the loop is waiting on the panel.
    if (action.kind === "cancel" || action.kind === "quit") abandon()

    // A line that left the editor is a line the history keeps, whatever it
    // turns out to mean: a command recalled is as useful as a prompt, and a
    // steer is as useful as either.
    if (action.kind === "submit" || action.kind === "steer") {
      on({ kind: "submitted", line: action.line })
    }

    on({ kind: "typed", buffer: "", cursor: 0 })
    Queue.offerUnsafe(keys, action)
  })
  yield* Scope.addFinalizer(scope, Effect.sync(stopKeys))

  /**
   * A pasted block lands on the line, whatever is in it. It never passes
   * through the keymap: a newline in a paste is text, and it used to submit
   * the half of a block that had arrived so far.
   *
   * A panel with its own query is typed into, so a paste goes there instead
   * — the same rule typing follows.
   */
  const stopPaste = deps.renderer.onPaste((text) => {
    const panel = state.overlay
    if (panel?.source === "query") {
      const query = pasted({ buffer: panel.query, cursor: Array.from(panel.query).length }, text)
      on({ kind: "filtered", query: query.buffer })
      return
    }
    const line = pasted({ buffer: state.buffer, cursor: state.cursor }, text)
    on({ kind: "typed", buffer: line.buffer, cursor: line.cursor })
    Queue.offerUnsafe(keys, { kind: "completing" })
  })
  yield* Scope.addFinalizer(scope, Effect.sync(stopPaste))

  // The end of the input is a request to stop, in the renderer's own word.
  // It never passes through the keymap, so no rebinding can strand a pipe.
  const stopEnd = deps.renderer.onEnd(() => {
    abandon()
    Queue.offerUnsafe(keys, { kind: "quit" })
  })
  yield* Scope.addFinalizer(scope, Effect.sync(stopEnd))
  yield* Scope.addFinalizer(
    scope,
    Effect.sync(() => deps.renderer.stop()),
  )

  // The record, as the Console is told it. Where the fold came from and which
  // model to name are the caller's; the shape is one.
  const painted = (transcript: Transcript, model: string, holding: boolean): ConsoleEvent => ({
    kind: "folded",
    messages: [...transcript.messages()],
    model,
    summary: transcript.cost(),
    holding,
  })

  // The record folds; the Console decides what the fold replaces.
  const refresh = Effect.fn("eva.tui.refresh")(function* (holding = false) {
    const transcript = yield* Effect.scoped(deps.client.api.attach(state.session))
    const model = (yield* deps.client.api.model.get(state.session)).model
    on(painted(transcript, model, holding))
  })

  /**
   * A line, run where the Domains are. The far side holds the rows, resolves
   * the name and says what it did — including that no command answers it, in
   * the same words dispatch says here.
   *
   * Whether the line is a command at all is decided on this side, because it
   * is a fact of the line and of nothing else: `namesCommand` is the rule
   * `dispatch` parses by. A Prompt sent over to be told it is a Prompt would
   * be one write to learn the answer and a second to act on it.
   *
   * A command that opened a Session says so, and the screen follows it — the
   * `select` the local dispatch is given, carried as an answer.
   */
  const runOverWire = (run: Running) =>
    Effect.fn("eva.tui.commanded")(function* (line: string) {
      if (!namesCommand(line)) return false
      const ran = yield* run(state.session, line)
      if (ran.wrote !== "") on({ kind: "said", text: ran.wrote })
      if (ran.selected !== undefined) on({ kind: "selected", session: ran.selected })
      return true
    })

  // Dispatch owns what a line means and what to say when it means nothing.
  // This surface supplies where writing goes and which Session is open.
  const runHere = Effect.fn("eva.tui.command")(function* (line: string) {
    const outcome = yield* dispatch(yield* deps.commands, line, (parsed) => ({
      api: deps.client.api,
      session: state.session,
      ...(parsed.argument === undefined ? {} : { argument: parsed.argument }),
      write: (text: string) => on({ kind: "said", text }),
      select: (next: SessionID) => on({ kind: "selected", session: next }),
      /**
       * What this surface can do beyond writing, which is what its renderer
       * can draw. A pipe draws no panel, so it offers no choice: one opened
       * there would wait on an answer that can never arrive. The same
       * command then says its answer in words, which is what a pipe wanted.
       */
      ...(deps.renderer.draws.panels ? { pick } : {}),
      ...(deps.renderer.draws.colors ? { paint } : {}),
    }))

    if (outcome.kind === "said") on({ kind: "said", text: outcome.text })
    return outcome.kind !== "prompt"
  })

  const runCommand = deps.run === undefined ? runHere : runOverWire(deps.run)

  /**
   * The questions that stand, each waiting on its own answer. Eva may ask more
   * than one at a time — one tool group can hold two calls that both need a
   * person — and each ask is answered on its own, whichever door answers it.
   *
   * A terminal shows one line at a time, so the first question that stands is
   * the one a person is looking at and a line they type is that one's. The
   * others wait their turn behind it. One slot and one shared queue used to
   * hold this: a second ask overwrote the first, both waited on one answer,
   * and which of them it settled was whichever the runtime happened to wake.
   */
  interface Standing {
    readonly request: FrontendRequest
    readonly waiting: Deferred.Deferred<FrontendAnswer>
  }
  const standing = new Map<string, Standing>()

  // The question a person is looking at, which is the first one that stands.
  const shown = (): Standing | undefined => standing.values().next().value

  // What the screen says about the questions that stand. Called whenever the
  // first one changes, so answering one shows the next rather than nothing.
  const showing = () => {
    const next = shown()
    on(
      next === undefined
        ? { kind: "answered" }
        : { kind: "asked", question: next.request.question },
    )
  }

  const answer = Effect.fn("eva.tui.answer")(function* (line: string) {
    const held = shown()
    // A line typed with nothing standing answers nothing. It used to be kept
    // for the next question to consume, which answered one nobody had read.
    if (held === undefined) return on({ kind: "answered" })

    standing.delete(held.request.id)
    const option = held.request.kind === "permission" ? optionFor(line) : undefined
    yield* Deferred.succeed(
      held.waiting,
      (option === undefined
        ? { kind: "text", text: line }
        : { kind: "permission", optionId: option }) satisfies FrontendAnswer,
    )
    showing()
  })

  /**
   * Eva needs a person, and this terminal is one of the two doors to one. The
   * other is the socket: the gate races them, so an answer from a browser
   * watching the same Session interrupts this call.
   *
   * That interrupt is what retires the prompt. There is nothing to watch the
   * record for — a question nobody has answered is not on it — and the
   * interrupt is the fact itself: this door lost, so the line above stops
   * asking to be answered.
   */
  const ask = Effect.fn("eva.tui.ask")(function* (request: FrontendRequest) {
    const waiting = yield* Deferred.make<FrontendAnswer>()
    standing.set(request.id, { request, waiting })
    // The screen changes only when this is the question now at the front.
    if (shown()?.request.id === request.id) showing()

    return yield* Effect.onInterrupt(Deferred.await(waiting), () =>
      Effect.sync(() => {
        standing.delete(request.id)
        showing()
      }),
    )
  })

  /**
   * One open Run, from the prompt that opens it to the fold that replaces
   * its stream. It runs as a fiber of its own, so the loop stays at the
   * queue while it is open.
   */
  const runPrompt = Effect.fn("eva.tui.run")(function* (line: string) {
    on({ kind: "opened", line, at: now() })

    // The spinner turns on a clock of its own, because a Run that says
    // nothing for a while is still a Run that is working.
    const turning = yield* Effect.forkChild(
      Effect.repeat(
        Effect.sync(() => on({ kind: "ticked", at: now() })),
        Schedule.spaced(TICK),
      ),
    )

    // The runtime owns the Run, from the input that opens it to the record
    // that replaces its stream. Every payload it hears feeds the Live area;
    // the spinner and the close are this surface's own.
    yield* deps.client.run(
      state.session,
      { kind: "prompt", text: line },
      (one) => {
        if (one.kind === "payload") return on({ kind: "streamed", payload: one.payload })
        // A dropped connection costs one repaint. What the runtime hands over
        // is the record, so this paints from it rather than folding a second
        // time, and the model is the one already on the screen.
        on(painted(one.transcript, state.model, true))
      },
      deps.settle === undefined ? {} : { settle: deps.settle },
    )
    yield* Fiber.interrupt(turning)
    on({ kind: "closed", at: now() })
    // The fold replaces the stream. What stays on screen is the record.
    yield* refresh(true)
  })

  const loop = Effect.fn("eva.tui.loop")(function* () {
    // The theme configuration chose is the first thing the screen is told,
    // so every frame after it is painted — including the first.
    if (deps.theme !== undefined) on({ kind: "themed", colors: deps.theme })
    yield* refresh()
    // What went wrong on the way here is one thing that went wrong, however
    // many lines it takes to say it.
    if (notes.length > 0) on({ kind: "said", text: notes.join("\n") })

    /**
     * Where the loop stands, and the fibers behind the numbers it holds.
     * The composer fold in `@missingstudio/eva-client-runtime` owns every
     * rule about them; this owns the fibers, because a fiber is not
     * something a fold can hold.
     */
    let standing = idle
    const fibers = new Map<number, Fiber.Fiber<void>>()

    // A line does what it says. Which it is, is the command Domain's answer,
    // and what follows from that answer is the fold's.
    const handle = Effect.fn("eva.tui.line")(function* (line: string): Effect.fn.Return<void> {
      const before = state.session
      const ran = yield* runCommand(line)
      yield* walk({ kind: "handled", line, ran, moved: state.session !== before })
    })

    // One action, performed. Nothing here decides anything.
    const perform = Effect.fn("eva.tui.act")(function* (
      action: LoopAction,
    ): Effect.fn.Return<void> {
      switch (action.kind) {
        case "answer":
          return yield* answer(action.line)
        case "handle":
          return yield* handle(action.line)
        case "steer":
          /**
           * A steer rides the Run that is open and returns at once, so it
           * opens no fiber and takes no Run number. The Run it lands in says
           * the line back as a `message`, so nothing is put on the screen
           * here.
           */
          return yield* deps.client.api.submit(state.session, {
            kind: "steer",
            text: action.line,
            target: "next-step",
          })
        case "open": {
          const { run } = action
          const fiber = yield* Effect.forkChild(
            Effect.ensuring(
              runPrompt(action.line),
              Effect.sync(() => Queue.offerUnsafe(keys, { kind: "settled", run })),
            ),
          )
          fibers.set(run, fiber)
          return
        }
        case "refresh":
          return yield* refresh()
        case "interrupt": {
          const fiber = fibers.get(action.run)
          fibers.delete(action.run)
          if (fiber !== undefined) yield* Fiber.interrupt(fiber)
          return
        }
        case "settle": {
          const fiber = fibers.get(action.run)
          fibers.delete(action.run)
          if (fiber === undefined) return
          // A Run that died says so; one that was interrupted was cancelled,
          // and the cancel already spoke.
          const outcome = yield* Fiber.await(fiber)
          if (Exit.isFailure(outcome) && !Cause.hasInterruptsOnly(outcome.cause)) {
            const squashed: unknown = Cause.squash(outcome.cause)
            on({
              kind: "said",
              text: `the Run failed: ${squashed instanceof Error ? squashed.message : String(squashed)}`,
            })
          }
          return
        }
        case "cancelled": {
          yield* deps.client.api.cancel(state.session, "user")
          on({ kind: "cancelled" })
          return yield* refresh(true)
        }
        case "stop":
          return
      }
    })

    // One step, and everything it asked for, in the order it asked.
    const walk = Effect.fn("eva.tui.step")(function* (step: LoopStep): Effect.fn.Return<boolean> {
      const next = stepped(standing, step)
      standing = next.state
      for (const action of next.actions) yield* perform(action)
      return next.actions.some((action) => action.kind === "stop")
    })

    /**
     * The panel over every command there is. It reads the command Domain
     * at the point of use, so a plugin loaded a moment ago is in it.
     */
    const openPalette = Effect.fn("eva.tui.palette")(function* () {
      const rows = commandRows(yield* deps.commands)
      on({
        kind: "opened-overlay",
        overlay: opened(COMMANDS_TITLE, rows, "", { kind: "command" }, "query", COMMANDS_HINT),
      })
    })

    /**
     * Completion, kept in step with the line. A line that is still naming a
     * command has a panel; one that has stopped naming one does not, and a
     * panel dismissed for this line stays dismissed until the line moves on.
     */
    const completing = Effect.fn("eva.tui.completing")(function* () {
      const showing = state.overlay?.source === "buffer"
      const query = completionQuery(state.buffer)
      if (query === undefined || state.hushed) {
        if (showing) on({ kind: "closed-overlay" })
        return
      }
      // An open panel is already following the line: the Console refiltered
      // it when the line changed.
      if (showing) return
      const rows = commandRows(yield* deps.commands)
      on({
        kind: "opened-overlay",
        overlay: opened(
          COMMANDS_TITLE,
          rows,
          state.buffer,
          { kind: "command" },
          "buffer",
          COMMANDS_HINT,
        ),
      })
    })

    /**
     * A row was taken. Enter runs it and tab leaves it on the line to
     * finish, which is what the panel says the two keys do.
     *
     * A command that names an argument is still run: `argumentHint` says
     * what an argument would look like, never that one is needed, and
     * running with none is not inventing one — it is the line the person
     * would have typed. `/theme` and `/model` both answer a bare line with
     * a choice of their own, and reading the hint as a demand is what made
     * the palette type them out instead of opening either.
     */
    const take = Effect.fn("eva.tui.take")(function* (how: "run" | "complete") {
      const overlay = state.overlay
      if (overlay === undefined) return
      const row = selectedRow(overlay)
      if (row === undefined) return

      const command = (yield* deps.commands).find((one) => one.id === row.id)
      if (command === undefined) return
      on({ kind: "closed-overlay" })

      const line = completed(command)
      if (how === "complete") {
        on({ kind: "typed", buffer: line, cursor: Array.from(line).length })
        return
      }
      // The space tab leaves for an argument is not part of the line a Run
      // is opened on.
      const run = line.trimEnd()
      on({ kind: "submitted", line: run })
      on({ kind: "typed", buffer: "", cursor: 0 })
      // Through the fold like any other line, so a row taken while a Run is
      // open waits its turn rather than opening a second one over it.
      yield* walk({ kind: "line", line: run, asking: state.asking })
    })

    // The panel's three touch nothing the fold holds, so they are answered
    // here. Everything that moves a Run goes through it.
    for (;;) {
      const signal = yield* Queue.take(keys)
      if (signal.kind === "palette") {
        yield* openPalette()
        continue
      }
      if (signal.kind === "completing") {
        yield* completing()
        continue
      }
      if (signal.kind === "took") {
        yield* take(signal.how)
        continue
      }
      const step: LoopStep =
        signal.kind === "settled"
          ? { kind: "settled", run: signal.run }
          : signal.kind === "quit"
            ? { kind: "quit" }
            : signal.kind === "cancel"
              ? { kind: "cancel" }
              : // A steered line is the same line with the gesture on it. The
                // fold reads the gesture; the surface only reports it.
                {
                  kind: "line",
                  line: signal.line,
                  asking: state.asking,
                  steer: signal.kind === "steer",
                }
      if (yield* walk(step)) return
    }
  })

  const running = yield* Effect.forkIn(
    Effect.ensuring(loop(), Deferred.succeed(finished, undefined)),
    scope,
  )
  yield* Scope.addFinalizer(scope, Fiber.interrupt(running).pipe(Effect.asVoid))

  // What this surface can do is on its row in the surface Domain, registered
  // where the plugin is defined. It is not repeated here.
  return { id: TUI_SURFACE, ask, done: Deferred.await(finished) }
})
