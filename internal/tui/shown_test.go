package tui

import (
	"strings"
	"sync"
	"testing"
)

// A driver reading the frame while the update loop composes it reads no torn
// answer, and the race detector says so.
func TestTheFrameIsReadWhileItIsWritten(t *testing.T) {
	var s shown

	const frames = 200
	var wg sync.WaitGroup
	wg.Add(3)

	// The update loop: publish a frame, take a Run, queue a prompt.
	go func() {
		defer wg.Done()
		for i := range frames {
			s.show([]string{"a turn", "and another"})
			s.hold(func() {})
			s.queue("a prompt behind the turn")
			if i%2 == 0 {
				s.release()
			}
		}
	}()

	// A driver, reading the three things it is owed.
	go func() {
		defer wg.Done()
		for range frames {
			_ = s.frame()
			_ = s.busy()
			_ = s.waiting()
		}
	}()

	// A second reader, because one is not a race.
	go func() {
		defer wg.Done()
		for range frames {
			if got := s.frame(); got != "" && !strings.Contains(got, "turn") {
				t.Errorf("a frame was read half-written: %q", got)
			}
		}
	}()

	wg.Wait()
}

// A Run held is a Run in flight, and only releasing it ends that.
func TestAnInterruptedRunIsStillHeld(t *testing.T) {
	var s shown

	if s.busy() {
		t.Fatal("a console with no Run is busy")
	}

	cancelled := 0
	s.hold(func() { cancelled++ })

	if !s.busy() {
		t.Fatal("a console holding a Run is not busy")
	}

	// What an interrupt does: cancel, and hold on.
	if cancel := s.holding(); cancel != nil {
		cancel()
	}
	if !s.busy() {
		t.Error("an interrupted Run was let go before its own close arrived")
	}

	// What the Run's close does: let go.
	if cancel := s.release(); cancel != nil {
		cancel()
	}
	if s.busy() {
		t.Error("a released Run is still in flight")
	}
	if cancelled != 2 {
		t.Errorf("the Run was cancelled %d times, want twice — once by the interrupt, once by the close", cancelled)
	}
	if cancel := s.release(); cancel != nil {
		t.Error("releasing twice handed back a second Run to cancel")
	}
}

func TestQueueingSwapsThePromptThatWasWaiting(t *testing.T) {
	var s shown

	if got := s.waiting(); got != "" {
		t.Errorf("a console with nothing queued is waiting on %q", got)
	}
	if was := s.queue("first"); was != "" {
		t.Errorf("the first queued prompt displaced %q", was)
	}
	if got := s.waiting(); got != "first" {
		t.Errorf("the queued prompt is %q, want the one just queued", got)
	}

	// A person who types a second has changed their mind about the first.
	if was := s.queue("second"); was != "first" {
		t.Errorf("queueing a second prompt handed back %q, want the one it replaced", was)
	}
	if was := s.queue(""); was != "second" {
		t.Errorf("the turn closing took %q, want the prompt that was waiting", was)
	}
	if got := s.waiting(); got != "" {
		t.Errorf("a sent prompt is still queued as %q", got)
	}
}
