package cli

import (
	"fmt"
	"strings"
	"testing"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
)

// These tests drive the commands the way a person does: through the console,
// with input disabled and output redirected. What they assert on is what an
// outside reader could — the bytes a person would have read, the transcript the
// Provider was called with, and the records in the Trace.

// answers types a command and returns what appeared because of it.
func (d *dialogue) answers(t *testing.T, typed string) string {
	t.Helper()

	before := d.read()
	d.say(t, typed)

	// Two blocks: the prompt echoed back, and what the command answered. They
	// are separated by a blank line and the echo lands first, so waiting for the
	// second separator is waiting for the answer.
	var said string
	d.settle(t, func() bool {
		said = strings.TrimPrefix(d.read(), before)
		echo := strings.Index(said, typed)
		return echo >= 0 && strings.Contains(said[echo:], "\n\n")
	})
	return said
}

// /help answers, and answering is not a turn.
func TestHelpAnswersWithoutOpeningARun(t *testing.T) {
	d := begin(t)

	if said := d.answers(t, "/help"); !strings.Contains(said, "/help") {
		t.Errorf("/help said nothing that lists a command:\n%s", said)
	}
	if opened := d.of(t, events.KindStarted); len(opened) != 0 {
		t.Errorf("/help opened %d Run(s) — a command is not a turn", len(opened))
	}
}

func TestAnUnknownCommandNamesItselfAndDoesNotEndTheSession(t *testing.T) {
	d := begin(t, recording{chunks: []string{"still here."}})

	d.say(t, "/nope")
	// Settled on the refusal rather than on the command, which the prompt
	// echoed back already satisfies — the two are put on screen one after the
	// other, so a wait that ends on the first can read before the second.
	d.settle(t, func() bool { return strings.Contains(d.read(), "not a command") })

	read := d.read()
	if !strings.Contains(read, "/help") {
		t.Errorf("the refusal does not say where the commands are listed:\n%s", read)
	}
	if opened := d.of(t, events.KindStarted); len(opened) != 0 {
		t.Errorf("/nope opened %d Run(s) — an unknown command is not a prompt", len(opened))
	}

	// And the Session is one the next prompt can still use.
	d.say(t, "are you there")
	d.closed(t, 1)
	d.settle(t, func() bool { return strings.Contains(d.read(), "still here.") })
}

func TestCostReportsTheWholeSessionOnDemand(t *testing.T) {
	d := begin(t,
		recording{chunks: []string{"Eva is a software factory."}},
		recording{chunks: []string{"It is autonomous."}},
	)

	d.say(t, "what is this project")
	d.closed(t, 1)
	d.say(t, "and what else")
	d.closed(t, 2)
	d.settle(t, func() bool { return strings.Contains(d.read(), "It is autonomous.") })

	said := d.answers(t, "/cost")
	if !strings.Contains(said, "session 20 in / 40 out") {
		t.Errorf("/cost does not report what the Session has cost:\n%s", said)
	}
	if strings.Contains(said, "turn ") {
		t.Errorf("/cost still reports a per-turn figure:\n%s", said)
	}
	if opened := d.of(t, events.KindStarted); len(opened) != 2 {
		t.Errorf("the Trace holds %d opened Runs, want 2 — /cost is not a turn", len(opened))
	}
}

// /cost carries the caveat the turn closed with, for the reason the end of a
// turn prints one: figures over data known to be incomplete, with nothing
// beside them to say so, are figures that read as a measurement.
func TestCostCarriesTheCaveatOfADegradedTurn(t *testing.T) {
	const missing = "what this turn cost: the provider reported no usage"
	d := begin(t, recording{chunks: []string{"partly."}, degraded: []string{missing}})

	d.say(t, "what is this project")
	d.closed(t, 1)
	d.settle(t, func() bool { return strings.Contains(d.read(), missing) })

	said := d.answers(t, "/cost")
	if !strings.Contains(said, missing) {
		t.Errorf("/cost reports the figures of a degraded turn with nothing to qualify them:\n%s", said)
	}
}

