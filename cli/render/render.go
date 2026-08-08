// Package render is the projection that shows a turn to a person.
//
// It folds committed Events into a rendered answer and a cost line, and it
// reads nothing else. What it may import is the contract, and it is a short
// list: the Event schema, and the terminal libraries. No provider, no Session,
// and no path to the Trace — a renderer that could reach any of those could
// show a turn the record does not hold, and the machine-readable path, which
// builds no renderer at all, would stop describing the same turn.
//
// That list is an allow list in the linter rather than a promise in this
// comment, because a boundary this layer only documents is a boundary the next
// import quietly crosses.
package render

import (
	"context"
	"fmt"
	"io"
	"strconv"
	"strings"

	"charm.land/glamour/v2"
	"charm.land/glamour/v2/styles"
	"charm.land/lipgloss/v2"
	"github.com/missingstudio/eva/events"
)

// Screen is where a finished turn goes.
//
// A Renderer folds Events into a turn and hands the whole of it over; what
// happens to it then belongs to whoever owns the destination. The one-shot
// path owns a byte stream and reduces the turn's colour on the way out. The
// interactive program owns the terminal and puts the turn above its own view,
// which it does with the bytes exactly as it was handed them — so it reduces
// the colour first, and it can only do that if the turn arrives whole rather
// than in pieces.
type Screen interface {
	// Show displays one finished turn: the answer, the caveat if the Run
	// carried one, and the cost line.
	Show(turn string) error
}

// Renderer shows committed Events to a person.
//
// It is a Subscriber, which is what makes it a fold over the Trace rather than
// a second account of the turn: it sees a record after the Trace holds it,
// never before. The interface it satisfies is declared in core, and this
// package does not import core to say so — an assertion at the one place a
// Renderer is built is enough, and the shorter import list is worth more.
type Renderer struct {
	screen   Screen
	markdown *glamour.TermRenderer
	// costStyle dims the cost line. It is subordinate to the answer: a
	// developer reads it at the end of a turn, not during one.
	costStyle lipgloss.Style

	// answer accumulates the text of the open Run. Markdown is rendered whole
	// rather than a block at a time, because a heading, a list, and a fenced
	// block are each only meaningful once they are complete.
	answer strings.Builder

	// turn is this Run's spend and session is the Session's. Both are folded
	// from the same Usage records, so they cannot disagree.
	turn    spend
	session spend

	// missing is what the Run did not understand, from the caveat that closes
	// it. A person is shown it for the same reason the machine-readable stream
	// carries it: a cost line over data known to be incomplete, printed with
	// nothing to say so, is a figure that reads as a measurement.
	missing []string
}

// New builds a Renderer that shows each finished turn on a Screen.
//
// There is one constructor and the caller names its Screen, because which
// destination a turn goes to is the decision the seam exists for. A second
// constructor that picked one would be the same decision made in two places,
// and the one it picked would be the one nobody thought about.
//
// dark says whether the terminal has a dark background. It is a parameter
// rather than something this package detects, because detecting it means
// querying the terminal and this package holds no terminal — the frontend that
// owns the outside world asks, and hands in the answer. There is no
// configuration key: a style nobody chose is the only style there is.
func New(screen Screen, dark bool) (*Renderer, error) {
	r := &Renderer{screen: screen}
	if err := r.Background(dark); err != nil {
		return nil, err
	}
	return r, nil
}

// Stream is the Screen a byte stream is: it writes the turn out, with its
// colour reduced to what the destination can show.
//
// It is the Screen for a caller that owns nothing but a writer. A caller that
// owns a terminal passes its own, and reduces the colour itself — a Renderer
// that reduced first would have nothing left to reduce, because a screen is not
// a byte stream and there is nothing to ask what it can show.
func Stream(out io.Writer) Screen { return stream{out: out} }

