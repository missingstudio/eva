package render_test

import (
	"bytes"
	"context"
	"regexp"
	"strings"
	"testing"
	"time"

	"charm.land/lipgloss/v2"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/render"
	"github.com/missingstudio/eva/internal/theme"
)

// These tests feed committed Events to a Renderer and read what it wrote.
// That is the whole of its interface: a Renderer takes Events and produces
// bytes, and there is nothing else to reach for.

func answered(answer string, usage events.Usage) []events.Payload {
	return []events.Payload{
		events.Started{Intent: "what is this project"},
		events.Text{Chunk: answer},
		usage,
		events.Finished{Claim: events.Claim{Result: events.ResultDone}},
	}
}

func show(t *testing.T, bg theme.Background, payloads ...events.Payload) string {
	t.Helper()

	_, out := fold(t, bg, payloads...)
	return out.String()
}

// fold folds the payloads into a Renderer and returns it, along with what it
// wrote. It is what a test that asks a Renderer something uses, rather than one
// that only reads the bytes.
func fold(t *testing.T, bg theme.Background, payloads ...events.Payload) (*render.Renderer, *bytes.Buffer) {
	t.Helper()

	var out bytes.Buffer
	renderer, err := render.New(render.Stream(&out), theme.Default(bg))
	if err != nil {
		t.Fatalf("build a Renderer: %v", err)
	}
	for i, payload := range payloads {
		e := events.Event{
			Seq:     uint64(i + 1),
			Version: events.SchemaVersion,
			Run:     "run_test",
			Session: "sess_test",
			Payload: payload,
		}
		e.Kind, _ = events.KindOf(payload)
		if err := renderer.Committed(context.Background(), e); err != nil {
			t.Fatalf("commit event %d: %v", i+1, err)
		}
	}
	return renderer, &out
}

// timed folds one whole turn whose records carry the two clocks, and returns what
// was written. It is what a test about elapsed time uses: the ordinary helper
// stamps no time, because nothing else in this package reads one.
func timed(t *testing.T, opened, closed events.Timestamp, opts ...render.Option) string {
	t.Helper()

	var out bytes.Buffer
	renderer, err := render.New(render.Stream(&out), theme.Default(theme.Dark), opts...)
	if err != nil {
		t.Fatalf("build a Renderer: %v", err)
	}

	records := []struct {
		at      events.Timestamp
		payload events.Payload
	}{
		{opened, events.Started{Intent: "how long did this take"}},
		{closed, events.Text{Chunk: "an answer"}},
		{closed, events.Finished{Claim: events.Claim{Result: events.ResultDone}}},
	}
	for i, record := range records {
		e := events.Event{
			Seq:     uint64(i + 1),
			At:      record.at,
			Version: events.SchemaVersion,
			Run:     "run_test",
			Session: "sess_test",
			Payload: record.payload,
		}
		e.Kind, _ = events.KindOf(record.payload)
		if err := renderer.Committed(context.Background(), e); err != nil {
			t.Fatalf("commit event %d: %v", i+1, err)
		}
	}
	return out.String()
}

func at(seconds int) events.Timestamp {
	return events.Timestamp{
		Wall: time.Unix(int64(seconds), 0).UTC(),
		Mono: int64(seconds) * int64(time.Second),
	}
}

func TestAColourNamedForTheAnswerReachesIt(t *testing.T) {
	t.Setenv("CLICOLOR_FORCE", "1")

	const answer = "# A heading\n\nand a paragraph"

	drawn := func(look theme.Theme) string {
		t.Helper()

		var out bytes.Buffer
		renderer, err := render.New(render.Stream(&out), look)
		if err != nil {
			t.Fatalf("build a Renderer: %v", err)
		}
		for i, payload := range answered(answer, events.Usage{}) {
			e := events.Event{Seq: uint64(i + 1), Version: events.SchemaVersion, Payload: payload}
			e.Kind, _ = events.KindOf(payload)
			if err := renderer.Committed(context.Background(), e); err != nil {
				t.Fatalf("commit event %d: %v", i+1, err)
			}
		}
		return out.String()
	}

	named := theme.Default(theme.Dark)
	named.Markdown.Heading = lipgloss.Color("#ff00ff")

	// A colour is downsampled to whatever the destination can show, so what is
	// asserted is that naming one changed the bytes rather than which bytes it
	// became. The words must not change: this is a colour, and nothing else.
	with, without := drawn(named), drawn(theme.Default(theme.Dark))
	if with == without {
		t.Error("a heading colour a Theme named changed nothing about the answer")
	}
	if plain(with) != plain(without) {
		t.Errorf("naming a colour changed the words of the answer:\n%q\n%q", plain(with), plain(without))
	}
}

