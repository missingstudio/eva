package ui

import (
	"context"
	"fmt"
	"io"
	"strconv"
	"strings"

	"charm.land/glamour/v2"
	"charm.land/glamour/v2/styles"
	"charm.land/lipgloss/v2"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/theme"
)

// Screen is where a finished turn goes.
//
// A Renderer folds Events into a turn and hands the whole of it over; what
// happens to it then belongs to whoever owns the destination. The console owns
// the terminal and puts the turn above its own view, which it does with the
// bytes exactly as it was handed them — so it reduces the colour first, and it
// can only do that if the turn arrives whole rather than in pieces. A Screen
// writing to a plain byte stream reduces the colour on the way out instead.
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

	// session is what the whole conversation has cost, folded from the Usage
	// records the Trace holds. There is no per-turn counter beside it: nothing
	// reports one, and a second sum kept for no reader is a second sum to keep
	// right.
	session spend

	// missing is what the Run did not understand, from the caveat that closes
	// it. A person is shown it for the same reason the Trace carries it: a cost
	// line over data known to be incomplete, printed with nothing to say so, is
	// a figure that reads as a measurement.
	missing []string

	// kept is every turn this Session has answered, in the form it can be drawn
	// again from. It is what lets a window that changed size take the turns
	// already on screen with it; see Kept.
	kept []turn

	// dark and width are what the markdown renderer is built against. They are
	// held because either can change after a Renderer exists — a terminal
	// answers late about its colour, and a window is resized — and rebuilding
	// for one must not discard the other.
	dark  bool
	width int

	// look is the colours and glyphs this draws with. It is held so that a
	// rebuild for a resize keeps what a person configured.
	look theme.Theme
}