// Background tells the Renderer what colour the terminal is.
//
// It exists for the caller that learns the answer after the Renderer is built,
// which is the caller that asks the terminal properly: the answer comes back
// as a message, some time after the interface is already up.
//
// What the Session has spent is not disturbed. A terminal that answered late
// must not also reset what the conversation has cost.
func (r *Renderer) Background(dark bool) error {
	// The markdown renderer no longer detects a background for itself and
	// defaults to dark, so the style is named here rather than left to it.
	style := styles.LightStyle
	if dark {
		style = styles.DarkStyle
	}
	markdown, err := glamour.NewTermRenderer(glamour.WithStandardStyle(style))
	if err != nil {
		return fmt.Errorf("render: build the markdown renderer: %w", err)
	}

	r.markdown = markdown
	r.costStyle = Subdued(dark)
	return nil
}

// Subdued is the style of what sits beside an answer rather than inside it:
// the cost line here, and — in the frontend that has them — a prompt echoed
// back and a status line. All of it is subordinate to the answer, which is a
// person's reason for being here.
//
// It is exported because it was written twice. The frontend cannot import the
// two greys below without importing this package, and two packages naming one
// colour is two places to change it and one place to forget.
func Subdued(dark bool) lipgloss.Style {
	return lipgloss.NewStyle().Faint(true).Foreground(lipgloss.LightDark(dark)(subduedOnLight, subduedOnDark))
}

// stream is the Screen a byte stream is: it writes the turn out, and that is
// where the colour meets a destination that has a capability to be reduced to.
type stream struct{ out io.Writer }

// Show writes one finished turn.
func (s stream) Show(turn string) error {
	// Through lipgloss rather than to the writer directly: this is where
	// colour is adapted to what the terminal can show, and where a terminal
	// that shows none has the escapes removed rather than printed.
	if _, err := lipgloss.Fprint(s.out, turn); err != nil {
		return fmt.Errorf("render: write the turn: %w", err)
	}
	return nil
}

// The subdued grey, one per background. Both are true colour, and neither is
// emitted as written: what reaches the terminal is downsampled to what the
// terminal can show.
var (
	subduedOnLight = lipgloss.Color("#5C5C5C")
	subduedOnDark  = lipgloss.Color("#9E9E9E")
)

// Committed folds one committed Event into what the person sees.
//
// Only the kinds that a person reads fold. Started opens a turn, Text is the
// answer, Usage is what it cost, and Degraded is what the Run did not
// understand; Finished is what makes all four appear, because a turn is shown
// when it is over. Every other kind is real and recorded and simply has
// nothing to show at this stage.
//
// Degraded arrives in the group Finished closes on, so it is folded before the
// turn is written rather than after it.
func (r *Renderer) Committed(_ context.Context, e events.Event) error {
	switch payload := e.Payload.(type) {
	case events.Started:
		r.reset()

	case events.Text:
		r.answer.WriteString(payload.Chunk)

	case events.Usage:
		r.turn.add(payload)
		r.session.add(payload)

	case events.Degraded:
		r.missing = append(r.missing, payload.Missing...)

	case events.Finished:
		return r.show()
	}
	return nil
}

// reset clears what belongs to one turn. A turn opening is what ends the last
// one's claim on the figures, so this is where they go.
//
// The Session's spend is not part of that: it outlives every turn it is a sum
// of. Neither is what has been written out — see show.
func (r *Renderer) reset() {
	r.answer.Reset()
	r.turn = spend{}
	r.missing = nil
}

// Cost is what the last turn cost and what the Session has cost so far, for a
// caller that is asking rather than finishing a turn.
//
// It is the same line the end of a turn writes, folded from the same Usage
// records and carrying the same caveat. Two figures assembled twice could
// disagree, and a person reading one of them would have no way to tell which.
func (r *Renderer) Cost() string { return r.costStyle.Render(r.spent()) }

// spent is the caveat and the cost line, which are one thing a person reads:
// figures known to be incomplete, printed with nothing to say so, are figures
// that read as a measurement.
func (r *Renderer) spent() string {
	if len(r.missing) == 0 {
		return costLine(r.turn, r.session)
	}
	return "degraded: " + strings.Join(r.missing, ", ") + "\n" + costLine(r.turn, r.session)
}

// Cleared starts the accounting over, for a console that has emptied its
// transcript and opened a new Session.
//
// The cumulative figure says what a Session has cost, so it belongs to the
// Session that spent it. What was spent is not lost by starting over: the Trace
// holds every Usage record either way.
func (r *Renderer) Cleared() {
	r.reset()
	r.session = spend{}
}