// A turn that took a while says how long it took, and a quick one says nothing.
func TestATurnSaysHowLongItTookWhenItTookLongEnough(t *testing.T) {
	slow := plain(timed(t, at(10), at(14), render.WithTiming()))
	if !strings.Contains(slow, "took 4s") {
		t.Errorf("a turn of four seconds does not say how long it took:\n%s", slow)
	}

	quick := plain(timed(t, at(10), at(10), render.WithTiming()))
	if strings.Contains(quick, "took") {
		t.Errorf("a turn under the threshold reported a figure anyway:\n%s", quick)
	}
}

// A turn written for a script carries the answer and nothing else.
func TestATurnWrittenForAScriptSaysNothingButTheAnswer(t *testing.T) {
	got := plain(timed(t, at(10), at(99)))
	if strings.Contains(got, "took") {
		t.Errorf("a turn written to a stream reported how long it took:\n%s", got)
	}
	if !strings.Contains(got, "an answer") {
		t.Errorf("the answer itself did not survive:\n%s", got)
	}
}

// The figure is read off the monotonic clock, so a wall clock that steps
// backwards mid-turn does not make a turn take a negative amount of time.
func TestTheElapsedFigureSurvivesAWallClockStep(t *testing.T) {
	opened := events.Timestamp{Wall: time.Unix(500, 0).UTC(), Mono: 1 * int64(time.Second)}
	closed := events.Timestamp{Wall: time.Unix(200, 0).UTC(), Mono: 4 * int64(time.Second)}

	got := plain(timed(t, opened, closed, render.WithTiming()))
	if !strings.Contains(got, "took 3s") {
		t.Errorf("the figure did not come from the monotonic reading:\n%s", got)
	}
}

// escape matches an ANSI style sequence, so that a test can assert on the
// words a person reads rather than on the bytes that colour them.
var escape = regexp.MustCompile(`\x1b\[[0-9;]*m`)

func plain(s string) string { return escape.ReplaceAllString(s, "") }

// usd makes a dollar figure addressable. A nil one means the provider did not
// report one, which is the case that must never become a zero.
func usd(v float64) *float64 { return &v }

// The answer arrives as markdown and reaches the terminal as style. Its markup
// is what a renderer is for: text printed with its backticks and asterisks
// intact has not been rendered, it has been echoed.
func TestTheAnswerIsRenderedRatherThanEchoed(t *testing.T) {
	t.Setenv("CLICOLOR_FORCE", "1")

	got := show(t, theme.Dark, answered("Eva is a `factory`, and it is **autonomous**.", events.Usage{})...)
	words := plain(got)

	for _, want := range []string{"Eva is a", "factory", "and it is", "autonomous"} {
		if !strings.Contains(words, want) {
			t.Errorf("the rendered answer does not hold %q:\n%s", want, words)
		}
	}
	for _, markup := range []string{"`", "**"} {
		if strings.Contains(words, markup) {
			t.Errorf("the answer still carries its %q markup — it was echoed, not rendered:\n%s", markup, words)
		}
	}
	if got == words {
		t.Error("the answer carries no style at all")
	}
}

// The style follows the background the terminal reports, and nothing else
// selects it. Two Renderers over one answer must therefore differ.
func TestTheStyleFollowsTheTerminalBackground(t *testing.T) {
	t.Setenv("CLICOLOR_FORCE", "1")

	const answer = "Eva is a software factory."
	dark := show(t, theme.Dark, answered(answer, events.Usage{})...)
	light := show(t, theme.Light, answered(answer, events.Usage{})...)

	if dark == light {
		t.Error("a light terminal and a dark one are shown the same bytes")
	}
	if plain(dark) != plain(light) {
		t.Errorf("the two backgrounds are shown different words, and only the style should differ:\n%q\n%q",
			plain(dark), plain(light))
	}
}

