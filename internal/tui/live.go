package tui

import (
	"strings"
	"time"
)

type live struct {
	// arriving is the answer so far, as the provider sent it. It is never what a
	// turn leaves behind — see refresh, and ADR 0015.
	arriving strings.Builder

	// The last drawing: the rows, the text they were drawn from, when that
	// happened, and what it cost.
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

func newLive(draw func(text string) []string, share int) live {
	return live{share: share, draw: draw}
}

func (l *live) write(text string) {
	l.arriving.WriteString(text)
	l.owing = true
}

func (l *live) due() bool {
	owed := l.owing
	l.owing = false
	return owed
}

// rows is the answer so far, drawn — or the last drawing of it, when drawing it
// again would cost more of the clock than the interface may spend. It is empty
// when no Run is arriving.
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

func (l *live) forget() {
	l.arriving.Reset()
	l.stale()
}

// stale says the drawing is no longer what the answer looks like, so the next
// frame makes a new one whatever it costs.
func (l *live) stale() {
	l.lines = nil
	l.text = ""
	l.cost = 0
}