// show hands the turn to the screen: the answer, then what it cost.
//
// The whole turn goes over in one call. A turn handed over in three would be
// three things to a screen that places what it is given, and the answer, the
// caveat, and the figures are one thing a person reads.
func (r *Renderer) show() error {
	var turn strings.Builder

	if answer := strings.TrimSpace(r.answer.String()); answer != "" {
		styled, err := r.markdown.Render(answer)
		if err != nil {
			return fmt.Errorf("render: the answer: %w", err)
		}
		turn.WriteString(styled)
	}

	// The caveat comes before the cost line, because it qualifies it. A reader
	// who has already taken the figures as whole has read them once too many —
	// which is why the two are assembled together, here and on demand.
	turn.WriteString(r.costStyle.Render(r.spent()))
	turn.WriteString("\n")

	if err := r.screen.Show(turn.String()); err != nil {
		return err
	}

	// The answer is cleared as it is written, so a close with no open between
	// could not write it twice. What the turn cost and what it did not
	// understand stay: they are what Cost answers with until the next turn
	// opens.
	r.answer.Reset()
	return nil
}

// costLine is what a turn cost and what the Session has cost so far.
//
// Both, on every turn: per-turn spend is what a developer reacts to, and
// cumulative spend is what tells them a conversation has become expensive
// before it ends. The cache figures ride with the turn only, so that the line
// stays one line.
func costLine(turn, session spend) string {
	return "turn " + segments(turn.tokens(), turn.cache(), turn.money()) +
		" │ session " + segments(session.tokens(), session.money())
}

// segments joins the parts that have something to say.
func segments(parts ...string) string {
	kept := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			kept = append(kept, part)
		}
	}
	return strings.Join(kept, " · ")
}

// spend is what a set of Usage records adds up to.
//
// The dollar figure is summed only when every record in the set carried one.
// A sum over a set where one turn reported nothing looks whole and is short by
// an unknown amount, and a cost report that is confidently wrong is worse than
// one that says it does not know.
type spend struct {
	in, out, cacheWrite, cacheRead uint64

	usd float64
	// records is how many Usage records this is a sum of, and priced is how
	// many of those carried a dollar figure.
	records int
	priced  int
}

func (s *spend) add(u events.Usage) {
	s.in += u.InputTokens
	s.out += u.OutputTokens
	s.cacheWrite += u.CacheWriteTokens
	s.cacheRead += u.CacheReadTokens

	s.records++
	if u.USD != nil {
		s.usd += *u.USD
		s.priced++
	}
}

// tokens is what went in and what came out.
func (s spend) tokens() string {
	if s.records == 0 {
		return "no usage reported"
	}
	return count(s.in) + " in / " + count(s.out) + " out"
}

// cache is the write and the read, apart. A cache write costs more than base
// input and a cache read costs far less, so one figure could not compute a
// cost — and the ratio of the two is the largest single lever on what a turn
// costs. It is absent from the line when the turn used no cache.
func (s spend) cache() string {
	if s.cacheWrite+s.cacheRead == 0 {
		return ""
	}
	return "cache " + count(s.cacheWrite) + " write / " + count(s.cacheRead) + " read"
}

// money is the dollar figure, or the statement that there is none. It is never
// an estimate: a figure derived here would become the number a bill is argued
// from.
func (s spend) money() string {
	if s.records == 0 || s.priced != s.records {
		return "cost unreported"
	}
	if s.usd >= 1 {
		return "$" + strconv.FormatFloat(s.usd, 'f', 2, 64)
	}
	return "$" + strconv.FormatFloat(s.usd, 'f', 4, 64)
}

// count is a token figure at the precision a person reads: exact while it is
// small enough to mean something, and rounded once it is not.
func count(n uint64) string {
	switch {
	case n >= 1_000_000:
		return strconv.FormatFloat(float64(n)/1_000_000, 'f', 1, 64) + "m"
	case n >= 1_000:
		return strconv.FormatFloat(float64(n)/1_000, 'f', 1, 64) + "k"
	default:
		return strconv.FormatUint(n, 10)
	}
}