func TestTheCostReportsTheWholeSessionRatherThanTheLastTurn(t *testing.T) {
	var payloads []events.Payload
	payloads = append(payloads, answered("first", events.Usage{InputTokens: events.Tokens(1200), OutputTokens: events.Tokens(340)})...)
	payloads = append(payloads, answered("second", events.Usage{InputTokens: events.Tokens(800), OutputTokens: events.Tokens(60)})...)

	lines := costs(t, payloads...)
	if len(lines) != 2 {
		t.Fatalf("%d cost reports, want one per turn:\n%s", len(lines), strings.Join(lines, "\n"))
	}

	// After one turn, the Session is that turn.
	for _, want := range []string{"1.2k in", "340 out"} {
		if !strings.Contains(lines[0], want) {
			t.Errorf("the Session after one turn does not report %q: %s", want, lines[0])
		}
	}

	// 1200 + 800 and 340 + 60: the sum of both turns, not the last one.
	for _, want := range []string{"2.0k in", "400 out"} {
		if !strings.Contains(lines[1], want) {
			t.Errorf("the Session does not report %q — it is not summing the turns: %s", want, lines[1])
		}
	}
	for _, gone := range []string{"800 in", "60 out"} {
		if strings.Contains(lines[1], gone) {
			t.Errorf("the report still carries the last turn's %q on its own: %s", gone, lines[1])
		}
	}
}

// Cache writes and cache reads are priced differently, and their ratio is the
// largest single lever on what a turn costs. One number cannot carry them.
func TestTheCostLineSeparatesCacheWritesFromCacheReads(t *testing.T) {
	line := costs(t, answered("cached",
		events.Usage{InputTokens: events.Tokens(1200), OutputTokens: events.Tokens(340), CacheWriteTokens: events.Tokens(96), CacheReadTokens: events.Tokens(1024)})...)[0]

	for _, want := range []string{"96 write", "1.0k read"} {
		if !strings.Contains(line, want) {
			t.Errorf("the cost line does not report %q: %s", want, line)
		}
	}
}

// A dollar figure the provider did not report is named as absent. An estimate
// printed here would become the number a bill is argued from.
func TestAnUnreportedDollarFigureIsNamedRatherThanEstimated(t *testing.T) {
	line := costs(t, answered("free?",
		events.Usage{InputTokens: events.Tokens(1200), OutputTokens: events.Tokens(340)})...)[0]

	if strings.Contains(line, "$") {
		t.Errorf("the cost line shows a dollar figure the provider never reported: %s", line)
	}
	if !strings.Contains(line, "cost unreported") {
		t.Errorf("the cost line does not say the dollar figure is missing: %s", line)
	}
}

func TestAReportedDollarFigureIsShownAndAccumulated(t *testing.T) {
	var payloads []events.Payload
	payloads = append(payloads, answered("first", events.Usage{InputTokens: events.Tokens(100), USD: usd(0.0030)})...)
	payloads = append(payloads, answered("second", events.Usage{InputTokens: events.Tokens(100), USD: usd(0.0062)})...)

	lines := costs(t, payloads...)
	if want := "$0.0030"; !strings.Contains(lines[0], want) {
		t.Errorf("the first turn does not report %q: %s", want, lines[0])
	}

	_, session, _ := strings.Cut(lines[1], "session")
	if want := "$0.0092"; !strings.Contains(session, want) {
		t.Errorf("the Session does not report %q — the dollar figures are not summing: %s", want, session)
	}
}

// A Session in which one turn priced itself and another did not has no whole
// figure to report. Summing what is there would produce a number that looks
// complete and is short by an unknown amount.
func TestASessionThatIsPartlyPricedReportsNoDollarFigure(t *testing.T) {
	var payloads []events.Payload
	payloads = append(payloads, answered("priced", events.Usage{InputTokens: events.Tokens(100), USD: usd(0.0030)})...)
	payloads = append(payloads, answered("unpriced", events.Usage{InputTokens: events.Tokens(100)})...)

	session := costs(t, payloads...)[1]
	if strings.Contains(session, "$") {
		t.Errorf("the Session shows a dollar figure over turns that did not all report one: %s", session)
	}
	if !strings.Contains(session, "cost unreported") {
		t.Errorf("the Session does not say the dollar figure is incomplete: %s", session)
	}
}

