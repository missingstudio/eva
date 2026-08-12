package cli_test

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"runtime"
	"syscall"
	"testing"
	"time"

	"github.com/missingstudio/eva/internal/events"
)

// These are the tests the binary harness was built for. The note at the top of
// eva_test.go says as much — a test can only interrupt a process it started —
// and until now the only signal any test sent was SIGKILL, which is the one
// signal Eva cannot answer.

func signalled(t *testing.T, cmd *exec.Cmd, s os.Signal, stderr *bytes.Buffer) int {
	t.Helper()

	if err := cmd.Process.Signal(s); err != nil {
		t.Fatalf("send %v: %v", s, err)
	}

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		var exit *exec.ExitError
		if err != nil && !errors.As(err, &exit) {
			t.Fatalf("wait for eva: %v\nstderr: %s", err, stderr.String())
		}
	case <-time.After(30 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatalf("eva did not leave 30s after %v\nstderr: %s", s, stderr.String())
	}
	return cmd.ProcessState.ExitCode()
}

// console starts an idle console and returns once it has answered one turn, so
// that a signal arriving next arrives at a console that is certainly up.
func console(t *testing.T, w *world) (*exec.Cmd, *bytes.Buffer) {
	t.Helper()

	cmd := exec.Command(binary)
	cmd.Env = w.env
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	keys, err := cmd.StdinPipe()
	if err != nil {
		t.Fatalf("open eva's input: %v", err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("start eva: %v", err)
	}
	// The pipe stays open for the life of the test: a console whose input has
	// ended leaves on its own, and this one has to be still running when the
	// signal reaches it.
	t.Cleanup(func() { _ = keys.Close() })

	if _, err := keys.Write([]byte("what is this project\r")); err != nil {
		t.Fatalf("type a prompt: %v\nstderr: %s", err, stderr.String())
	}
	w.awaitRuns(t, 1, &stderr)
	return cmd, &stderr
}

// A supervisor that stops Eva is owed the fact that it stopped Eva. This exited
// zero before, because the terminal library reported a caught SIGTERM as its own
// clean shutdown and nothing above it disagreed — so `systemd`, a CI job, and a
// shell script all read a terminated console as a job that finished.
func TestATerminatedConsoleDoesNotReportSuccess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the console cannot be driven through a pipe here, and SIGTERM is not delivered")
	}

	w := newWorld(t, replayed(t))
	cmd, stderr := console(t, w)

	if code := signalled(t, cmd, syscall.SIGTERM, stderr); code != 143 {
		t.Errorf("a terminated console exited %d, want 143 (128+SIGTERM)\nstderr: %s", code, stderr.String())
	}
}

// The same fact for the signal a person sends, and the code a shell reports for
// it. Ctrl-C at a terminal is a key rather than a signal, so this is the piped
// case: a console whose input is not a terminal, stopped from outside.
func TestAnInterruptedConsoleReportsTheInterrupt(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the console cannot be driven through a pipe here")
	}

	w := newWorld(t, replayed(t))
	cmd, stderr := console(t, w)

	if code := signalled(t, cmd, os.Interrupt, stderr); code != 130 {
		t.Errorf("an interrupted console exited %d, want 130 (128+SIGINT)\nstderr: %s", code, stderr.String())
	}
}

// A terminal that goes away takes the console with it, and the console has to
// leave the way it leaves for anything else. Nothing caught this signal before:
// the process died under it with the terminal still in raw mode and still in the
// alternate screen, which is a broken shell for whoever opens the next one.
func TestAHangupLeavesLikeAnyOtherStop(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the console cannot be driven through a pipe here, and SIGHUP is not delivered")
	}

	w := newWorld(t, replayed(t))
	cmd, stderr := console(t, w)

	if code := signalled(t, cmd, syscall.SIGHUP, stderr); code != 129 {
		t.Errorf("a hung-up console exited %d, want 129 (128+SIGHUP)\nstderr: %s", code, stderr.String())
	}
}

