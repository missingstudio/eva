package render_test

import (
	"bytes"
	"context"
	"regexp"
	"strings"
	"testing"

	"github.com/missingstudio/eva/internal/cli/render"
	"github.com/missingstudio/eva/internal/events"
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
func fold(t *testing.T, dark bool, payloads ...events.Payload) (*render.Renderer, *bytes.Buffer) {
	t.Helper()

	var out bytes.Buffer
	renderer, err := render.New(render.Stream(&out), dark)
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

// Both figures, on every turn. Per-turn spend is what a developer reacts to;
// cumulative spend is what tells them a conversation has become expensive
// before it ends.
func TestTheCostLineReportsThisTurnAndTheSessionSoFar(t *testing.T) {
	var payloads []events.Payload
	payloads = append(payloads, answered("first", events.Usage{InputTokens: 1200, OutputTokens: 340})...)
	payloads = append(payloads, answered("second", events.Usage{InputTokens: 800, OutputTokens: 60})...)

	lines := costLines(t, plain(show(t, true, payloads...)))
	if len(lines) != 2 {
		t.Fatalf("%d cost lines, want one per turn:\n%s", len(lines), strings.Join(lines, "\n"))
	}

	turn, session, _ := strings.Cut(lines[0], "session")
	for _, want := range []string{"1.2k in", "340 out"} {
		if !strings.Contains(turn, want) {
			t.Errorf("the first turn does not report %q: %s", want, turn)
		}
		if !strings.Contains(session, want) {
			t.Errorf("the Session after one turn does not report %q: %s", want, session)
		}
	}

	turn, session, _ = strings.Cut(lines[1], "session")
	for _, want := range []string{"800 in", "60 out"} {
		if !strings.Contains(turn, want) {
			t.Errorf("the second turn does not report %q: %s", want, turn)
		}
	}
	// 1200 + 800 and 340 + 60: the Session is the sum, not the last turn.
	for _, want := range []string{"2.0k in", "400 out"} {
		if !strings.Contains(session, want) {
			t.Errorf("the Session does not report %q — it is not summing the turns: %s", want, session)
		}
	}
}

// Cache writes and cache reads are priced differently, and their ratio is the
// largest single lever on what a turn costs. One number cannot carry them.
func TestTheCostLineSeparatesCacheWritesFromCacheReads(t *testing.T) {
	line := costLines(t, plain(show(t, true, answered("cached",
		events.Usage{InputTokens: 1200, OutputTokens: 340, CacheWriteTokens: 96, CacheReadTokens: 1024})...)))[0]

	for _, want := range []string{"96 write", "1.0k read"} {
		if !strings.Contains(line, want) {
			t.Errorf("the cost line does not report %q: %s", want, line)
		}
	}
}

// A dollar figure the provider did not report is named as absent. An estimate
// printed here would become the number a bill is argued from.
func TestAnUnreportedDollarFigureIsNamedRatherThanEstimated(t *testing.T) {
	line := costLines(t, plain(show(t, true, answered("free?",
		events.Usage{InputTokens: 1200, OutputTokens: 340})...)))[0]

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
	payloads = append(payloads, answered("first", events.Usage{InputTokens: 100, USD: usd(0.0030)})...)
	payloads = append(payloads, answered("second", events.Usage{InputTokens: 100, USD: usd(0.0062)})...)

	lines := costLines(t, plain(show(t, true, payloads...)))
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
	payloads = append(payloads, answered("priced", events.Usage{InputTokens: 100, USD: usd(0.0030)})...)
	payloads = append(payloads, answered("unpriced", events.Usage{InputTokens: 100})...)

	_, session, _ := strings.Cut(costLines(t, plain(show(t, true, payloads...)))[1], "session")
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
		events.Usage{InputTokens: 1200, OutputTokens: 340},
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
	// Before the cost line, so that the figures are read as qualified.
	if figures := strings.Index(got, "turn 1.2k"); figures < 0 || caveat > figures {
		t.Errorf("the caveat does not come before the figures it qualifies:\n%s", got)
	}
}

// A caveat belongs to the Run that carried it, so a later clean turn does not
// inherit it.
func TestACaveatDoesNotSurviveIntoTheNextTurn(t *testing.T) {
	var payloads []events.Payload
	payloads = append(payloads,
		events.Started{Intent: "first"},
		events.Text{Chunk: "an answer"},
		events.Usage{InputTokens: 100},
		events.Degraded{Missing: []string{"usage: output tokens"}},
		events.Finished{Claim: events.Claim{Result: events.ResultDone}},
	)
	payloads = append(payloads, answered("second", events.Usage{InputTokens: 100})...)

	got := plain(show(t, true, payloads...))
	if lines := costLines(t, got); len(lines) != 2 {
		t.Fatalf("%d cost lines, want one per turn:\n%s", len(lines), got)
	}
	if second := got[strings.LastIndex(got, "turn "):]; strings.Contains(second, "degraded") {
		t.Errorf("a clean turn inherited the caveat of the turn before it:\n%s", second)
	}
	if strings.Count(got, "degraded") != 1 {
		t.Errorf("the caveat is shown %d times, want once — on the Run that carried it:\n%s",
			strings.Count(got, "degraded"), got)
	}
}

// A terminal that says what colour it is after the Renderer was built — which
// is every terminal asked properly, because the answer comes back as a message
// — restyles what follows. What it must not do is reset what the Session has
// spent.
func TestALateAnswerAboutTheBackgroundKeepsTheSessionSpend(t *testing.T) {
	t.Setenv("CLICOLOR_FORCE", "1")

	var out bytes.Buffer
	renderer, err := render.New(render.Stream(&out), true)
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

	commit(answered("first", events.Usage{InputTokens: 1200, OutputTokens: 340})...)
	dark := out.String()

	if err := renderer.Background(false); err != nil {
		t.Fatalf("take the terminal's answer: %v", err)
	}
	out.Reset()
	commit(answered("second", events.Usage{InputTokens: 800, OutputTokens: 60})...)
	light := out.String()

	_, session, _ := strings.Cut(costLines(t, plain(light))[0], "session")
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

// costLines picks the cost lines out of rendered output.
func costLines(t *testing.T, out string) []string {
	t.Helper()

	var lines []string
	for _, line := range strings.Split(out, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "turn ") {
			lines = append(lines, strings.TrimSpace(line))
		}
	}
	if len(lines) == 0 {
		t.Fatalf("the output holds no cost line:\n%s", out)
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
			answered("first", events.Usage{InputTokens: 1200, OutputTokens: 340}),
			answered("second", events.Usage{InputTokens: 800, OutputTokens: 60})...,
		)...,
	)

	turn, session, split := strings.Cut(plain(renderer.Cost()), "session")
	if !split {
		t.Fatalf("the cost answers with one figure, want the turn and the Session: %s", turn)
	}
	for _, want := range []string{"800 in", "60 out"} {
		if !strings.Contains(turn, want) {
			t.Errorf("the turn does not report %q, and the last turn is what it is: %s", want, turn)
		}
	}
	for _, want := range []string{"2.0k in", "400 out"} {
		if !strings.Contains(session, want) {
			t.Errorf("the Session does not report %q, which is both turns: %s", want, session)
		}
	}
}

// A cleared transcript is a new Session, and its spend starts at nothing. A
// figure that outlived the Session it names would be two conversations summed
// and reported as one.
func TestClearingStartsTheAccountingOver(t *testing.T) {
	renderer, _ := fold(t, true, answered("first", events.Usage{InputTokens: 1200, OutputTokens: 340})...)

	renderer.Cleared()

	line := plain(renderer.Cost())
	if strings.Count(line, "no usage reported") != 2 {
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
		events.Usage{InputTokens: 1200, OutputTokens: 340},
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