// A Run that did not understand part of what it saw closes on a caveat, and
// the Trace carries it. A person is shown it too: the screen is a fold over
// what was committed, and a cost line over data known to be incomplete,
// printed with nothing to say so, reads as a measurement.
func TestACaveatIsShownAndNotOnlyRecorded(t *testing.T) {
	got := plain(show(t, theme.Dark,
		events.Started{Intent: "what is this project"},
		events.Text{Chunk: "an answer"},
		events.Usage{InputTokens: events.Tokens(1200), OutputTokens: events.Tokens(340)},
		events.Degraded{Missing: []string{"usage: output tokens", `unknown event kind "quantum_flux"`}},
		events.Finished{Claim: events.Claim{Result: events.ResultDone}},
	))

	caveat := strings.Index(got, "degraded")
	if caveat < 0 {
		t.Fatalf("the rendered turn does not say the Run was degraded:\n%s", got)
	}
	for _, want := range []string{"usage: output tokens", `unknown event kind "quantum_flux"`} {
		if !strings.Contains(got, want) {
			t.Errorf("the caveat does not name %q:\n%s", want, got)
		}
	}
	// The figures are not under the turn any more, and the caveat still is:
	// what a Run could not account for qualifies that turn and no other, while
	// what a Session has spent is one figure a frontend shows continuously.
	if strings.Contains(got, "1.2k") {
		t.Errorf("the rendered turn carries the figures, which belong to the footer:\n%s", got)
	}

	// And where the figures are reported, the caveat still comes first, so that
	// they are read as qualified.
	line := costs(t,
		events.Started{Intent: "what is this project"},
		events.Text{Chunk: "an answer"},
		events.Usage{InputTokens: events.Tokens(1200), OutputTokens: events.Tokens(340)},
		events.Degraded{Missing: []string{"usage: output tokens"}},
		events.Finished{Claim: events.Claim{Result: events.ResultDone}},
	)[0]
	if qualifier, figures := strings.Index(line, "degraded"), strings.Index(line, "session 1.2k"); qualifier < 0 || figures < 0 || qualifier > figures {
		t.Errorf("the caveat does not come before the figures it qualifies:\n%s", line)
	}
}

// A caveat belongs to the Run that carried it, so a later clean turn does not
// inherit it.
func TestACaveatDoesNotSurviveIntoTheNextTurn(t *testing.T) {
	var payloads []events.Payload
	payloads = append(payloads,
		events.Started{Intent: "first"},
		events.Text{Chunk: "an answer"},
		events.Usage{InputTokens: events.Tokens(100)},
		events.Degraded{Missing: []string{"usage: output tokens"}},
		events.Finished{Claim: events.Claim{Result: events.ResultDone}},
	)
	payloads = append(payloads, answered("second", events.Usage{InputTokens: events.Tokens(100)})...)

	got := plain(show(t, theme.Dark, payloads...))
	if strings.Count(got, "degraded") != 1 {
		t.Errorf("the caveat is shown %d times, want once — on the Run that carried it:\n%s",
			strings.Count(got, "degraded"), got)
	}

	// And the figures reported after the clean turn carry no caveat either.
	lines := costs(t, payloads...)
	if len(lines) != 2 {
		t.Fatalf("%d cost reports, want one per turn:\n%s", len(lines), strings.Join(lines, "\n"))
	}
	if strings.Contains(lines[1], "degraded") {
		t.Errorf("a clean turn inherited the caveat of the turn before it:\n%s", lines[1])
	}
}

// A terminal that says what colour it is after the Renderer was built — which
// is every terminal asked properly, because the answer comes back as a message
// — restyles what follows. What it must not do is reset what the Session has
// spent.
func TestALateAnswerAboutTheBackgroundKeepsTheSessionSpend(t *testing.T) {
	t.Setenv("CLICOLOR_FORCE", "1")

	var out bytes.Buffer
	renderer, err := render.New(render.Stream(&out), theme.Default(theme.Dark))
	if err != nil {
		t.Fatalf("build a Renderer: %v", err)
	}

	commit := func(payloads ...events.Payload) {
		t.Helper()
		for i, payload := range payloads {
			e := events.Event{Seq: uint64(i + 1), Version: events.SchemaVersion, Payload: payload}
			e.Kind, _ = events.KindOf(payload)
			if err := renderer.Committed(context.Background(), e); err != nil {
				t.Fatalf("commit %s: %v", e.Kind, err)
			}
		}
	}

	commit(answered("first", events.Usage{InputTokens: events.Tokens(1200), OutputTokens: events.Tokens(340)})...)
	dark := out.String()

	if err := renderer.Background(theme.Light); err != nil {
		t.Fatalf("take the terminal's answer: %v", err)
	}
	out.Reset()
	commit(answered("second", events.Usage{InputTokens: events.Tokens(800), OutputTokens: events.Tokens(60)})...)
	light := out.String()

	session := plain(renderer.Cost())
	for _, want := range []string{"2.0k in", "400 out"} {
		if !strings.Contains(session, want) {
			t.Errorf("the Session does not report %q — the answer reset what it had spent: %s", want, session)
		}
	}
	if plain(dark) == dark || plain(light) == light {
		t.Fatal("one of the turns carries no style at all, so the two cannot be compared")
	}
	if dark == light {
		t.Error("the turn after the answer is styled for the terminal it was not")
	}
}