// Nothing a dependency calls a failure reaches a person in Eva's voice.
func TestStoppingSaysNothingInSomebodyElsesWords(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the console cannot be driven through a pipe here")
	}

	for _, s := range []os.Signal{os.Interrupt, syscall.SIGTERM, syscall.SIGHUP} {
		t.Run(s.String(), func(t *testing.T) {
			w := newWorld(t, replayed(t))
			cmd, stderr := console(t, w)
			signalled(t, cmd, s, stderr)

			// Not "no output at all": a diagnostic Eva chose to write would be
			// fine. What must not appear is somebody else's account of it.
			for _, leaked := range []string{"program was", "bubbletea", "tea.", "context canceled"} {
				if bytes.Contains(stderr.Bytes(), []byte(leaked)) {
					t.Errorf("stderr carries %q, which is not Eva's word for it:\n%s", leaked, stderr.String())
				}
			}
		})
	}
}

// The one-shot command is the path a script runs, and it is the one that had no
// answer to a signal at all: the process died between two records, so the Trace
// kept a Run that opened and never closed — the record ADR 0016 exists to
// prevent, produced by the path most likely to be automated.
func TestASignalledPromptClosesItsRun(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("SIGINT cannot be delivered to another process here")
	}

	const caught = 20

	long, _ := longReplay(t, 2000, 3)
	w := newWorld(t, long)

	cmd := exec.Command(binary, "-p", "answer at length")
	cmd.Env = w.env
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Start(); err != nil {
		t.Fatalf("start eva: %v", err)
	}

	// Mid-stream, proven from the Trace rather than assumed from a sleep: a
	// signal that arrived before the turn opened would test nothing, and one
	// that arrived after it closed would test the ordinary path.
	var midStream bool
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		body, err := os.ReadFile(w.trace)
		if err != nil || bytes.Count(body, []byte("\n")) < caught {
			time.Sleep(time.Millisecond)
			continue
		}
		if bytes.Contains(body, []byte(`"kind":"finished"`)) {
			t.Fatal("the turn closed before it could be stopped — the recording is too short")
		}
		midStream = true
		break
	}
	if !midStream {
		_ = cmd.Process.Kill()
		t.Fatalf("the turn never reached %d records\nstderr: %s", caught, stderr.String())
	}

	if code := signalled(t, cmd, os.Interrupt, &stderr); code != 130 {
		t.Errorf("a stopped prompt exited %d, want 130 (128+SIGINT)\nstderr: %s", code, stderr.String())
	}

	// The record, which is the point of all of it.
	var closes int
	for _, e := range w.stored(t) {
		finished, ok := e.Payload.(events.Finished)
		if !ok {
			continue
		}
		closes++
		if finished.Claim.Result != events.ResultFailed {
			t.Errorf("the stopped Run claims %q, want %q", finished.Claim.Result, events.ResultFailed)
		}
		if finished.Claim.Summary != "interrupted" {
			t.Errorf("the stopped Run says %q, want %q", finished.Claim.Summary, "interrupted")
		}
	}
	if closes != 1 {
		t.Errorf("the Trace holds %d closed Runs, want exactly 1 — a stopped Run still closes, once", closes)
	}
}

// A capability claimed and absent corrupts a Run, so the claim is asserted on
// the path that makes it. The console's half of this is
// TestTheInteractiveRunClaimsThatItCanBeInterrupted; this is the other half,
// and it could not have been written before Main owned the signal.
func TestAPromptClaimsThatItCanBeInterrupted(t *testing.T) {
	w := newWorld(t, replayed(t))

	if got := w.run(t, "-p", "what is this project"); got.code != 0 {
		t.Fatalf("eva -p exited %d\nstderr: %s", got.code, got.stderr)
	}

	var claims int
	for _, e := range w.stored(t) {
		started, ok := e.Payload.(events.Started)
		if !ok {
			continue
		}
		claims++
		if !started.Capabilities.Interrupt {
			t.Error("a one-shot Run does not claim Interrupt, and it now listens for one")
		}
	}
	if claims == 0 {
		t.Fatal("the Trace holds no opened Run")
	}
}
