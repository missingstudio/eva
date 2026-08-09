package ui_test

import (
	"bytes"
	"context"
	"regexp"
	"strings"
	"testing"

	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/theme"
	"github.com/missingstudio/eva/internal/ui"
)

// These tests feed committed Events to a Renderer and read what it wrote.
// That is the whole of its interface: a Renderer takes Events and produces
// bytes, and there is nothing else to reach for.
//
// The colour is forced on, because a Renderer writing to a buffer is writing
// to something that is not a terminal, and the terminal-capability adaptation
// this stage builds would then correctly strip every escape — leaving the two
// styles indistinguishable. What the adaptation does with a real capability is
// asserted against the process, in cli/eva_test.go.

// answered is one whole turn: the prompt, the answer, what it cost, and the
// claim that closes it.
func answered(answer string, usage events.Usage) []events.Payload {
	return []events.Payload{
		events.Started{Intent: "what is this project"},
		events.Text{Chunk: answer},
		usage,
		events.Finished{Claim: events.Claim{Result: events.ResultDone}},
	}
}

// show folds the payloads into a Renderer and returns what it wrote.
func show(t *testing.T, dark bool, payloads ...events.Payload) string {
	t.Helper()

	_, out := fold(t, dark, payloads...)
	return out.String()
}

// fold folds the payloads into a Renderer and returns it, along with what it
// wrote. It is what a test that asks a Renderer something uses, rather than one
// that only reads the bytes.
func fold(t *testing.T, dark bool, payloads ...events.Payload) (*ui.Renderer, *bytes.Buffer) {
	t.Helper()

	var out bytes.Buffer
	renderer, err := ui.New(ui.Stream(&out), theme.Default(dark))
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

	got := show(t, true, answered("Eva is a `factory`, and it is **autonomous**.", events.Usage{})...)
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
	dark := show(t, true, answered(answer, events.Usage{})...)
	light := show(t, false, answered(answer, events.Usage{})...)

	if dark == light {
		t.Error("a light terminal and a dark one are shown the same bytes")
	}
	if plain(dark) != plain(light) {
		t.Errorf("the two backgrounds are shown different words, and only the style should differ:\n%q\n%q",
			plain(dark), plain(light))
	}
}

// The figure reported is the Session's, and it is the sum of every turn.
//
// A per-turn figure was reported beside it and is gone: it was the figure that
// aged fastest — true for one turn, restated on the next, and never the number a
// person is deciding on. What a conversation has cost is one number that keeps
// changing, and it is the one worth asking for.
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

// And when the provider does report one, it is shown and it is summed.
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
//
// The caveat is committed in the group Finished closes on, and before it,
// which is the order folded here.
func TestACaveatIsShownAndNotOnlyRecorded(t *testing.T) {
	got := plain(show(t, true,
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

	got := plain(show(t, true, payloads...))
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
	renderer, err := ui.New(ui.Stream(&out), theme.Default(true))
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

	if err := renderer.Background(false); err != nil {
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

// costs folds the payloads and returns what Cost reported after each turn.
//
// The figures used to be scraped out of the rendered turns, which is where a
// Renderer wrote them. They are not written there any more — a turn is an
// answer, and what a Session has spent belongs to a frontend that can show it
// continuously — so the same fold is asked for them directly. What is being
// tested is unchanged: these are the same records added the same way.
func costs(t *testing.T, payloads ...events.Payload) []string {
	t.Helper()

	var out bytes.Buffer
	renderer, err := ui.New(ui.Stream(&out), theme.Default(true))
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
//
// Two turns, so the two figures cannot be confused: the turn is the second
// alone and the Session is both.
func TestTheCostIsAnsweredOnDemandAfterTheTurnIsOver(t *testing.T) {
	renderer, _ := fold(t, true,
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
	renderer, _ := fold(t, true, answered("first", events.Usage{InputTokens: events.Tokens(1200), OutputTokens: events.Tokens(340)})...)

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
	renderer, _ := fold(t, true,
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
//
// It is the same fold as the cost line, so the two cannot disagree about one
// Session — which is the only reason it is worth having a second way to ask.
func TestTheSessionSpendIsTheSumOfEveryTurn(t *testing.T) {
	var payloads []events.Payload
	payloads = append(payloads, answered("first", events.Usage{InputTokens: events.Tokens(1200), OutputTokens: events.Tokens(340), USD: usd(0.0030)})...)
	payloads = append(payloads, answered("second", events.Usage{InputTokens: events.Tokens(800), OutputTokens: events.Tokens(60), USD: usd(0.0062)})...)

	renderer, _ := fold(t, true, payloads...)

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
	renderer, _ := fold(t, true)

	if spent := renderer.Session(); spent != "" {
		t.Errorf("a Session with no turns reports %q, want nothing", spent)
	}
}

// A degraded Session says so beside its figures, in the one word a footer has
// room for. The full caveat names what was missed and goes under the turn.
func TestADegradedSessionSaysSoInTheFooterFigures(t *testing.T) {
	renderer, _ := fold(t, true,
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
//
// Showing nothing is not the same as showing an empty thing. A frontend that
// marks each turn down its left-hand side would otherwise draw a mark against no
// text — a band on the screen standing for a turn that said nothing. What
// happened to that turn is the frontend's to report, and the record of why is
// committed either way.
func TestATurnWithNothingToShowShowsNothing(t *testing.T) {
	got := show(t, true,
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

// Every kind the schema knows is either shown or deliberately silent.
//
// The schema is open: a kind can be added to events, and a fold that met a new
// one by falling off the end of a type switch would show a person nothing and
// tell nobody it had decided to. This is what makes that decision explicit —
// adding a kind fails here until someone says which of the two it is.
func TestEveryKindIsEitherShownOrDeliberatelySilent(t *testing.T) {
	shown := map[events.Kind]bool{}
	for _, kind := range ui.Shown() {
		shown[kind] = true
	}
	silent := ui.Silent()

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
	for kind := range ui.Silent() {
		if kind == events.KindUnknown {
			// Unknown carries raw bytes rather than a payload a test can build
			// from its kind alone, and what it shows is covered where a Run is
			// degraded.
			continue
		}
		t.Run(string(kind), func(t *testing.T) {
			var out bytes.Buffer
			renderer, err := ui.New(ui.Stream(&out), theme.Default(true))
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
//
// The Renderer rebuilt from the compiled default here, so a configured grey
// survived on the console's status line and vanished from the cost line the
// moment the terminal answered — one colour named in two places, disagreeing,
// which is the split ui.Subdued exists to prevent.
func TestABackgroundAnsweringLateKeepsTheConfiguredColour(t *testing.T) {
	t.Setenv("CLICOLOR_FORCE", "1")

	look, err := theme.Build(true, theme.Settings{Subdued: "#FF00FF"})
	if err != nil {
		t.Fatalf("build the Theme: %v", err)
	}

	var out bytes.Buffer
	renderer, err := ui.New(ui.Stream(&out), look)
	if err != nil {
		t.Fatalf("build a Renderer: %v", err)
	}

	before := renderer.Cost()
	if err := renderer.Background(false); err != nil {
		t.Fatalf("the background answer: %v", err)
	}
	if after := renderer.Cost(); after != before {
		t.Errorf("the cost line changed when the terminal answered:\nbefore %q\nafter  %q", before, after)
	}
}