// /clear empties the transcript and the spend with it. The cost line says what
// a Session has cost, and after /clear it is a different Session — a figure
// that carried over would be two conversations summed and reported as one.
func TestClearEmptiesTheSpendWithTheTranscript(t *testing.T) {
	d := begin(t, recording{chunks: []string{"Eva is a software factory."}})

	d.say(t, "what is this project")
	d.closed(t, 1)
	d.settle(t, func() bool { return strings.Contains(d.read(), "Eva is a software factory.") })

	d.say(t, "/clear")
	// The turn goes; the masthead does not. /clear opens a new Session, and a
	// new Session opens the way the process did — what it clears is the
	// transcript, not what the console says about itself.
	d.settle(t, func() bool { return !strings.Contains(d.read(), "Eva is a software factory.") })

	said := d.answers(t, "/cost")
	if !strings.Contains(said, "session no usage reported") {
		t.Errorf("/cost after /clear reports a Session that has spent something:\n%s", said)
	}
}

// /model switches the model in the middle of a Session, and the Session is not
// disturbed: the turn that follows runs on the new model and is still answered
// in the light of the earlier ones.
func TestModelSwitchesInTheMiddleOfASessionAndKeepsTheContext(t *testing.T) {
	d := begin(t,
		recording{chunks: []string{"Eva is a software factory."}},
		recording{chunks: []string{"It is autonomous."}},
	)

	d.say(t, "what is this project")
	d.closed(t, 1)

	d.say(t, "/model another-model")
	d.settle(t, func() bool { return strings.Contains(d.read(), "another-model") })

	d.say(t, "and what else")
	d.closed(t, 2)

	used := d.provider.models()
	if len(used) != 2 {
		t.Fatalf("the Provider was called %d time(s), want 2", len(used))
	}
	if used[0] != "test-model" {
		t.Errorf("the first turn ran on %q, want the configured model", used[0])
	}
	if used[1] != "another-model" {
		t.Errorf("the turn after /model ran on %q, want the model it switched to", used[1])
	}

	want := []core.Message{
		core.Say(core.AuthorUser, "what is this project"),
		core.Say(core.AuthorAssistant, "Eva is a software factory."),
		core.Say(core.AuthorUser, "and what else"),
	}
	calls := d.provider.transcripts()
	if after := conversation(t, calls[1]); fmt.Sprint(after) != fmt.Sprint(want) {
		t.Errorf("the turn after /model was conditioned on\n%+v\nwant\n%+v", after, want)
	}
}

// /model with nothing after it reports what is answering rather than switching
// to a model with no name.
func TestModelWithNoNameReportsTheModelInUse(t *testing.T) {
	d := begin(t, recording{chunks: []string{"still on it."}})

	d.say(t, "/model")
	d.settle(t, func() bool { return strings.Contains(d.read(), "test-model") })

	// And it switched to nothing: the next turn runs on the same model.
	d.say(t, "are you there")
	d.closed(t, 1)

	if used := d.provider.models(); used[0] != "test-model" {
		t.Errorf("the turn after a bare /model ran on %q, want the configured model", used[0])
	}
}

func TestClearEmptiesTheTranscriptWithoutEndingTheProcess(t *testing.T) {
	d := begin(t,
		recording{chunks: []string{"Eva is a software factory."}},
		recording{chunks: []string{"I have nothing to go on."}},
	)

	d.say(t, "what is this project")
	d.closed(t, 1)

	d.say(t, "/clear")
	d.settle(t, func() bool { return !strings.Contains(d.read(), "Eva is a software factory.") })

	d.say(t, "what did I just ask")
	d.closed(t, 2)

	calls := d.provider.transcripts()
	if len(calls) != 2 {
		t.Fatalf("the Provider was called %d time(s), want 2 — the process did not survive /clear", len(calls))
	}
	if after := conversation(t, calls[1]); len(after) != 1 || after[0].Said() != "what did I just ask" {
		t.Errorf("the turn after /clear was conditioned on\n%+v\nwant the new prompt alone", after)
	}
}

