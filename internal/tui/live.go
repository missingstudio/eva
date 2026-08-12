package tui

import (
	"strings"
	"time"
)

// live is the Live area: the open Run's answer as it streams, and the last
// drawing of it.
//
// It is a module rather than six fields on the console because of what it holds
// besides the text — a rule that decides how often the answer may be drawn, paid
// for out of the clock it costs to draw. That rule has one invariant, and the
// invariant is a handshake between two writers: a frame that declines to draw
// says so, and the next tick asks again. Spread across the update loop it was a
// flag three places set and one place read, with the ordering written down in a
// comment. Here there is one writer.
//
// What it cannot do is draw. Folding an answer is the Renderer's, and writing it
// past Eva's mark is the transcript's; both are the console's to reach, and
// neither is this module's. So the drawing crosses in as one function, which is
// also the seam: a run hands over the fold, and a test hands over something whose
// cost it chose.
type live struct {
	// arriving is the answer so far, as the provider sent it. It is never what a
	// turn leaves behind — see refresh, and ADR 0015.
	arriving strings.Builder

	// The last drawing: the rows, the text they were drawn from, when that
	// happened, and what it cost.
	//
	// Folding an answer costs time proportional to its length, and an answer that
	// is still arriving is folded from the start each time — so the last frame of
	// a long turn is the most expensive one, and it lands on the goroutine that
	// reads the keys. These four are the evidence to decide with: a fold that took
	// ten milliseconds is one to do less often, and a fold that took none is free.
	// See rows.
	lines []string
	text  string
	at    time.Time
	cost  time.Duration

	// owing is whether the answer has moved on from what was last drawn: chunks
	// have arrived, or a frame declined to draw them. It is what the spinner's
	// tick reads to decide whether there is a frame to compose at all.
	owing bool

	// share is how much of the clock the drawing may spend: the next fold waits
	// until this many times the last one's cost has passed. It is the Theme's, and
	// it is held rather than asked for per frame because a frame asks twelve times
	// a second and a Theme changes once.
	share int

	// draw folds the answer and writes it past the mark, and is the whole of what
	// this module reaches of the console. A zero live never calls it: nothing
	// arrives at a console that was never given one.
	draw func(text string) []string
}

// newLive builds the Live area for a console.
//
// The share is the Theme's LiveShare, and the drawing is the console's fold. Both
// are handed over rather than read, because this module knows no Theme and holds
// no Renderer.
func newLive(draw func(text string) []string, share int) live {
	return live{share: share, draw: draw}
}

// write takes one piece of an answer.
//
// It is kept, not drawn. A chunk is a few tokens and they arrive in their
// thousands, while a screen is redrawn tens of times a second at most — so
// composing a frame on every one is work thrown away between frames, and it is
// work proportional to the whole transcript each time. The tick draws what has
// piled up; see due.
func (l *live) write(text string) {
	l.arriving.WriteString(text)
	l.owing = true
}

// due reports whether anything has arrived that has not been drawn, and takes the
// answer with it.
//
// It is taken rather than read because the frame it asks for may itself decline —
// see rows, which sets the flag back. Clearing after the frame instead would drop
// whatever arrived while the frame was being composed.
func (l *live) due() bool {
	owed := l.owing
	l.owing = false
	return owed
}

// rows is the answer so far, drawn — or the last drawing of it, when drawing it
// again would cost more of the clock than the interface may spend. It is empty
// when no Run is arriving.
//
// The fold is the most expensive thing this interface does, and its cost grows
// with the answer: a page costs a fraction of a millisecond and a long answer
// with a listing in it costs several. It runs in the update loop, which is also
// what reads the keys, so a fold that takes ten milliseconds is ten milliseconds
// a keystroke waits — and it is paid on every frame of a turn, twelve times a
// second, for an answer that grew by a few words.
//
// So the fold pays for itself out of the clock. What it took last time is
// measured, and the next one waits until a multiple of that has passed. A cheap
// answer folds on every frame, because a fold that costs nothing has nothing to
// wait for; an expensive one folds less often, and how much less is decided by
// what it actually costs on this machine rather than by a number somebody
// guessed. What a person sees is the answer arriving slightly behind the wire, by
// a fraction of the time the fold itself takes.
//
// A fixed interval was the alternative and it is the wrong shape. The frame is
// already twelve a second, so an interval has to reach a quarter of a second
// before it saves anything worth having — and a quarter of a second is a visible
// stutter on the short answers that never needed slowing down. The cost is what
// varies, so the cost is what the rule reads.
//
// Declining to draw leaves the interface behind the text, so the debt stays owed
// and the next tick asks again. Nothing is lost by waiting: the answer that
// replaces this is the record's, and it does not come from here.
func (l *live) rows() []string {
	text := trimBlank(l.arriving.String())
	if text == "" {
		return nil
	}
	if text == l.text {
		return l.lines
	}
	if l.lines != nil && time.Since(l.at) < l.cost*time.Duration(l.share) {
		l.owing = true
		return l.lines
	}

	at := time.Now()
	lines := l.draw(text)
	l.cost = time.Since(at)
	l.at = at
	l.text = text
	l.lines = lines
	return lines
}

// forget drops the answer that was arriving, and the drawing of it.
//
// One method for both, because they are one fact in two forms: a turn that has
// ended has no arriving text, and a drawing of text that no longer exists is a
// drawing the next turn could show for a moment before its own first chunk.
func (l *live) forget() {
	l.arriving.Reset()
	l.stale()
}

// stale says the drawing is no longer what the answer looks like, so the next
// frame makes a new one whatever it costs.
//
// The cost goes with it. What it recorded was the price of drawing at a width or
// a style that has since changed, and a bound taken from a stale measurement is a
// bound on the wrong thing.
func (l *live) stale() {
	l.lines = nil
	l.text = ""
	l.cost = 0
}