func costs(t *testing.T, payloads ...events.Payload) []string {
	t.Helper()

	var out bytes.Buffer
	renderer, err := render.New(render.Stream(&out), theme.Default(theme.Dark))
	if err != nil {
		t.Fatalf("build a Renderer: %v", err)
	}

	var lines []string
	for i, payload := range payloads {
		e := events.Event{
			Seq:     uint64(i + 1),
			Version: events.SchemaVersion,
			Run:     "run_test",
			Session: "sess_test",
			Payload: payload,
		}
		e.Kind, _ = events.KindOf(payload)
		if err := renderer.Committed(context.Background(), e); err != nil {
			t.Fatalf("commit event %d: %v", i+1, err)
		}
		if _, closed := payload.(events.Finished); closed {
			lines = append(lines, plain(renderer.Cost()))
		}
	}
	if len(lines) == 0 {
		t.Fatalf("no turn closed, so nothing reported a cost:\n%s", out.String())
	}
	return lines
}

// A Renderer answers what a turn cost after the turn is over, so that a person
// can ask rather than scroll back for the line the turn wrote.
func TestTheCostIsAnsweredOnDemandAfterTheTurnIsOver(t *testing.T) {
	renderer, _ := fold(t, theme.Dark,
		append(
			answered("first", events.Usage{InputTokens: events.Tokens(1200), OutputTokens: events.Tokens(340)}),
			answered("second", events.Usage{InputTokens: events.Tokens(800), OutputTokens: events.Tokens(60)})...,
		)...,
	)

	session := plain(renderer.Cost())
	for _, want := range []string{"2.0k in", "400 out"} {
		if !strings.Contains(session, want) {
			t.Errorf("the cost does not report %q, which is both turns: %s", want, session)
		}
	}
}

// A cleared transcript is a new Session, and its spend starts at nothing. A
// figure that outlived the Session it names would be two conversations summed
// and reported as one.
func TestClearingStartsTheAccountingOver(t *testing.T) {
	renderer, _ := fold(t, theme.Dark, answered("first", events.Usage{InputTokens: events.Tokens(1200), OutputTokens: events.Tokens(340)})...)

	renderer.Cleared()

	line := plain(renderer.Cost())
	if !strings.Contains(line, "no usage reported") {
		t.Errorf("a cleared Renderer still reports a spend: %s", line)
	}
}

// The caveat qualifies the figures, so it travels with them. A cost answered on
// demand over data known to be incomplete, with nothing to say so, is a figure
// that reads as a measurement — which is the reason the end of a turn writes the
// caveat above the cost line in the first place.
func TestTheCostAnsweredOnDemandCarriesTheCaveat(t *testing.T) {
	renderer, _ := fold(t, theme.Dark,
		events.Started{Intent: "what is this project"},
		events.Text{Chunk: "partly"},
		events.Usage{InputTokens: events.Tokens(1200), OutputTokens: events.Tokens(340)},
		events.Degraded{Missing: []string{"the provider reported no cost"}},
		events.Finished{Claim: events.Claim{Result: events.ResultDone}},
	)

	said := plain(renderer.Cost())
	if !strings.Contains(said, "the provider reported no cost") {
		t.Errorf("the cost is answered with no sign that the turn was degraded:\n%s", said)
	}
	if !strings.Contains(said, "1.2k in") {
		t.Errorf("the cost does not report what the turn cost:\n%s", said)
	}
}

