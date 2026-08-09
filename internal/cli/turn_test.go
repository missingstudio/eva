package cli

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/core/prompt"
	"github.com/missingstudio/eva/internal/events"
)

// These tests are about the two things a Turn decides that nothing downstream
// can decide for it: where a group ends, and what counts as the turn failing
// rather than the record failing.
//
// Both are invisible from outside the process. A group boundary leaves no mark
// on a Trace once the sink's fold has run — a chunk committed alone and a chunk
// committed with its neighbours produce the same records — and the difference
// between an Outcome and an error is a difference between two return values,
// not two files. So they are asserted here, at the interface, rather than
// through the binary.

// grouped is a TraceSink that keeps the groups it was appended rather than the
// records inside them.
type grouped struct {
	groups [][]events.Payload
	seq    uint64
}

var _ core.TraceSink = (*grouped)(nil)

func (g *grouped) Append(_ context.Context, group []events.Event) ([]events.Event, error) {
	payloads := make([]events.Payload, len(group))
	committed := make([]events.Event, len(group))
	for i, e := range group {
		g.seq++
		e.Seq = g.seq
		committed[i], payloads[i] = e, e.Payload
	}
	g.groups = append(g.groups, payloads)
	return committed, nil
}

func (g *grouped) Close() error { return nil }

// shape is one string per group: the chunks a group holds, or the kind of
// anything that is not a chunk, so that a failure reads as the boundaries it
// is about.
func (g *grouped) shape() []string {
	out := make([]string, 0, len(g.groups))
	for _, group := range g.groups {
		parts := make([]string, len(group))
		for i, payload := range group {
			if text, isText := payload.(events.Text); isText {
				parts[i] = text.Chunk
				continue
			}
			kind, _ := events.KindOf(payload)
			parts[i] = string(kind)
		}
		out = append(out, strings.Join(parts, "|"))
	}
	return out
}

// errFull is what a Trace with nowhere to write says.
var errFull = errors.New("no space left on device")

// refusing is a TraceSink that will not take one of the groups it is offered,
// so that a test can break the record at a chosen point in a turn.
type refusing struct {
	grouped

	// refuse is which group this sink turns away, counted from one. Zero
	// refuses every group, which is the whole Trace being unwritable.
	refuse int
	seen   int
}

var _ core.TraceSink = (*refusing)(nil)

func (r *refusing) Append(ctx context.Context, group []events.Event) ([]events.Event, error) {
	r.seen++
	if r.refuse == 0 || r.seen == r.refuse {
		return nil, errFull
	}
	return r.grouped.Append(ctx, group)
}

// newTestSession opens a Session for a turn under test, on a clock that does
// not move and identifiers that count.
//
// Both are the Session's rather than the process's, which is the point of
// handing them in: a timestamp nothing chose is a field a test can only check
// the shape of, and a Run named by eight random bytes is one no failure can
// name back.
func newTestSession() *core.Session {
	var runs, records uint64
	return core.NewSession("sess_test", "tenant_test",
		events.Identity{ID: "test", Kind: events.ActorAgent},
		core.Origin{
			Now: func() events.Timestamp { return events.Timestamp{} },
			RunID: func() events.RunID {
				runs++
				return events.RunID(fmt.Sprintf("run_%d", runs))
			},
			EventID: func() events.EventID {
				records++
				return events.EventID(fmt.Sprintf("evt_%d", records))
			},
		})
}

// opened is a Recorder for one Run of a Session, so that what the Run commits
// folds into the transcript the next Provider call is conditioned on. It is
// what the frontend does; recorder below is for the tests that need no fold.
func opened(t *testing.T, session *core.Session, sink core.TraceSink) *core.Recorder {
	t.Helper()

	rec, err := session.Open(sink)
	if err != nil {
		t.Fatalf("open a Run: %v", err)
	}
	return rec
}

// recorder builds a Recorder over a sink, with a fixed clock and identifiers a
// failure can name.
func recorder(t *testing.T, sink core.TraceSink) *core.Recorder {
	t.Helper()

	var minted uint64
	rec, err := core.NewRecorder(core.RecorderOptions{
		Sink:    sink,
		Run:     "run_test",
		Session: "sess_test",
		Now:     func() events.Timestamp { return events.Timestamp{} },
		NewID: func() events.EventID {
			minted++
			return events.EventID(fmt.Sprintf("evt_%d", minted))
		},
	})
	if err != nil {
		t.Fatalf("build a Recorder: %v", err)
	}
	return rec
}