// New builds a Renderer that shows each finished turn on a Screen.
//
// There is one constructor and the caller names its Screen, because which
// destination a turn goes to is the decision the seam exists for. A second
// constructor that picked one would be the same decision made in two places,
// and the one it picked would be the one nobody thought about.
//
// look is how the turn is drawn. It is handed in rather than detected, because
// detecting the background means querying the terminal and this package holds
// none — the frontend that owns the outside world asks, and hands in the
// answer along with whatever a person configured.
//
// theme.Default(dark) is the whole of what this took before, so a caller with
// nothing to say passes exactly that and sees exactly what it saw.
func New(screen Screen, look theme.Theme) (*Renderer, error) {
	r := &Renderer{screen: screen, dark: look.Dark, look: look}
	if err := r.rebuild(); err != nil {
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
	r.dark = dark
	// For rather than Default: the answer corrects the colours nobody chose and
	// leaves alone the ones somebody did. Rebuilding from the default here
	// would drop a configured grey the moment the terminal answered, and the
	// console — which keeps its own copy — would go on using it. One colour
	// named in two places, disagreeing, which is what this package's Subdued
	// exists to prevent.
	r.look = r.look.For(dark)
	return r.rebuild()
}

// Width tells the Renderer how many columns an answer may use.
//
// It exists because the markdown renderer wraps at a fixed width chosen when it
// is built, and the frontend that owns a window learns the real one later and
// again on every resize. Left alone it wraps at eighty, which is a paragraph
// that overruns every narrower window and stops short in every wider one.
//
// A width of zero or less keeps the default, because a window that has not said
// how wide it is has not said anything worth acting on.
func (r *Renderer) Width(cols int) error {
	if cols == r.width {
		return nil
	}
	r.width = cols
	return r.rebuild()
}

// rebuild makes the markdown renderer the current background and width call
// for. It is one function because the two settings are one object: rebuilding
// for a resize must not forget what colour the terminal is, and the way to
// guarantee that is to never build from one of them alone.
func (r *Renderer) rebuild() error {
	// The markdown renderer no longer detects a background for itself and
	// defaults to dark, so the style is named here rather than left to it.
	style := styles.LightStyleConfig
	if r.dark {
		style = styles.DarkStyleConfig
	}

	// No margin of its own. The standard styles indent a document by two
	// columns, which is an indent the frontend cannot see, cannot match while an
	// answer is still arriving, and cannot count when it wraps a line to a
	// window. What a turn is inset by is one decision, and it belongs to
	// whoever draws the rest of the screen — so this hands back text at column
	// zero and leaves the inset to them.
	none := uint(0)
	style.Document.Margin = &none

	options := []glamour.TermRendererOption{glamour.WithStyles(style)}
	if r.width > 0 {
		options = append(options, glamour.WithWordWrap(r.width))
	}

	markdown, err := glamour.NewTermRenderer(options...)
	if err != nil {
		return fmt.Errorf("ui: build the markdown renderer: %w", err)
	}

	r.markdown = markdown
	r.costStyle = r.look.Subdued()
	return nil
}

// Subdued is the style of what sits beside an answer rather than inside it:
// the cost line here, and — in the frontend that has them — a prompt echoed
// back and a status line. All of it is subordinate to the answer, which is a
// person's reason for being here.
//
// It is exported because it was written twice. The frontend cannot import the
// two greys without importing this package, and two packages naming one colour
// is two places to change it and one place to forget.
//
// The colour itself is the Theme's now, so a person who chose one is obeyed
// here as well as on the status line.
func Subdued(dark bool) lipgloss.Style { return theme.Default(dark).Subdued() }

// stream is the Screen a byte stream is: it writes the turn out, and that is
// where the colour meets a destination that has a capability to be reduced to.
type stream struct{ out io.Writer }

// Show writes one finished turn.
func (s stream) Show(turn string) error {
	// Through lipgloss rather than to the writer directly: this is where
	// colour is adapted to what the terminal can show, and where a terminal
	// that shows none has the escapes removed rather than printed.
	if _, err := lipgloss.Fprint(s.out, turn); err != nil {
		return fmt.Errorf("ui: write the turn: %w", err)
	}
	return nil
}

// Committed folds one committed Event into what the person sees.
//
// Only the kinds that a person reads fold. Started opens a turn, Text is the
// answer, Usage is what it cost, and Degraded is what the Run did not
// understand; Finished is what makes all four appear, because a turn is shown
// when it is over.
//
// Degraded arrives in the group Finished closes on, so it is folded before the
// turn is written rather than after it.
//
// A kind this does not fold shows nothing, and Silent below is where that is
// said out loud. The schema is open — a kind can be added to it — and a fold
// that met a new one by falling off the end of a switch would show a person
// nothing and tell nobody it had decided to.
func (r *Renderer) Committed(_ context.Context, e events.Event) error {
	switch payload := e.Payload.(type) {
	case events.Started:
		r.reset()

	case events.Text:
		r.answer.WriteString(payload.Chunk)

	case events.Usage:
		r.session.add(payload)

	case events.Degraded:
		r.missing = append(r.missing, payload.Missing...)

	case events.Finished:
		return r.show()
	}
	return nil
}

// Shown is every kind this fold puts on a screen.
//
// It is a list rather than something read off the switch above because Go
// cannot be asked what a type switch handles. What keeps the two honest is the
// test that walks the schema's own registry: a kind in neither this nor Silent
// fails the build, so adding one to events is a decision about what a person
// sees rather than a silence nobody chose.
func Shown() []events.Kind {
	return []events.Kind{
		events.KindStarted,
		events.KindText,
		events.KindUsage,
		events.KindDegraded,
		events.KindFinished,
	}
}

// Silent is every kind this fold deliberately shows nothing for, and why.
//
// Each is real, recorded, and not something a person reads a turn as. The
// reason is written down because "it does not appear" and "nobody has got to it
// yet" look identical on a screen, and only one of them is a decision.
func Silent() map[events.Kind]string {
	return map[events.Kind]string{
		events.KindToolCall:   "a tool call is shown by the frontend that approves it, at stage 2",
		events.KindToolResult: "the disposition of a call belongs beside the call, at stage 2",
		events.KindEdit:       "an edit is shown as a diff to approve, at stage 2",
		events.KindRetry:      "an attempt that produced nothing is a cost, and the cost line already carries it",
		events.KindNeedsHuman: "an escalation is answered rather than read, and gets its own surface",
		events.KindUnknown:    "a kind this build cannot read has nothing to render; the Run says it was degraded",
	}
}

// reset clears what belongs to one turn. A turn opening is what ends the last
// one's claim on the figures, so this is where they go.
//
// The Session's spend is not part of that: it outlives every turn it is a sum
// of. Neither is what has been written out — see show.
func (r *Renderer) reset() {
	r.answer.Reset()
	r.missing = nil
}

// Cost is what the last turn cost and what the Session has cost so far, for a
// caller that is asking rather than finishing a turn.
//
// It is the same fold the footer shows, so the two cannot disagree about one
// Session. What it adds is the caveat in full: a footer has one line and shares
// it with the model, and a person who asks about cost is owed the whole of what
// the figures do not cover.
func (r *Renderer) Cost() string {
	line := "session " + r.spent()
	if caveat := r.caveat(); caveat != "" {
		// Before the figures, because it qualifies them. A reader who has
		// already taken them as whole has read them once too many.
		line = caveat + "\n" + line
	}
	return r.cost().Render(line)
}

// cost is the style the figures are written in, folded to the window when there
// is one to fold to. The line names two spends and a caveat, which in a narrow
// window is wider than the window.
func (r *Renderer) cost() lipgloss.Style {
	if r.width <= 0 {
		return r.costStyle
	}
	return r.costStyle.Width(r.width)
}

// spent is what the Session has cost, as figures.
//
// The Session and not the turn. A per-turn figure was reported beside it, and it
// was the figure that aged fastest: true for one turn, restated on the next, and
// never the number a person is actually deciding on. What a conversation has
// cost is one number that keeps changing, and it is the one worth asking for.
//
// The cache figures ride here now. They were held to the turn to keep the line
// to one line, and there is room for them once the turn is not on it — which
// matters, because the ratio of cache written to cache read is the largest
// single lever on what a conversation costs.
func (r *Renderer) spent() string {
	return segments(r.session.tokens(), r.session.cache(), r.session.money())
}

// caveat is what the Run did not understand, and is empty for a Run that was
// whole.
//
// It is separate from the figures because it outlives them on screen. The
// figures a turn cost are no longer written under the turn — a person reads an
// answer, not an invoice, and what a Session has spent is on the footer where it
// is true continuously rather than restated after every answer. What the Run
// could not account for still goes under the answer it belongs to, because it
// qualifies that turn and no other.
func (r *Renderer) caveat() string {
	if len(r.missing) == 0 {
		return ""
	}
	return "degraded: " + strings.Join(r.missing, ", ")
}

// Session is what this Session has cost so far, for a frontend that shows it
// continuously.
//
// It is the same fold over the same Usage records /cost answers with, so the
// footer and the command cannot disagree about one Session.
func (r *Renderer) Session() string {
	// Nothing spent is nothing to say. A Session that has not run a turn would
	// otherwise open with "no usage reported · cost unreported", which is a
	// footer telling a person about the absence of something they have not
	// asked for yet.
	if r.session.records == 0 {
		return ""
	}
	if caveat := r.caveat(); caveat != "" {
		// Not the whole caveat, which names what was missed and is a sentence.
		// A footer has one line and shares it with the model, so what it can
		// carry is that the figure beside it is short by an unknown amount.
		return r.spent() + " · degraded"
	}
	return r.spent()
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
	// The turns go with the Session that answered them. What was cleared is in
	// the Trace, which is the only place it was ever the account of anything.
	r.kept = nil
}

// show hands the turn to the screen: the answer, then what it cost.
//
// The whole turn goes over in one call. A turn handed over in three would be
// three things to a screen that places what it is given, and the answer, the
// caveat, and the figures are one thing a person reads.
func (r *Renderer) show() error {
	kept := turn{
		answer: strings.TrimSpace(r.answer.String()),
		// Frozen here rather than re-read later: it is what this Run failed to
		// account for, and a turn redrawn at another width must still carry its
		// own caveat rather than whichever one is current.
		caveat: r.caveat(),
	}
	// A Run that produced neither an answer nor a caveat has nothing to show,
	// and showing nothing is not the same as showing an empty thing: a frontend
	// that marks each turn down its left-hand side would draw a mark against no
	// text at all. It is not kept either, because what is not drawn cannot be
	// redrawn at another width.
	//
	// This is the turn that broke before a word arrived, and what happened to it
	// is the frontend's to say. The record of why is already committed.
	if kept.answer == "" && kept.caveat == "" {
		r.answer.Reset()
		return nil
	}
	r.kept = append(r.kept, kept)

	drawn, err := r.draw(kept)
	if err != nil {
		return err
	}
	if err := r.screen.Show(drawn); err != nil {
		return err
	}

	// The answer is cleared as it is written, so a close with no open between
	// could not write it twice. What the turn cost and what it did not
	// understand stay: they are what Cost answers with until the next turn
	// opens.
	r.answer.Reset()
	return nil
}

// turn is a finished turn in the form it can be drawn again from.
//
// The markdown is kept rather than only the bytes it rendered to, because those
// bytes are wrapped to the window that was there at the time. A window is
// resized, and a paragraph wrapped to the old one is either overrunning the new
// one or standing in a column in the middle of it.
type turn struct {
	answer string
	caveat string
}

// draw is one finished turn at the current width: the answer, the caveat if the
// Run carried one, and the cost line.
//
// The whole turn goes over in one call. A turn handed over in three would be
// three things to a screen that places what it is given, and the answer, the
// caveat, and the figures are one thing a person reads.
func (r *Renderer) draw(t turn) (string, error) {
	var out strings.Builder

	if t.answer != "" {
		styled, err := r.markdown.Render(t.answer)
		if err != nil {
			return "", fmt.Errorf("ui: the answer: %w", err)
		}
		out.WriteString(styled)
	}

	// No figures under the answer. What a turn cost was written here on every
	// turn, which made a conversation read as a run of receipts — and the
	// number a person actually watches is the cumulative one, which a per-turn
	// line states and then immediately makes stale. It lives on the footer now,
	// where it is true continuously, and /cost still breaks it down on demand.
	//
	// The caveat stays. Figures known to be incomplete are one problem; a turn
	// that could not account for itself, with nothing on screen to say so, is a
	// worse one. It is wrapped to the answer's width because unwrapped it would
	// be the one thing on a narrow screen that runs off the edge.
	if t.caveat != "" {
		out.WriteString(r.cost().Render(t.caveat))
		out.WriteString("\n")
	}
	return out.String(), nil
}

// Arriving renders an answer that is still coming, for the live area.
//
// It is the same renderer, at the same width, as the turn that will replace it.
// That is the whole of why it exists: a person watching an answer arrive and
// then watching it be replaced should not see it change shape. Raw markdown
// while it streams and a rendered document a moment later are two different
// pictures of one answer, and the switch between them is the most visible thing
// on the screen at the moment it happens.
//
// This renders text; it does not fold Events, and nothing it returns is kept.
// The caller holds the chunks for exactly as long as the Run lasts and throws
// them away — what a person keeps still comes only from the record, and this
// makes no claim about what was committed. Markdown that is half-written
// renders as what it is so far, which is the honest picture of an answer that
// is half-written.
func (r *Renderer) Arriving(text string) (string, error) {
	styled, err := r.markdown.Render(text)
	if err != nil {
		return "", fmt.Errorf("ui: the arriving answer: %w", err)
	}
	return styled, nil
}

// Kept is every turn this Session has answered, drawn at the current width.
//
// It is for the frontend that holds what it has drawn and has just been told the
// window is a different size. The markdown is re-rendered rather than the old
// bytes re-flowed, because re-flowing styled output means guessing where a
// heading ended and a fenced block began — and the source that answers both is
// already here.
//
// The order is the order they were answered in. A caller interleaving them with
// its own lines can rely on that and on nothing else: this says nothing about
// what a console put between two turns.
func (r *Renderer) Kept() ([]string, error) {
	out := make([]string, 0, len(r.kept))
	for _, t := range r.kept {
		drawn, err := r.draw(t)
		if err != nil {
			return nil, err
		}
		out = append(out, drawn)
	}
	return out, nil
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
	in, out, cacheWrite, cacheRead tally

	usd float64
	// records is how many Usage records this is a sum of, and priced is how
	// many of those carried a dollar figure.
	records int
	priced  int
}

func (s *spend) add(u events.Usage) {
	s.in.add(u.InputTokens)
	s.out.add(u.OutputTokens)
	s.cacheWrite.add(u.CacheWriteTokens)
	s.cacheRead.add(u.CacheReadTokens)

	s.records++
	if u.USD != nil {
		s.usd += *u.USD
		s.priced++
	}
}

// tally sums one counter across a set of Usage records, and counts how many of
// them carried it.
//
// The count is what keeps a partial sum from reading as a whole one. A set
// where one record reported nothing sums to a figure that looks complete and is
// short by an unknown amount, which is the same confidently-wrong report the
// nullable counter exists to prevent — the absence has to survive the addition.
type tally struct {
	sum      uint64
	reported int
}

func (t *tally) add(n *uint64) {
	if n == nil {
		return
	}
	t.sum += *n
	t.reported++
}

// whole says the figure covers every record it is a sum of.
func (t tally) whole(records int) bool { return records > 0 && t.reported == records }

// tokens is what went in and what came out, when every turn said. A set that
// one turn was silent about has no total to state: naming the figure anyway
// would put a number a person budgets against next to a caveat they have to
// notice, and the number would win.
func (s spend) tokens() string {
	if !s.in.whole(s.records) || !s.out.whole(s.records) {
		return "no usage reported"
	}
	return count(s.in.sum) + " in / " + count(s.out.sum) + " out"
}

// cache is the write and the read, apart. A cache write costs more than base
// input and a cache read costs far less, so one figure could not compute a
// cost — and the ratio of the two is the largest single lever on what a
// conversation costs. It is absent from the line when nothing used a cache, and
// when a turn did not say what it used.
func (s spend) cache() string {
	if !s.cacheWrite.whole(s.records) || !s.cacheRead.whole(s.records) {
		return ""
	}
	if s.cacheWrite.sum+s.cacheRead.sum == 0 {
		return ""
	}
	return "cache " + count(s.cacheWrite.sum) + " write / " + count(s.cacheRead.sum) + " read"
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