// Session is what the whole conversation has cost, for a frontend that shows it
// continuously rather than restating it under every answer.
func TestTheSessionSpendIsTheSumOfEveryTurn(t *testing.T) {
	var payloads []events.Payload
	payloads = append(payloads, answered("first", events.Usage{InputTokens: events.Tokens(1200), OutputTokens: events.Tokens(340), USD: usd(0.0030)})...)
	payloads = append(payloads, answered("second", events.Usage{InputTokens: events.Tokens(800), OutputTokens: events.Tokens(60), USD: usd(0.0062)})...)

	renderer, _ := fold(t, theme.Dark, payloads...)

	spent := plain(renderer.Session())
	for _, want := range []string{"2.0k in", "400 out", "$0.0092"} {
		if !strings.Contains(spent, want) {
			t.Errorf("the Session spend does not report %q: %s", want, spent)
		}
	}
	// It is the Session's, so it names no turn.
	if strings.Contains(spent, "turn ") {
		t.Errorf("the Session spend carries a per-turn figure: %s", spent)
	}
	// And it agrees with the line /cost answers with.
	if session := plain(renderer.Cost()); !strings.Contains(session, "$0.0092") {
		t.Errorf("the two ways of asking disagree:\n%s\n%s", spent, plain(renderer.Cost()))
	}
}

// A Session that has spent nothing says nothing. A footer opening with "no
// usage reported · cost unreported" tells a person about the absence of
// something they have not asked for yet.
func TestASessionThatHasSpentNothingReportsNothing(t *testing.T) {
	renderer, _ := fold(t, theme.Dark)

	if spent := renderer.Session(); spent != "" {
		t.Errorf("a Session with no turns reports %q, want nothing", spent)
	}
}

func TestADegradedSessionSaysSoInTheFooterFigures(t *testing.T) {
	renderer, _ := fold(t, theme.Dark,
		events.Started{Intent: "first"},
		events.Text{Chunk: "an answer"},
		events.Usage{InputTokens: events.Tokens(100)},
		events.Degraded{Missing: []string{"usage: output tokens"}},
		events.Finished{Claim: events.Claim{Result: events.ResultDone}},
	)

	if spent := plain(renderer.Session()); !strings.Contains(spent, "degraded") {
		t.Errorf("the Session spend does not say it is short by an unknown amount: %s", spent)
	}
}

// A Run that produced neither an answer nor a caveat shows nothing.
func TestATurnWithNothingToShowShowsNothing(t *testing.T) {
	got := show(t, theme.Dark,
		events.Started{Intent: "what is this project"},
		events.Finished{Claim: events.Claim{Result: events.ResultFailed, Summary: "the provider refused"}},
	)

	if got != "" {
		t.Errorf("a turn that produced nothing was drawn as %q", got)
	}
}

// A turn whose token counts the provider never reported has no figure to
// state. Naming one anyway would put a number a person budgets against beside
// a caveat they have to notice, and the number would win.
func TestASessionWhoseCountersWereNotReportedStatesNoFigure(t *testing.T) {
	session := costs(t, answered("unmeasured", events.Usage{USD: usd(0.0030)})...)[0]

	if strings.Contains(session, " in / ") {
		t.Errorf("the Session states token counts over a turn that reported none: %s", session)
	}
	if !strings.Contains(session, "no usage reported") {
		t.Errorf("the Session does not say the counts are missing: %s", session)
	}
}

// The same rule the dollar figure lives under, applied to the counters: a sum
// over a set one turn was silent about looks whole and is short by an unknown
// amount.
func TestASessionOnlyPartlyCountedStatesNoTokenFigure(t *testing.T) {
	var payloads []events.Payload
	payloads = append(payloads, answered("counted", events.Usage{InputTokens: events.Tokens(100), OutputTokens: events.Tokens(20)})...)
	payloads = append(payloads, answered("silent", events.Usage{})...)

	session := costs(t, payloads...)[1]
	if strings.Contains(session, "100 in") {
		t.Errorf("the Session sums counters over a turn that reported none: %s", session)
	}
	if !strings.Contains(session, "no usage reported") {
		t.Errorf("the Session does not say the counts are incomplete: %s", session)
	}
}