// The chunks of one content block commit as one group, and anything that is
// not a chunk closes the block it interrupted.
//
// This is the half of the fold that lives in the frontend. The sink merges
// consecutive chunks of one block within a group; this is what puts them in
// one group. A version of this that committed a chunk at a time would leave
// every fold in trace correct and every one of them with nothing to do.
func TestAContentBlockCommitsAsOneGroup(t *testing.T) {
	for _, c := range []struct {
		name     string
		payloads []events.Payload
		want     []string
	}{
		{
			name: "the chunks of one block are one group",
			payloads: []events.Payload{
				events.Text{Block: 0, Chunk: "Eva is a "},
				events.Text{Block: 0, Chunk: "software "},
				events.Text{Block: 0, Chunk: "factory."},
			},
			want: []string{"Eva is a |software |factory."},
		},
		{
			name: "a second block is a second group",
			payloads: []events.Payload{
				events.Text{Block: 0, Chunk: "first"},
				events.Text{Block: 1, Chunk: "second"},
			},
			want: []string{"first", "second"},
		},
		{
			name: "what is not a chunk closes the block and commits on its own",
			payloads: []events.Payload{
				events.Text{Block: 0, Chunk: "answer"},
				events.Usage{InputTokens: events.Tokens(1)},
				events.Text{Block: 1, Chunk: "more"},
			},
			want: []string{"answer", string(events.KindUsage), "more"},
		},
		{
			name:     "a block that never opened commits nothing",
			payloads: nil,
			want:     []string{},
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			sink := &grouped{}
			block := newBlocks(recorder(t, sink))

			for i, payload := range c.payloads {
				if err := block.add(context.Background(), payload); err != nil {
					t.Fatalf("add payload %d: %v", i+1, err)
				}
			}
			if err := block.close(context.Background()); err != nil {
				t.Fatalf("close the open block: %v", err)
			}

			if got := sink.shape(); fmt.Sprint(got) != fmt.Sprint(c.want) {
				t.Errorf("the sink was appended %v, want %v", got, c.want)
			}
		})
	}
}

// The base system prompt is what a turn is conditioned on before it is
// conditioned on anything anybody said, and it is not part of the transcript.
// Turn.conditioning has why the two are separate.
func TestTheBaseSystemPromptHeadsTheTurnAndIsNotInTheTranscript(t *testing.T) {
	provider := &driven{script: []recording{{chunks: []string{"answered."}}}}
	session := newTestSession()
	turn := &Turn{
		Provider: provider,
		// The Session opens its own Run, so the prompt folds into the
		// transcript as it is committed — which is what the Provider is then
		// conditioned on.
		Recorder:     opened(t, session, &grouped{}),
		Session:      session,
		Model:        "test-model",
		SystemPrompt: prompt.Base(),
	}

	if _, err := turn.Execute(context.Background(), core.Spec{Intent: "what is this project"}); err != nil {
		t.Fatalf("answer a turn: %v", err)
	}

	sent := provider.transcripts()[0]
	if len(sent) != 2 {
		t.Fatalf("the Provider was sent %+v, want the base system prompt and the prompt", sent)
	}
	if sent[0].Author != core.AuthorSystem || sent[0].Text != prompt.Base() {
		t.Errorf("the turn opened on %+v, want the base system prompt as a system Message", sent[0])
	}
	if sent[1] != (core.Message{Author: core.AuthorUser, Text: "what is this project"}) {
		t.Errorf("the prompt reached the Provider as %+v", sent[1])
	}

	for _, m := range session.Messages() {
		if m.Author == core.AuthorSystem {
			t.Errorf("the transcript holds %+v, and a fold over the Trace would not give it back", m)
		}
	}
}

// A Turn told no system prompt sends none, rather than sending an empty one.
// An empty Message says nothing an answer can be conditioned on, and the API
// rejects an empty content block.
func TestATurnWithNoSystemPromptSendsNoSystemMessage(t *testing.T) {
	provider := &driven{script: []recording{{chunks: []string{"answered."}}}}
	session := newTestSession()
	turn := &Turn{
		Provider: provider,
		Recorder: opened(t, session, &grouped{}),
		Session:  session,
		Model:    "test-model",
	}

	if _, err := turn.Execute(context.Background(), core.Spec{Intent: "what is this project"}); err != nil {
		t.Fatalf("answer a turn: %v", err)
	}

	sent := provider.transcripts()[0]
	if len(sent) != 1 || sent[0].Author != core.AuthorUser {
		t.Errorf("the Provider was sent %+v, want the prompt alone", sent)
	}
}

// A Trace that will not take a group is the instrument failing, and it is
// marked as that where the refusal happens — because by the time it reaches
// the caller it is indistinguishable from a provider that broke, and the two
// are answered differently.
func TestAGroupTheTraceRefusesIsMarkedAsTheRecordFailing(t *testing.T) {
	block := newBlocks(recorder(t, &refusing{}))

	err := block.add(context.Background(), events.Usage{InputTokens: events.Tokens(1)})

	var notWritten unrecorded
	if !errors.As(err, &notWritten) {
		t.Fatalf("err = %v, want it marked as the record failing", err)
	}
	if !errors.Is(err, errFull) {
		t.Errorf("err = %v, want it to still carry what the sink said", err)
	}
}

