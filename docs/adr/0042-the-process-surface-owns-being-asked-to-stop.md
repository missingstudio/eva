---
status: accepted
---

# The process surface owns being asked to stop

`cli` installs the signal handler, and a cancelled Context is how every layer below hears about it.

Nothing owned this before. `Main` built a `context.Background()` that nothing could cancel, and `os/signal` appeared nowhere in Eva. The console still stopped cleanly, which is what made the gap hard to see: the terminal library installs a handler of its own unless it is told not to, so a caught SIGTERM became one of its messages, the program ended, and the teardown ran. Eva inherited a working shutdown from a rendering dependency.

The one-shot command inherited nothing, because it builds no program. A signal killed `eva -p` where it stood, between two records.

## What that cost

**The one-shot command produced the record ADR 0016 exists to prevent.** That ADR opens by naming the worst of the three possible records — a Run that opened, some of an answer, and no `Finished` — and defends against it three times with `context.WithoutCancel`. Every one of those defences is reached by way of a cancelled Context. A signal that kills the process reaches none of them, so `eva -p` interrupted mid-turn left exactly that Run, on the path most likely to be running unattended. `-p` also writes its answer only when the Run closes, so the same signal left stdout empty.

**A terminated console reported success.** SIGTERM became the library's clean-exit message, its nil error travelled up, and the run fell through to `ExitOK`. A supervisor, a CI job, and a shell script all read a console somebody stopped as a job that finished.

**A dependency's prose reached a person in Eva's voice.** SIGINT to a console whose input is not a terminal printed `eva: program was killed: program was interrupted` — two of the library's sentinels behind Eva's name, on the path `render/failure.go` exists to keep in Eva's own words.

**SIGHUP and SIGQUIT were caught by nobody.** The library asks for SIGINT and SIGTERM only. A terminal closing on a running console killed it with the tty still in raw mode, still in the alternate screen, and still reporting mouse motion — a broken shell for whoever opens the next one.

**Nothing detected any of it.** No test sent SIGINT, SIGTERM, or SIGHUP to anything. The only signal any test sent was SIGKILL, which is the one signal Eva cannot answer. Passing `tea.WithoutSignalHandler()` — a one-line change with no failing test anywhere in the repository — would have silently returned the console to dying under SIGTERM mid-Run, and made the `Interrupt` capability in every `Started` record a lie.

## The seam is a Context, and the signal is nameable

`listen` returns a Context that ends when a signal arrives and a function that names the signal. The Context is the seam: cancellation is a thing every layer below already acts on, so both frontends reach the same conclusion by the same route, and neither needs to know a signal exists.

It is not `signal.NotifyContext`, which cancels but cannot say which signal did it. The exit code is composed from the signal, so the signal has to survive the trip.

Relaying stops when the first signal arrives, so the second is the runtime's. A person who pressed Ctrl-C on a run that is taking too long to finish its record can press it again and have the process die. That courtesy is the reason the handler is not permanent.

SIGQUIT is deliberately absent. Its documented purpose is a stack dump from a wedged process, and a handler that swallowed it would take away the one tool somebody debugging a hang has left.

## The code is 128 plus the signal

Eva handles these signals rather than dying under them. A handled signal that reported anything else would make `eva; echo $?` answer differently depending on whether the handler existed, so the shell's convention is followed rather than a fourth code of Eva's own being invented: 129 for SIGHUP, 130 for SIGINT, 143 for SIGTERM.

The signal outranks whatever the run made of it. The run reports what happened to the turn; `Main` reports what happened to the process.

## This amends ADR 0016's premise, and settles its consequence

ADR 0016 says: *"A signal to the one-shot command kills the process where it stands, which is not a clean cancel however it looks from outside."* That was a true statement about the implementation and it is the reason `Interrupt` is told rather than assumed. It is no longer true. A signal now cancels the Context the one-shot turn runs under, the Run closes with a claim, and `once` claims `Interrupt` because it has become able to honour it.

Everything else in ADR 0016 stands, and this depends on it. An interrupted Run still closes as `failed` with the summary `interrupted`; the Result set still has no fifth word; the close is still committed under `context.WithoutCancel`. This decision does not add a way to close a Run — it makes the one that already existed reachable from the one path that could not reach it.

The capability model is unchanged and is the reason this is safe. `Interrupt` remains told rather than assumed, so a frontend that stops listening stops claiming, and the claim is now asserted on both paths rather than one.

## Consequences

**Two owners would be worse than one.** The library's handler is disabled. Leaving both would mean a signal cancelling the Context *and* becoming a message, with two shutdowns racing and no way to say which one wrote the record.

**Ctrl-C at a terminal is untouched.** A terminal in raw mode delivers it as a key, not a signal, which is why it ends a turn rather than the process. No handler on either side takes part in that, and ADR 0016 still describes it.

**A cancellation is no longer an error to print.** `tui.Run` maps the library's sentinels: being asked to stop is not a failure, and the caller that cancelled already knows. It matches the Context's own error rather than the library's kill sentinel, because that sentinel wraps every ungraceful ending including a panic — and a panic must never be silent.

**SIGKILL is unchanged and still tested.** It cannot be caught, so it still leaves a Run that never closed, and `TestAKilledRunLeavesATraceThatParsesCompletely` still requires exactly that. What the Trace guarantees under a kill — whole lines, a torn tail costing the last record rather than the file — was never a function of this and is not now.

**Falsifier:** a signal arriving while the sink is blocked — a full disk, a network store — cancels a Context that the close deliberately does not honour, so the process stays up holding a signal it has already stopped relaying. The second signal is what ends it, which is why relaying stops rather than continuing. If that becomes the common case rather than the pathological one, the answer is a deadline on the close, which is the same answer ADR 0016's own falsifier reaches.
