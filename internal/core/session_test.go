package core_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
)

// A Session is a fold over committed Events, so these tests feed it Events and
// read the transcript back. That is the whole interface, and it is the same
// path a live turn and a resumed one both take.

func event(run events.RunID, payload events.Payload) events.Event {
	kind, _ := events.KindOf(payload)
	return events.Event{
		Version: events.SchemaVersion,
		Kind:    kind,
		Tenant:  "tenant_1",
		Actor:   events.Identity{ID: "agent", Kind: events.ActorAgent},
		Run:     run,
		Session: "sess_1",
		Payload: payload,
	}
}

func fold(t *testing.T, s *core.Session, es ...events.Event) {
	t.Helper()
	for i, e := range es {
		if err := s.Committed(context.Background(), e); err != nil {
			t.Fatalf("fold event %d: %v", i, err)
		}
	}
}

func transcript(s *core.Session) string {
	var out string
	for _, m := range s.Messages() {
		out += fmt.Sprintf("%s:%s|", m.Author, m.Said())
	}
	return out
}

// session is a Session for the fold tests, which drive Committed directly and
// open no Run. Its Origin is empty because these tests are about what a
// transcript is folded from, and a Session with no way to open a Run can still
// fold every Event a Trace holds — including one another process recorded.
func session() *core.Session {
	return core.NewSession("sess_1", "tenant_1",
		events.Identity{ID: "agent", Kind: events.ActorAgent}, core.Origin{})
}