func TestEveryKindIsEitherShownOrDeliberatelySilent(t *testing.T) {
	shown := map[events.Kind]bool{}
	for _, kind := range render.Shown() {
		shown[kind] = true
	}
	silent := render.Silent()

	for _, kind := range events.Kinds() {
		_, isSilent := silent[kind]
		switch {
		case shown[kind] && isSilent:
			t.Errorf("%q is both shown and silent, so one of the two lists is wrong", kind)
		case !shown[kind] && !isSilent:
			t.Errorf("%q is in the schema and in neither list: say whether a person reads it, or why they do not", kind)
		}
	}

	// The lists describe the schema rather than outliving it. A kind removed
	// from events must not be left behind here claiming to be rendered.
	known := map[events.Kind]bool{}
	for _, kind := range events.Kinds() {
		known[kind] = true
	}
	for kind := range shown {
		if !known[kind] {
			t.Errorf("%q is listed as shown and is not a kind this schema has", kind)
		}
	}
	for kind := range silent {
		if !known[kind] {
			t.Errorf("%q is listed as silent and is not a kind this schema has", kind)
		}
	}
}

// A kind listed as silent shows nothing, which is the claim the list makes.
func TestASilentKindPutsNothingOnTheScreen(t *testing.T) {
	for kind := range render.Silent() {
		if kind == events.KindUnknown {
			// Unknown carries raw bytes rather than a payload a test can build
			// from its kind alone, and what it shows is covered where a Run is
			// degraded.
			continue
		}
		t.Run(string(kind), func(t *testing.T) {
			var out bytes.Buffer
			renderer, err := render.New(render.Stream(&out), theme.Default(theme.Dark))
			if err != nil {
				t.Fatalf("build a Renderer: %v", err)
			}
			if err := renderer.Committed(context.Background(), events.Event{
				Version: events.SchemaVersion, Run: "run_1", Session: "sess_1", Kind: kind,
				Payload: payloadFor(t, kind),
			}); err != nil {
				t.Fatalf("fold a %q: %v", kind, err)
			}
			if out.Len() != 0 {
				t.Errorf("%q wrote %q, and it is listed as showing nothing", kind, out.String())
			}
		})
	}
}

// payloadFor builds an empty payload of a kind, for a test that cares which
// kind it is and not what it holds.
func payloadFor(t *testing.T, kind events.Kind) events.Payload {
	t.Helper()

	switch kind {
	case events.KindToolCall:
		return events.ToolCall{}
	case events.KindToolResult:
		return events.ToolResult{}
	case events.KindEdit:
		return events.Edit{}
	case events.KindRetry:
		return events.Retry{}
	case events.KindNeedsHuman:
		return events.NeedsHuman{}
	default:
		t.Fatalf("no payload is built for %q: add one beside the kind", kind)
		return nil
	}
}

// A terminal answering late about its own colour must not discard what a person
// configured.
func TestABackgroundAnsweringLateKeepsTheConfiguredColour(t *testing.T) {
	t.Setenv("CLICOLOR_FORCE", "1")

	look, err := theme.Build(theme.Dark, theme.Settings{Subdued: "#FF00FF"})
	if err != nil {
		t.Fatalf("build the Theme: %v", err)
	}

	var out bytes.Buffer
	renderer, err := render.New(render.Stream(&out), look)
	if err != nil {
		t.Fatalf("build a Renderer: %v", err)
	}

	before := renderer.Cost()
	if err := renderer.Background(theme.Light); err != nil {
		t.Fatalf("the background answer: %v", err)
	}
	if after := renderer.Cost(); after != before {
		t.Errorf("the cost line changed when the terminal answered:\nbefore %q\nafter  %q", before, after)
	}
}

// The answer of one turn does not run into the next.
func TestAnAnswerDoesNotLeakIntoTheNextTurn(t *testing.T) {
	t.Setenv("CLICOLOR_FORCE", "1")

	var payloads []events.Payload
	payloads = append(payloads, answered("the first answer", events.Usage{})...)
	payloads = append(payloads, answered("the second answer", events.Usage{})...)

	renderer, _ := fold(t, theme.Dark, payloads...)
	kept, err := renderer.Kept()
	if err != nil {
		t.Fatalf("kept: %v", err)
	}
	if strings.Contains(plain(kept[1]), "the first answer") {
		t.Errorf("the second turn carries the first turn's answer:\n%s", plain(kept[1]))
	}
}
