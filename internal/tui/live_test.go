package tui

import (
	"strings"
	"testing"
	"time"
)

// These tests drive the Live area through its own interface. Nothing here builds
// a console, a window, or a Renderer: what the module needs of any of them is one
// function, so what a test needs to give it is one function.

type folds struct {
	took  time.Duration
	asked int
}

func (f *folds) draw(text string) []string {
	f.asked++
	if f.took > 0 {
		// Slept rather than claimed. The module measures the call itself, so a
		// cost it was merely told about would not be the cost it acts on.
		time.Sleep(f.took)
	}
	return strings.Split(text, "\n")
}

// An answer that costs nothing to draw is drawn on every frame, and one that
// costs is drawn less often — by a multiple of what it actually cost.
func TestAnArrivingAnswerIsDrawnAsOftenAsItsCostAllows(t *testing.T) {
	const share = 4
	fold := &folds{}
	l := newLive(fold.draw, share)

	l.write("the first words")
	if got := l.rows(); len(got) != 1 || got[0] != "the first words" {
		t.Fatalf("the first frame drew %q, want the words that arrived", got)
	}
	if fold.asked != 1 {
		t.Fatalf("the drawing was asked for %d times, want once", fold.asked)
	}

	// Text that has not moved is not drawn again, whatever the cost was.
	l.rows()
	if fold.asked != 1 {
		t.Errorf("text that had not changed was drawn again: asked %d times", fold.asked)
	}

	// A drawing that cost a second, just now. Nothing is due for four.
	fold.took = 0
	l.cost = time.Second
	l.at = time.Now()

	l.write(" and the next ones")
	l.due()
	if got := l.rows(); strings.Contains(strings.Join(got, ""), "next ones") {
		t.Errorf("an expensive answer was drawn inside its own cost:\n%q", got)
	}
	if fold.asked != 1 {
		t.Errorf("the fold was paid for twice inside one cost: asked %d times", fold.asked)
	}

	// Declining has to leave the debt owed. At the end of a turn no further chunk
	// arrives, so a frame that declined in silence would drop the answer's last
	// words for good.
	if !l.due() {
		t.Error("the frame declined to draw and did not say it was behind")
	}

	// Once the cost is paid for, the newest text is drawn.
	l.at = time.Now().Add(-time.Minute)
	if got := strings.Join(l.rows(), ""); !strings.Contains(got, "next ones") {
		t.Errorf("the answer was not drawn once its cost was paid for:\n%q", got)
	}
	if fold.asked != 2 {
		t.Errorf("the fold was asked for %d times, want twice", fold.asked)
	}
}

func TestTheCostThatBoundsTheNextDrawingIsTheOneMeasured(t *testing.T) {
	fold := &folds{took: 5 * time.Millisecond}
	l := newLive(fold.draw, 1)

	l.write("an answer that is expensive to draw")
	l.rows()

	if l.cost < fold.took {
		t.Errorf("the recorded cost is %s, and the drawing took at least %s", l.cost, fold.took)
	}
}

func TestATurnThatEndsLeavesNoLiveArea(t *testing.T) {
	fold := &folds{}
	l := newLive(fold.draw, 8)

	l.write("what the last turn was saying")
	l.rows()
	l.forget()

	if got := l.rows(); got != nil {
		t.Errorf("the Live area outlived its turn:\n%q", got)
	}
	if l.lines != nil || l.text != "" || l.cost != 0 {
		t.Error("the drawing outlived the answer it was made from")
	}
}

func TestAStaleDrawingIsMadeAgainAndTheAnswerSurvivesIt(t *testing.T) {
	fold := &folds{}
	l := newLive(fold.draw, 8)

	l.write("an answer drawn at one width")
	l.rows()

	l.cost = time.Hour
	l.at = time.Now()
	l.stale()

	got := strings.Join(l.rows(), "")
	if !strings.Contains(got, "one width") {
		t.Errorf("a stale drawing lost the answer it was made from:\n%q", got)
	}
	if fold.asked != 2 {
		t.Errorf("a stale drawing was not made again: the fold was asked %d times", fold.asked)
	}
}

// A console with no Run in flight has no Live area to draw, and asking costs
// nothing.
func TestNothingArrivingDrawsNothing(t *testing.T) {
	var l live
	if got := l.rows(); got != nil {
		t.Errorf("a console with nothing arriving drew %q", got)
	}
	if l.due() {
		t.Error("a console with nothing arriving owes a frame")
	}
}

func TestChunksPileUpAndOneFrameDrawsThemAll(t *testing.T) {
	fold := &folds{}
	l := newLive(fold.draw, 8)

	for _, word := range []string{"one ", "two ", "three"} {
		l.write(word)
	}
	if fold.asked != 0 {
		t.Errorf("a chunk was drawn as it arrived: the fold was asked %d times", fold.asked)
	}
	if !l.due() {
		t.Fatal("chunks arrived and no frame was owed")
	}

	if got := strings.Join(l.rows(), ""); got != "one two three" {
		t.Errorf("one frame drew %q, want everything that had arrived", got)
	}
	if fold.asked != 1 {
		t.Errorf("three chunks cost %d folds, want one", fold.asked)
	}
}
