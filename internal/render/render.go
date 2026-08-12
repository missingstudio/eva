package render

import (
	"context"
	"fmt"
	"image/color"
	"io"
	"strconv"
	"strings"
	"time"

	"charm.land/glamour/v2"
	"charm.land/glamour/v2/ansi"
	"charm.land/glamour/v2/styles"
	"charm.land/lipgloss/v2"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/theme"
)

type Screen interface {
	// Show displays one finished turn: the answer, the caveat if the Run
	// carried one, and the cost line.
	Show(turn string) error
}

type Renderer struct {
	screen    Screen
	markdown  *glamour.TermRenderer
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

	// opened is when the Run in flight opened, taken from the record rather than
	// from a clock here. What it is for is the figure below.
	opened events.Timestamp
	// elapsed is how long the turn took, from the Started record to the Finished
	// one. It is a fold over two timestamps the Trace holds, which is what makes
	// it something a person may be shown: nothing here times anything.
	elapsed time.Duration

	// missing is what the Run did not understand, from the caveat that closes
	// it. A person is shown it for the same reason the Trace carries it: a cost
	// line over data known to be incomplete, printed with nothing to say so, is
	// a figure that reads as a measurement.
	missing []string

	// kept is every turn this Session has answered, in the form it can be drawn
	// again from. It is what lets a window that changed size take the turns
	// already on screen with it; see Kept.
	kept []turn

	// bg and width are what the markdown renderer is built against. Either can
	// change after a Renderer exists — a terminal answers late about its
	// colour, and a window is resized — and rebuilding for one must not
	// discard the other.
	bg    theme.Background
	width int

	// look is the colours and glyphs this draws with. It is held so that a
	// rebuild for a resize keeps what a person configured.
	look theme.Theme

	timing bool
}

type Option func(*Renderer)

func WithTiming() Option { return func(r *Renderer) { r.timing = true } }

func New(screen Screen, look theme.Theme, opts ...Option) (*Renderer, error) {
	r := &Renderer{screen: screen, bg: look.Background, look: look}
	for _, opt := range opts {
		opt(r)
	}
	if err := r.rebuild(); err != nil {
		return nil, err
	}
	return r, nil
}

func Stream(out io.Writer) Screen { return stream{out: out} }

