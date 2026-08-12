package cli

import (
	"context"
	"os"
	"os/signal"
	"sync"
	"syscall"
)

// stopSignals are the ways the outside world asks this process to stop.
//
// Interrupt is a person at a terminal, Terminate is a supervisor or a `kill`,
// and Hangup is the terminal going away underneath a console. All three mean
// the same thing to Eva — finish the record and leave — so all three are one
// list rather than three cases.
//
// Quit is deliberately absent. It is the signal whose documented purpose is a
// stack dump from a wedged process, and a handler that swallowed it would take
// away the one tool somebody debugging a hang has left.
//
// SIGTERM and SIGHUP are not delivered on Windows. Asking for them there is
// harmless, and asking for them in one list is what keeps this readable.
var stopSignals = []os.Signal{os.Interrupt, syscall.SIGTERM, syscall.SIGHUP}

// listen returns a Context that ends when this process is asked to stop, and
// asked, which names the signal that ended it.
//
// It exists because nothing else in Eva owns being asked to stop. The console
// stopped cleanly before this only because the terminal library installed its
// own handler, and the one-shot command — the path a script runs — had none at
// all: a signal killed it between two records, so the Trace kept a Run that
// opened and never closed, which is the one record ADR 0016 exists to prevent.
// Owning the signal here is what lets both frontends close a Run for the same
// reason, because a cancelled Context is a thing every layer below already
// understands.
//
// The second signal is left to the runtime. Relaying stops as soon as the first
// one arrives, so a person who pressed ctrl+c on a run that is taking too long
// to finish its record can press it again and have the process die — the
// courtesy every long-running command owes, and the reason this is not
// signal.NotifyContext, which cancels but cannot say which signal did it.
//
// asked reports nil until a signal arrives. It is safe to call from another
// goroutine, which is the only way it is ever called: the signal lands on this
// package's goroutine and the answer is read on the one running Main.
func listen(parent context.Context) (ctx context.Context, asked func() os.Signal, release func()) {
	ctx, cancel := context.WithCancel(parent)

	// Buffered, because signal.Notify never blocks on a full channel: an
	// unbuffered one would drop the signal whenever it arrived before this
	// goroutine reached the receive.
	arrived := make(chan os.Signal, 1)
	signal.Notify(arrived, stopSignals...)

	var mu sync.Mutex
	var got os.Signal

	go func() {
		select {
		case s := <-arrived:
			mu.Lock()
			got = s
			mu.Unlock()
			// Before the cancel, so that a second signal is already the
			// runtime's by the time anything starts shutting down.
			signal.Stop(arrived)
			cancel()
		case <-ctx.Done():
			// Released, or the parent ended. Either way this goroutine is done
			// and the relay has to be taken down with it.
			signal.Stop(arrived)
		}
	}()

	return ctx, func() os.Signal {
			mu.Lock()
			defer mu.Unlock()
			return got
		}, func() {
			signal.Stop(arrived)
			cancel()
		}
}

// stopCode is the exit code a process that stopped for a signal leaves.
//
// It is 128 plus the signal's number, which is what a shell reports for a
// process a signal ended. Eva handles these signals rather than dying under
// them, and a handled signal that reported anything else would make `eva; echo
// $?` answer differently depending on whether the handler existed — so the
// convention is followed rather than a fourth code of Eva's own being invented.
//
// A signal that is not a number falls back to ExitFailure. That cannot happen
// for the three in stopSignals, and the fallback is here because os.Signal is
// an interface and the compiler is right to insist.
func stopCode(s os.Signal) int {
	if signo, ok := s.(syscall.Signal); ok {
		return 128 + int(signo)
	}
	return ExitFailure
}