// A provider that broke is a turn that failed, and a turn that failed is an
// Outcome. It reaches the caller as an Outcome alone: a second account of one
// turn, in a second shape, is what lets an interface show something the record
// does not hold.
func TestAProviderFailureIsAnOutcomeRatherThanAnError(t *testing.T) {
	sink := &grouped{}
	// An empty script, so the first call is refused. What broke does not
	// matter here; that it broke before the Trace did is the whole of it.
	turn := &Turn{
		Provider: &driven{},
		Recorder: recorder(t, sink),
		Session:  newTestSession(),
		Model:    "test-model",
	}

	outcome, err := turn.Execute(context.Background(), core.Spec{Intent: "what is this project"})
	if err != nil {
		t.Fatalf("err = %v, want a turn that failed to be answered with an Outcome", err)
	}
	if outcome.Result != events.ResultFailed {
		t.Errorf("result = %q, want %q", outcome.Result, events.ResultFailed)
	}
	if !strings.Contains(outcome.Summary, "driven") {
		t.Errorf("summary = %q, want it to name what broke", outcome.Summary)
	}

	// And the claim the Trace holds says the same thing, which is the reason
	// the caller does not need a second account of it.
	closing := sink.groups[len(sink.groups)-1]
	finished, isFinished := closing[len(closing)-1].(events.Finished)
	if !isFinished {
		t.Fatalf("the Run closed on %#v, want Finished", closing[len(closing)-1])
	}
	if finished.Claim.Summary != outcome.Summary {
		t.Errorf("the Trace claims %q and the caller was told %q", finished.Claim.Summary, outcome.Summary)
	}
}

// A Trace that will not take the record does reach the caller as an error. The
// Outcome still says what happened to the turn, because it did happen — but
// there is no record of it to read instead, which is the whole reason this one
// is not silent.
//
// The Run is opened and closed here and only the answer is refused, so the
// error the caller gets is the one the stream carried out rather than one the
// close produced.
func TestARecordThatCannotBeWrittenReachesTheCallerAsAnError(t *testing.T) {
	sink := &refusing{refuse: 2}
	turn := &Turn{
		Provider: &driven{script: []recording{{chunks: []string{"answered."}}}},
		Recorder: recorder(t, sink),
		Session:  newTestSession(),
		Model:    "test-model",
	}

	outcome, err := turn.Execute(context.Background(), core.Spec{Intent: "what is this project"})
	if !errors.Is(err, errFull) {
		t.Fatalf("err = %v, want the sink's own failure", err)
	}
	if outcome.Result != events.ResultFailed {
		t.Errorf("result = %q, want %q — the turn is still reported on", outcome.Result, events.ResultFailed)
	}
	// The close was not refused, so the Run is closed in the Trace even though
	// the answer never reached it.
	if len(sink.groups) != 2 {
		t.Errorf("the Trace holds %d groups, want the opening and the close", len(sink.groups))
	}
}

// A Run that opened is a Run that closes, even when opening it reported a
// failure.
//
// A group is committed before it is published, so a projection that breaks on
// the way out leaves the Started record in the Trace and returns an error
// anyway. Returning there left a Run open forever — and a Run with no Finished
// record is one a reader cannot tell from a Run still going, which is the
// distinction the whole Trace rests on.
func TestARunThatOpenedClosesEvenWhenOpeningItFailed(t *testing.T) {
	sink := &grouped{}
	broken := core.SubscriberFunc(func(context.Context, events.Event) error {
		return errors.New("the projection is gone")
	})

	var minted uint64
	rec, err := core.NewRecorder(core.RecorderOptions{
		Sink:        sink,
		Run:         "run_test",
		Session:     "sess_test",
		Now:         func() events.Timestamp { return events.Timestamp{} },
		NewID:       func() events.EventID { minted++; return events.EventID(fmt.Sprintf("evt_%d", minted)) },
		Subscribers: []core.Subscriber{broken},
	})
	if err != nil {
		t.Fatalf("build a Recorder: %v", err)
	}

	turn := &Turn{
		Recorder: rec,
		Session:  newTestSession(),
		Provider: &driven{script: []recording{{chunks: []string{"answered."}}}},
		Model:    "test-model",
	}

	if _, err := turn.Execute(context.Background(), core.Spec{Intent: "hello"}); err == nil {
		t.Fatal("a publish failure while opening the Run was not reported")
	}

	// The Trace holds the Run's open and its close, so a reader can tell it
	// ended.
	var opened, closed bool
	for _, group := range sink.groups {
		for _, payload := range group {
			switch payload.(type) {
			case events.Started:
				opened = true
			case events.Finished:
				closed = true
			}
		}
	}
	if !opened {
		t.Fatal("the Started record never reached the Trace, so there is nothing this test is about")
	}
	if !closed {
		t.Error("the Run opened and never closed: a reader cannot tell it from a Run still going")
	}
}