func (r *Renderer) Background(bg theme.Background) error {
	r.bg = bg
	// For rather than Default: the answer corrects the colours nobody chose and
	// leaves alone the ones somebody did. Rebuilding from the default here
	// would drop a configured grey the moment the terminal answered, and the
	// console — which keeps its own copy — would go on using it. One colour
	// named in two places, disagreeing, which is what this package's Subdued
	// exists to prevent.
	r.look = r.look.For(bg)
	return r.rebuild()
}

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
	switch {
	case r.look.Markdown.Plain:
		// No colour, and ASCII for the marks. It is the style a destination with
		// no colour capability would have got anyway, asked for on purpose.
		style = styles.ASCIIStyleConfig
	case r.bg == theme.Dark:
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

	paint(&style, r.look.Markdown)

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

func paint(style *ansi.StyleConfig, look theme.Markdown) {
	// A heading colour reaches every level, and takes the band of colour behind
	// the first one with it.
	if look.Heading != nil {
		hex := hexOf(look.Heading)
		for _, level := range []*ansi.StyleBlock{
			&style.Heading, &style.H1, &style.H2, &style.H3, &style.H4, &style.H5, &style.H6,
		} {
			level.Color = &hex
			level.BackgroundColor = nil
		}
	}

	for _, m := range []struct {
		want color.Color
		into **string
	}{
		{look.Code, &style.Code.Color},
		{look.CodeBlock, &style.CodeBlock.Color},
		{look.Emphasis, &style.Emph.Color},
		{look.Emphasis, &style.Strong.Color},
		{look.Link, &style.Link.Color},
		{look.LinkText, &style.LinkText.Color},
		{look.Quote, &style.BlockQuote.Color},
	} {
		if m.want == nil {
			continue
		}
		hex := hexOf(m.want)
		*m.into = &hex
	}
}

func hexOf(c color.Color) string {
	r, g, b, _ := c.RGBA()
	return fmt.Sprintf("#%02x%02x%02x", r>>8, g>>8, b>>8)
}

type stream struct{ out io.Writer }

func (s stream) Show(turn string) error {
	// Through lipgloss rather than to the writer directly: this is where
	// colour is adapted to what the terminal can show, and where a terminal
	// that shows none has the escapes removed rather than printed.
	if _, err := lipgloss.Fprint(s.out, turn); err != nil {
		return fmt.Errorf("ui: write the turn: %w", err)
	}
	return nil
}

func (r *Renderer) Committed(_ context.Context, e events.Event) error {
	switch payload := e.Payload.(type) {
	case events.Started:
		r.reset()
		r.opened = e.At

	case events.Text:
		r.answer.WriteString(payload.Chunk)

	case events.Usage:
		r.session.add(payload)

	case events.Degraded:
		r.missing = append(r.missing, payload.Missing...)

	case events.Finished:
		r.elapsed = span(r.opened, e.At)
		return r.show()
	}
	return nil
}

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

func (r *Renderer) reset() {
	r.answer.Reset()
	r.missing = nil
	r.elapsed = 0
	r.opened = events.Timestamp{}
}

// Cost is what the last turn cost and what the Session has cost so far, for a
// caller that is asking rather than finishing a turn.
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

func (r *Renderer) spent() string {
	return segments(r.session.tokens(), r.session.cache(), r.session.money())
}

func (r *Renderer) caveat() string {
	if len(r.missing) == 0 {
		return ""
	}
	return "degraded: " + strings.Join(r.missing, ", ")
}

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

func (r *Renderer) Cleared() {
	r.reset()
	r.session = spend{}
	// The turns go with the Session that answered them. What was cleared is in
	// the Trace, which is the only place it was ever the account of anything.
	r.kept = nil
}

func (r *Renderer) show() error {
	kept := turn{
		took:   r.elapsed,
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

type turn struct {
	answer string
	caveat string
	// took is how long the Run took. It is frozen with the turn for the reason
	// the caveat is: a turn redrawn at another width is still the turn that took
	// this long.
	took time.Duration
}

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
	if t.caveat != "" {
		out.WriteString(r.cost().Render(t.caveat))
		out.WriteString("\n")
	}

	// How long it took, under the answer it belongs to.
	if took := r.took(t); took != "" {
		out.WriteString(r.cost().Render(took))
		out.WriteString("\n")
	}
	return out.String(), nil
}

func (r *Renderer) Arriving(text string) (string, error) {
	styled, err := r.markdown.Render(text)
	if err != nil {
		return "", fmt.Errorf("ui: the arriving answer: %w", err)
	}
	return styled, nil
}

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

func span(from, to events.Timestamp) time.Duration {
	if from.Mono > 0 && to.Mono > 0 {
		return max(0, time.Duration(to.Mono-from.Mono))
	}
	if from.Wall.IsZero() || to.Wall.IsZero() {
		return 0
	}
	return max(0, to.Wall.Sub(from.Wall))
}

func (r *Renderer) took(t turn) string {
	seconds := r.look.Layout.ElapsedSeconds
	if !r.timing || seconds <= 0 || t.took <= 0 {
		return ""
	}
	if t.took < time.Duration(seconds)*time.Second {
		return ""
	}
	return "took " + t.took.Round(100*time.Millisecond).String()
}

func segments(parts ...string) string {
	kept := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			kept = append(kept, part)
		}
	}
	return strings.Join(kept, " · ")
}

type spend struct {
	in, out, cacheWrite, cacheRead tally

	usd     float64
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