// opened is a Session that can open a Run, on a clock that does not move.
func opened(t *testing.T) *core.Session {
	t.Helper()

	var runs, records uint64
	return core.NewSession("sess_1", "tenant_1",
		events.Identity{ID: "agent", Kind: events.ActorAgent},
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

// A Session opens its own Runs, and stamps them with what it already holds. A
// caller that restated the tenant, the actor, or the Session would be a caller
// free to restate one of them wrongly.
func TestASessionOpensARunStampedWithWhatItAlreadyHolds(t *testing.T) {
	s := opened(t)
	sink := &collected{}

	rec, err := s.Open(sink)
	if err != nil {
		t.Fatalf("open a Run: %v", err)
	}
	if err := rec.Record(context.Background(), events.Started{Intent: "what is this project"}); err != nil {
		t.Fatalf("record the opening: %v", err)
	}

	if len(sink.events) != 1 {
		t.Fatalf("the sink took %d events, want 1", len(sink.events))
	}
	switch e := sink.events[0]; {
	case e.Session != s.ID:
		t.Errorf("session = %q, want %q", e.Session, s.ID)
	case e.Tenant != s.Tenant:
		t.Errorf("tenant = %q, want %q", e.Tenant, s.Tenant)
	case e.Actor != s.Actor:
		t.Errorf("actor = %+v, want %+v", e.Actor, s.Actor)
	case e.Run != "run_1":
		t.Errorf("run = %q, want the one the Session minted", e.Run)
	}

	// And the transcript folded, because the Session subscribes to every Run
	// it opens rather than waiting to be added to one.
	if got := transcript(s); got != "user:what is this project|" {
		t.Errorf("transcript = %q — the Session did not subscribe to its own Run", got)
	}
}

// A second Run of one Session is a second Run, and the transcript folds across
// both. This is what makes the second prompt answered in the light of the
// first.
func TestASessionOpensManyRunsAndFoldsAcrossThem(t *testing.T) {
	s := opened(t)
	sink := &collected{}

	for _, intent := range []string{"first", "second"} {
		rec, err := s.Open(sink)
		if err != nil {
			t.Fatalf("open a Run: %v", err)
		}
		if err := rec.Record(context.Background(), events.Started{Intent: intent}); err != nil {
			t.Fatalf("record the opening: %v", err)
		}
	}

	if sink.events[0].Run == sink.events[1].Run {
		t.Errorf("both Runs are %q, want two", sink.events[0].Run)
	}
	if got := transcript(s); got != "user:first|user:second|" {
		t.Errorf("transcript = %q, want both prompts", got)
	}
}

// A Session with no outside world says which part of it is missing, rather
// than panicking on the first Run it is asked for.
func TestASessionWithNoOriginReportsWhatItCannotOpenARunWithout(t *testing.T) {
	for _, c := range []struct {
		name   string
		origin core.Origin
		want   string
	}{
		{"nothing at all", core.Origin{}, "Run identifiers"},
		{
			name:   "no clock",
			origin: core.Origin{RunID: func() events.RunID { return "run_1" }, EventID: func() events.EventID { return "evt_1" }},
			want:   "clock",
		},
		{
			name:   "no identifiers for its records",
			origin: core.Origin{RunID: func() events.RunID { return "run_1" }, Now: func() events.Timestamp { return events.Timestamp{} }},
			want:   "identifier",
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			s := core.NewSession("sess_1", "tenant_1",
				events.Identity{ID: "agent", Kind: events.ActorAgent}, c.origin)

			rec, err := s.Open(&collected{})
			if err == nil {
				t.Fatalf("opened a Run with %+v and got %v", c.origin, rec)
			}
			if !strings.Contains(err.Error(), c.want) {
				t.Errorf("err = %v, want it to name %q", err, c.want)
			}
		})
	}
}

type collected struct {
	events []events.Event
	seq    uint64
}

func (c *collected) Append(_ context.Context, group []events.Event) ([]events.Event, error) {
	out := make([]events.Event, len(group))
	for i, e := range group {
		c.seq++
		e.Seq = c.seq
		out[i] = e
	}
	c.events = append(c.events, out...)
	return out, nil
}

func (c *collected) Close() error { return nil }

// The prompt rides on Started, so the transcript opens with it.
func TestTheIntentOnStartedOpensTheTranscript(t *testing.T) {
	s := session()
	fold(t, s, event("run_1", events.Started{Intent: "what is this project"}))

	if got := transcript(s); got != "user:what is this project|" {
		t.Errorf("transcript = %q", got)
	}
}

// A Run opened by something other than a Spec carries no intent, and adds no
// Message.
func TestStartedWithNoIntentAddsNoMessage(t *testing.T) {
	s := session()
	fold(t, s, event("run_1", events.Started{}))

	if got := len(s.Messages()); got != 0 {
		t.Errorf("%d messages, want none", got)
	}
}

func TestTextOfOneRunFoldsIntoOneAssistantMessage(t *testing.T) {
	s := session()
	fold(t, s,
		event("run_1", events.Started{Intent: "hello"}),
		event("run_1", events.Text{Block: 0, Chunk: "Eva is "}),
		event("run_1", events.Text{Block: 1, Chunk: "a factory."}),
	)

	if got := transcript(s); got != "user:hello|assistant:Eva is a factory.|" {
		t.Errorf("transcript = %q", got)
	}
}

func TestASecondRunIsASecondExchange(t *testing.T) {
	s := session()
	fold(t, s,
		event("run_1", events.Started{Intent: "one"}),
		event("run_1", events.Text{Chunk: "first answer"}),
		event("run_1", events.Finished{Claim: events.Claim{Result: events.ResultDone}}),
		event("run_2", events.Started{Intent: "two"}),
		event("run_2", events.Text{Chunk: "second answer"}),
	)

	want := "user:one|assistant:first answer|user:two|assistant:second answer|"
	if got := transcript(s); got != want {
		t.Errorf("transcript = %q, want %q", got, want)
	}
}

// The turn that fails halfway is the one this whole design is for. The Trace
// holds the partial answer, so the Session holds it too — the two cannot
// disagree, because there is only one of them.
func TestAPartialAnswerIsInTheTranscript(t *testing.T) {
	s := session()
	fold(t, s,
		event("run_1", events.Started{Intent: "hello"}),
		event("run_1", events.Text{Chunk: "Eva is "}),
		event("run_1", events.Finished{Claim: events.Claim{Result: events.ResultFailed, Summary: "stream broke"}}),
	)

	want := "user:hello|assistant:Eva is |"
	if got := transcript(s); got != want {
		t.Errorf("transcript = %q, want %q — a partial answer was lost", got, want)
	}
}

func TestKindsThatAreNotMessagesAddNoMessage(t *testing.T) {
	s := session()
	fold(t, s,
		event("run_1", events.Started{Intent: "hello"}),
		event("run_1", events.Usage{InputTokens: events.Tokens(10)}),
		event("run_1", events.Retry{Attempt: 1, Max: 3, ErrorClass: events.ErrorRateLimit}),
		event("run_1", events.Degraded{Missing: []string{"usage"}}),
		event("run_1", events.Text{Chunk: "answer"}),
	)

	if got := transcript(s); got != "user:hello|assistant:answer|" {
		t.Errorf("transcript = %q", got)
	}
}

// A Usage record between two chunks does not split the answer: what folds is
// the Run's text, and the records in between are not text.
func TestANonTextRecordDoesNotSplitTheAnswer(t *testing.T) {
	s := session()
	fold(t, s,
		event("run_1", events.Text{Chunk: "Eva is "}),
		event("run_1", events.Usage{InputTokens: events.Tokens(10)}),
		event("run_1", events.Text{Chunk: "a factory."}),
	)

	if got := transcript(s); got != "assistant:Eva is a factory.|" {
		t.Errorf("transcript = %q", got)
	}
}

func TestEventsOfAnotherSessionAreIgnored(t *testing.T) {
	s := session()

	elsewhere := event("run_9", events.Started{Intent: "not ours"})
	elsewhere.Session = "sess_2"

	fold(t, s, elsewhere, event("run_1", events.Started{Intent: "ours"}))

	if got := transcript(s); got != "user:ours|" {
		t.Errorf("transcript = %q", got)
	}
}

// Editing history is what branch and rewind exist to do properly, so the
// transcript a caller is handed is a copy.
func TestMessagesHandsBackACopy(t *testing.T) {
	s := session()
	fold(t, s, event("run_1", events.Started{Intent: "hello"}))

	got := s.Messages()
	got[0] = core.Say(core.AuthorUser, "something else")

	if s.Messages()[0].Said() != "hello" {
		t.Error("a caller edited the transcript through the slice it was handed")
	}
}

// An entry holds a slice, so copying the outer one alone would hand back
// entries that still share the fold's own memory.
func TestMessagesCopiesTheBlocksToo(t *testing.T) {
	s := session()
	fold(t, s, event("run_1", events.Started{Intent: "hello"}))

	got := s.Messages()
	got[0].Blocks[0] = core.Text{Text: "something else"}

	if s.Messages()[0].Said() != "hello" {
		t.Error("a caller edited the transcript through the blocks it was handed")
	}
}

// The Session has no writer of its own: the Recorder is what feeds it, and the
// wiring is the Subscriber interface.
func TestASessionIsFedByTheRecorder(t *testing.T) {
	s := session()
	rec := recorder(t, options(&sink{}, s))

	err := rec.Record(context.Background(),
		events.Started{Intent: "what is this project"},
		events.Text{Chunk: "Eva is a factory."},
	)
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	want := "user:what is this project|assistant:Eva is a factory.|"
	if got := transcript(s); got != want {
		t.Errorf("transcript = %q, want %q", got, want)
	}
}

func TestAFreshSessionKeepsTheIdentityAndEmptiesTheTranscript(t *testing.T) {
	s := opened(t)
	fold(t, s,
		event("run_1", events.Started{Intent: "what is this project"}),
		event("run_1", events.Text{Chunk: "Eva is a software factory."}),
		event("run_1", events.Finished{Claim: events.Claim{Result: events.ResultDone}}),
	)

	next := s.Fresh("sess_2")

	if got := transcript(next); got != "" {
		t.Errorf("the fresh Session holds %q, want an empty transcript", got)
	}
	if next.ID != "sess_2" {
		t.Errorf("the fresh Session is %q, want the identifier it was opened with", next.ID)
	}
	if next.Tenant != s.Tenant || next.Actor != s.Actor {
		t.Errorf("the fresh Session runs as %s/%+v, want %s/%+v", next.Tenant, next.Actor, s.Tenant, s.Actor)
	}
	if _, err := next.Open(&collected{}); err != nil {
		t.Errorf("the fresh Session cannot open a Run: %v", err)
	}

	// And the Session it came from is untouched. Nothing was deleted; the
	// transcript that was there is still there, and so is the Trace behind it.
	if got, want := transcript(s), "user:what is this project|assistant:Eva is a software factory.|"; got != want {
		t.Errorf("the Session that was cleared now holds %q, want %q", got, want)
	}

	// The fresh Session takes only what is stamped with its own identifier, so
	// the two transcripts cannot drift into each other.
	said := event("run_2", events.Started{Intent: "and what else"})
	fold(t, next, said)
	if got := transcript(next); got != "" {
		t.Errorf("the fresh Session folded an Event of Session %q: %q", said.Session, got)
	}

	said.Session = next.ID
	fold(t, next, said)
	if got, want := transcript(next), "user:and what else|"; got != want {
		t.Errorf("the fresh Session holds %q, want %q", got, want)
	}
}

// A tool exchange is what the transcript could not hold before it held blocks.
// The fold has to give back a call and the result that answers it, in the
// entries a provider takes them in, or the next request carries a call nothing
// answers and every provider rejects it.
func TestAToolExchangeFoldsBackIntoTheTranscript(t *testing.T) {
	s := session()
	fold(t, s,
		event("run_1", events.Started{Intent: "what is in this directory"}),
		event("run_1", events.Text{Chunk: "Let me look."}),
		event("run_1", events.ToolCall{ID: "call_1", Name: "list_dir", Args: []byte(`{"path":"."}`)}),
		event("run_1", events.ToolResult{
			Call: "call_1", Name: "list_dir",
			Disposition: events.DispositionOK, Content: "README.md\ngo.mod",
		}),
		event("run_1", events.Text{Chunk: "Two files."}),
	)

	got := s.Messages()
	if len(got) != 4 {
		t.Fatalf("the exchange folded into %d entries, want the prompt, the call, the result, and the answer: %+v", len(got), got)
	}

	// The assistant asked in one entry: the words it said and the call it made.
	asked := got[1]
	if asked.Author != core.AuthorAssistant || len(asked.Blocks) != 2 {
		t.Fatalf("the call arrived as %+v", asked)
	}
	call, isCall := asked.Blocks[1].(core.ToolCall)
	if !isCall || call.ID != "call_1" || call.Name != "list_dir" || call.Args != `{"path":"."}` {
		t.Errorf("the call folded to %+v", asked.Blocks[1])
	}

	// The result answers it in the next entry, naming the call it belongs to.
	// Without the pairing a turn with two calls in flight cannot be rebuilt.
	answered := got[2]
	if answered.Author != core.AuthorUser || len(answered.Blocks) != 1 {
		t.Fatalf("the result arrived as %+v", answered)
	}
	result, isResult := answered.Blocks[0].(core.ToolResult)
	if !isResult || result.Call != call.ID || result.Content != "README.md\ngo.mod" {
		t.Errorf("the result folded to %+v", answered.Blocks[0])
	}
	if result.Disposition != events.DispositionOK {
		t.Errorf("the result folded with disposition %q", result.Disposition)
	}

	// What the assistant said after the result is a new entry, because the
	// result was the other party speaking.
	if last := got[3]; last.Author != core.AuthorAssistant || last.Said() != "Two files." {
		t.Errorf("the answer after the tool ran folded to %+v", last)
	}
}

// Two calls in one turn are answered separately, and each result names the call
// it belongs to. This is the case a transcript of strings cannot express at all.
func TestTwoCallsInOneTurnKeepTheirPairing(t *testing.T) {
	s := session()
	fold(t, s,
		event("run_1", events.Started{Intent: "read both files"}),
		event("run_1", events.ToolCall{ID: "call_1", Name: "read", Args: []byte(`{"path":"a"}`)}),
		event("run_1", events.ToolCall{ID: "call_2", Name: "read", Args: []byte(`{"path":"b"}`)}),
		event("run_1", events.ToolResult{Call: "call_1", Name: "read", Disposition: events.DispositionOK, Content: "A"}),
		event("run_1", events.ToolResult{Call: "call_2", Name: "read", Disposition: events.DispositionFailed, Content: "no such file"}),
	)

	got := s.Messages()
	if len(got) != 3 {
		t.Fatalf("the exchange folded into %d entries, want the prompt, both calls, and both results: %+v", len(got), got)
	}
	if len(got[1].Blocks) != 2 || len(got[2].Blocks) != 2 {
		t.Fatalf("the calls and results did not stay together: %+v", got)
	}

	for i, want := range []string{"call_1", "call_2"} {
		call, isCall := got[1].Blocks[i].(core.ToolCall)
		if !isCall || call.ID != want {
			t.Errorf("call %d folded to %+v", i, got[1].Blocks[i])
		}
		result, isResult := got[2].Blocks[i].(core.ToolResult)
		if !isResult || result.Call != want {
			t.Errorf("result %d folded to %+v", i, got[2].Blocks[i])
		}
	}

	// A call that failed is still a result the model can act on, so it is in
	// the transcript rather than left out of it.
	failed, _ := got[2].Blocks[1].(core.ToolResult)
	if failed.Disposition != events.DispositionFailed || failed.Content != "no such file" {
		t.Errorf("the failed call folded to %+v", got[2].Blocks[1])
	}
}

// Words that arrive around a call still join the entry they were said in,
// because a transcript entry is what was said and not how many pieces it
// arrived in.
func TestWordsAroundACallJoinOneEntry(t *testing.T) {
	s := session()
	fold(t, s,
		event("run_1", events.Started{Intent: "look"}),
		event("run_1", events.Text{Chunk: "I will "}),
		event("run_1", events.Text{Chunk: "look now."}),
		event("run_1", events.ToolCall{ID: "call_1", Name: "list_dir"}),
	)

	asked := s.Messages()[1]
	if len(asked.Blocks) != 2 {
		t.Fatalf("the chunks did not join around the call: %+v", asked.Blocks)
	}
	if asked.Said() != "I will look now." {
		t.Errorf("the words folded to %q", asked.Said())
	}
}
