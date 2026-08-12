package cli

import (
	"context"
	"os"
	"runtime"
	"syscall"
	"testing"
	"time"
)

// The seam itself, in one process. What it is asked to hold is narrow: the
// Context ends, and the signal that ended it is nameable afterwards — because
// the exit code is composed from it, and a seam that cancelled without saying
// what cancelled it would leave Main guessing.

func TestTheContextEndsWhenASignalArrives(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("a process cannot signal itself here")
	}

	ctx, asked, release := listen(context.Background())
	defer release()

	if s := asked(); s != nil {
		t.Fatalf("a signal was named before one arrived: %v", s)
	}

	self, err := os.FindProcess(os.Getpid())
	if err != nil {
		t.Fatalf("find this process: %v", err)
	}
	// Interrupt rather than Terminate: an unhandled SIGTERM would take the test
	// binary with it if the relay were not in place, which is a failure that
	// reads as a crash. An unhandled SIGINT does too — so this test is also the
	// one that proves the relay is there at all.
	if err := self.Signal(os.Interrupt); err != nil {
		t.Fatalf("signal this process: %v", err)
	}

	select {
	case <-ctx.Done():
	case <-time.After(10 * time.Second):
		t.Fatal("the Context did not end when a signal arrived")
	}

	if s := asked(); s != os.Interrupt {
		t.Errorf("the signal is named %v, want %v", s, os.Interrupt)
	}
}

// Releasing ends the Context without a signal, and names none. Main defers this
// so the relay does not outlive the run, and a release that reported a signal
// would turn every ordinary exit into 128-something.
func TestReleasingNamesNoSignal(t *testing.T) {
	ctx, asked, release := listen(context.Background())
	release()

	select {
	case <-ctx.Done():
	case <-time.After(10 * time.Second):
		t.Fatal("the Context did not end when it was released")
	}

	if s := asked(); s != nil {
		t.Errorf("releasing named the signal %v, want none", s)
	}
}

// A parent that ends takes the derived Context with it, which is what makes this
// safe to wrap around anything.
func TestAnEndedParentEndsTheContext(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	ctx, asked, release := listen(parent)
	defer release()

	cancel()

	select {
	case <-ctx.Done():
	case <-time.After(10 * time.Second):
		t.Fatal("the Context outlived its parent")
	}
	if s := asked(); s != nil {
		t.Errorf("an ended parent named the signal %v, want none", s)
	}
}

// The codes a shell reports for a process a signal ended. Eva handles these
// rather than dying under them, and the convention is what keeps `eva; echo $?`
// answering the same either way.
func TestASignalLeavesTheCodeAShellReports(t *testing.T) {
	for _, c := range []struct {
		signal os.Signal
		want   int
	}{
		{syscall.SIGHUP, 129},
		{os.Interrupt, 130},
		{syscall.SIGTERM, 143},
	} {
		if got := stopCode(c.signal); got != c.want {
			t.Errorf("%v leaves %d, want %d", c.signal, got, c.want)
		}
	}
}

// Every signal Eva listens for has to be one it can compose a code from.
// Nothing here is allowed to fall through to the ExitFailure branch, which
// exists for the compiler rather than for a signal.
func TestEverySignalListenedForHasACode(t *testing.T) {
	for _, s := range stopSignals {
		if got := stopCode(s); got <= 128 {
			t.Errorf("%v leaves %d, which is not 128 plus a signal number", s, got)
		}
	}
}