func TestClearEmptiesThePane(t *testing.T) {
	d := begin(t, recording{chunks: []string{"Eva is a software factory."}})

	d.say(t, "what is this project")
	d.closed(t, 1)
	d.settle(t, func() bool { return strings.Contains(d.read(), "software factory") })

	d.say(t, "/clear")

	// The transcript goes, and nothing is said about its going. An emptied
	// transcript is its own evidence; a line reporting it would be the loudest
	// thing left on screen, which is to say the command would not have done
	// what it says.
	d.settle(t, func() bool { return !strings.Contains(d.read(), "software factory") })

	shown := d.read()
	for _, gone := range []string{"software factory", "what is this project", "/clear"} {
		if strings.Contains(shown, gone) {
			t.Errorf("%q is still on screen after /clear:\n%s", gone, shown)
		}
	}

	// Nothing was destroyed to make the screen empty.
	if text := d.of(t, events.KindText); len(text) != 1 {
		t.Errorf("the Trace holds %d Text records, want the 1 that /clear took off the screen", len(text))
	}
}

// A cleared transcript is a new Session rather than a Session with its messages
// deleted, and the Trace keeps what was said before it. Session.Fresh has why.
func TestAClearedTranscriptIsANewSession(t *testing.T) {
	d := begin(t,
		recording{chunks: []string{"Eva is a software factory."}},
		recording{chunks: []string{"I have nothing to go on."}},
	)

	d.say(t, "what is this project")
	d.closed(t, 1)
	d.say(t, "/clear")
	d.settle(t, func() bool { return !strings.Contains(d.read(), "software factory") })
	d.say(t, "what did I just ask")
	d.closed(t, 2)

	opened := d.of(t, events.KindStarted)
	if len(opened) != 2 {
		t.Fatalf("the Trace holds %d opened Runs, want 2", len(opened))
	}
	if opened[0].Session == opened[1].Session {
		t.Errorf("both Runs are against Session %q — /clear emptied a transcript in place", opened[0].Session)
	}

	// The Trace keeps what was said before the clear. Emptying a transcript is
	// not deleting a record.
	var held bool
	for _, e := range d.of(t, events.KindStarted) {
		if started, ok := e.Payload.(events.Started); ok && started.Intent == "what is this project" {
			held = true
		}
	}
	if !held {
		t.Errorf("the Trace no longer holds what was said before /clear:\n%s", d.stored(t))
	}
}

// /clear leaves the console saying what it is. What it empties is the
// transcript, and the masthead was never part of one: a person who cleared a
// conversation has not stopped needing to know which model is answering.
func TestClearLeavesTheMastheadStanding(t *testing.T) {
	d := begin(t, recording{chunks: []string{"Eva is a software factory."}})

	d.say(t, "what is this project")
	d.closed(t, 1)
	d.settle(t, func() bool { return strings.Contains(d.read(), "Eva is a software factory.") })

	d.say(t, "/clear")
	d.settle(t, func() bool { return !strings.Contains(d.read(), "Eva is a software factory.") })

	if got := d.read(); !strings.Contains(got, "EVA") {
		t.Errorf("the console stopped saying what it is after /clear:\n%s", got)
	}
}

// A Login opens a browser and waits on a person, which is the one thing a
// Command may not do. So /login answers by naming the shell word that does the
// work — and, like every other command, opens no Run.
func TestLoginPointsAtTheShellWithoutOpeningARun(t *testing.T) {
	d := begin(t)

	said := d.answers(t, "/login")
	if !strings.Contains(said, "eva login") {
		t.Errorf("/login did not name the command that logs in:\n%s", said)
	}
	if opened := d.of(t, events.KindStarted); len(opened) != 0 {
		t.Errorf("/login opened %d Run(s) — a command reaches no Provider", len(opened))
	}
}
