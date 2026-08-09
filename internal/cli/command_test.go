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
//
// A command that reached the model by mistake would open a Run, so most of
// these begin with a Provider that has no recording: the mistake would fail the
// turn loudly rather than pass quietly.

// answers types a command and returns what appeared because of it.
//
// What went before is cut off, because a cost line is on screen after every
// turn and the whole buffer could not say which of them the command wrote.
func (d *dialogue) answers(t *testing.T, typed string) string {
	t.Helper()

	before := d.read()
	d.say(typed)

	var said string
	d.settle(t, func() bool {
		said = strings.TrimPrefix(d.read(), before)
		return strings.Contains(said, typed) && strings.Count(said, "\n") > 2
	})
	return said
}

// /help answers, and answering is not a turn.
//
// That /help lists every command is tui's to assert, because the command table
// is tui's — see TestHelpListsEveryCommand there. What is asserted here is the
// part that needs the whole assembly: a command is answered by the console, so
// no Run opens and the Trace holds no record of a turn that never ran.
func TestHelpAnswersWithoutOpeningARun(t *testing.T) {
	d := begin(t)

	if said := d.answers(t, "/help"); !strings.Contains(said, "/help") {
		t.Errorf("/help said nothing that lists a command:\n%s", said)
	}
	if opened := d.of(t, events.KindStarted); len(opened) != 0 {
		t.Errorf("/help opened %d Run(s) — a command is not a turn", len(opened))
	}
}

// A command nobody has says so, and the Session goes on.
func TestAnUnknownCommandNamesItselfAndDoesNotEndTheSession(t *testing.T) {
	d := begin(t, recording{chunks: []string{"still here."}})

	d.say("/nope")
	d.settle(t, func() bool { return strings.Contains(d.read(), "/nope") })

	read := d.read()
	if !strings.Contains(read, "/help") {
		t.Errorf("the refusal does not say where the commands are listed:\n%s", read)
	}
	if opened := d.of(t, events.KindStarted); len(opened) != 0 {
		t.Errorf("/nope opened %d Run(s) — an unknown command is not a prompt", len(opened))
	}

	// And the Session is one the next prompt can still use.
	d.say("are you there")
	d.closed(t, 1)
	d.settle(t, func() bool { return strings.Contains(d.read(), "still here.") })
}

// /cost reports what the last turn cost and what the Session has cost, on
// demand rather than at the end of a turn.
//
// Each turn of the script reports 10 in and 20 out, so after two of them the
// figures are known without computing them the way the code does.
func TestCostReportsThePerTurnAndCumulativeSpendOnDemand(t *testing.T) {
	d := begin(t,
		recording{chunks: []string{"Eva is a software factory."}},
		recording{chunks: []string{"It is autonomous."}},
	)

	d.say("what is this project")
	d.closed(t, 1)
	d.say("and what else")
	d.closed(t, 2)
	d.settle(t, func() bool { return strings.Contains(d.read(), "It is autonomous.") })

	said := d.answers(t, "/cost")
	if !strings.Contains(said, "turn 10 in / 20 out") {
		t.Errorf("/cost does not report what the last turn cost:\n%s", said)
	}
	if !strings.Contains(said, "session 20 in / 40 out") {
		t.Errorf("/cost does not report what the Session has cost:\n%s", said)
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

	d.say("what is this project")
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

	d.say("what is this project")
	d.closed(t, 1)
	d.settle(t, func() bool { return strings.Contains(d.read(), "session 10 in / 20 out") })

	d.say("/clear")
	d.settle(t, func() bool { return strings.Contains(d.read(), "cleared") })

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

	d.say("what is this project")
	d.closed(t, 1)

	d.say("/model another-model")
	d.settle(t, func() bool { return strings.Contains(d.read(), "another-model") })

	d.say("and what else")
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
		{Author: core.AuthorUser, Text: "what is this project"},
		{Author: core.AuthorAssistant, Text: "Eva is a software factory."},
		{Author: core.AuthorUser, Text: "and what else"},
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

	d.say("/model")
	d.settle(t, func() bool { return strings.Contains(d.read(), "test-model") })

	// And it switched to nothing: the next turn runs on the same model.
	d.say("are you there")
	d.closed(t, 1)

	if used := d.provider.models(); used[0] != "test-model" {
		t.Errorf("the turn after a bare /model ran on %q, want the configured model", used[0])
	}
}

// /clear empties the transcript, and the process goes on.
//
// The turn after it is conditioned on itself alone: what a cleared transcript
// is for is a next prompt the earlier ones no longer cost anything to answer.
func TestClearEmptiesTheTranscriptWithoutEndingTheProcess(t *testing.T) {
	d := begin(t,
		recording{chunks: []string{"Eva is a software factory."}},
		recording{chunks: []string{"I have nothing to go on."}},
	)

	d.say("what is this project")
	d.closed(t, 1)

	d.say("/clear")
	d.settle(t, func() bool { return strings.Contains(d.read(), "cleared") })

	d.say("what did I just ask")
	d.closed(t, 2)

	calls := d.provider.transcripts()
	if len(calls) != 2 {
		t.Fatalf("the Provider was called %d time(s), want 2 — the process did not survive /clear", len(calls))
	}
	if after := conversation(t, calls[1]); len(after) != 1 || after[0].Text != "what did I just ask" {
		t.Errorf("the turn after /clear was conditioned on\n%+v\nwant the new prompt alone", after)
	}
}

// A cleared transcript is a new Session rather than a Session with its messages
// deleted, and the Trace keeps what was said before it. Session.Fresh has why.
func TestAClearedTranscriptIsANewSession(t *testing.T) {
	d := begin(t,
		recording{chunks: []string{"Eva is a software factory."}},
		recording{chunks: []string{"I have nothing to go on."}},
	)

	d.say("what is this project")
	d.closed(t, 1)
	d.say("/clear")
	d.settle(t, func() bool { return strings.Contains(d.read(), "cleared") })
	d.say("what did I just ask")
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
