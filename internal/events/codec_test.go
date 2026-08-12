package events_test

import (
	"encoding/json"
	"slices"
	"testing"
	"time"

	"github.com/missingstudio/eva/internal/events"
)

// The encoding is a published contract: every reader of a Trace reads it —
// adapters, extensions, and the projections a person sees a turn in.
// Exercising it is therefore testing external behaviour, not reaching into the
// package.

func envelope(t *testing.T, p events.Payload) events.Event {
	t.Helper()
	parent := events.RunID("run_parent")
	return events.Event{
		ID:      "evt_1",
		Seq:     7,
		WireSeq: 3,
		At: events.Timestamp{
			Wall: time.Date(2026, 8, 8, 12, 0, 0, 500, time.UTC),
			Mono: 1234,
		},
		Version: events.SchemaVersion,
		Tenant:  "tenant_1",
		Actor:   events.Identity{ID: "praveen", Kind: events.ActorHuman},
		Run:     "run_1",
		Session: "sess_1",
		Parent:  &parent,
		Payload: p,
	}
}

func roundTrip(t *testing.T, in events.Event) events.Event {
	t.Helper()
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out events.Event
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal %s: %v", b, err)
	}
	return out
}

// samples is one populated payload per Kind. It is checked against the
// registry rather than trusted, so a kind added without a sample fails here
// instead of going untested.
func samples() map[events.Kind]events.Payload {
	reasoning := uint64(0)
	usd := 0.25
	return map[events.Kind]events.Payload{
		events.KindStarted:    events.Started{Intent: "what is this project", Capabilities: events.Capabilities{StructuredEvents: true, CostReport: true}},
		events.KindText:       events.Text{Block: 2, Chunk: "hello"},
		events.KindToolCall:   events.ToolCall{Name: "read", Args: json.RawMessage(`{"path":"go.mod"}`), Redacted: true},
		events.KindToolResult: events.ToolResult{Name: "read", Disposition: events.DispositionBudgetDenied, Bytes: 12},
		events.KindUsage:      events.Usage{InputTokens: events.Tokens(1200), OutputTokens: events.Tokens(340), ReasoningTokens: &reasoning, USD: &usd},
		events.KindRetry:      events.Retry{Attempt: 2, Max: 5, DelayMS: 750, ErrorClass: events.ErrorRateLimit},
		events.KindEdit:       events.Edit{Path: "cli/main.go", Hunks: 3},
		events.KindNeedsHuman: events.NeedsHuman{Question: "merge?", Resume: events.Cursor{Session: "sess_1", Seq: 7}},
		events.KindFinished:   events.Finished{Claim: events.Claim{Result: events.ResultFailed, Summary: "provider anthropic: auth_failed: 401", ErrorClass: events.ErrorAuthFailed}},
		events.KindDegraded:   events.Degraded{Missing: []string{"usage"}},
		events.KindUnknown:    events.Unknown{Kind: "quantum_flux", Raw: json.RawMessage(`{"a":1}`)},
	}
}

// The kinds come from the registry, so this covers the kind added after the
// test was written. A hand-typed list would have let a new kind ship with no
// round-trip at all — which is how a Trace becomes structurally valid and
// quietly unreadable.
func TestEveryKindRoundTrips(t *testing.T) {
	registered := events.Kinds()
	if len(registered) == 0 {
		t.Fatal("the registry is empty")
	}

	have := samples()
	for _, kind := range registered {
		payload, ok := have[kind]
		if !ok {
			t.Fatalf("kind %q is registered but has no sample to round-trip", kind)
		}
		if got, _ := events.KindOf(payload); got != kind {
			t.Fatalf("the sample for %q is a %T, which KindOf names %q", kind, payload, got)
		}
	}
	for kind := range have {
		if !slices.Contains(registered, kind) {
			t.Errorf("kind %q has a sample but is not registered", kind)
		}
	}

	for _, kind := range registered {
		t.Run(string(kind), func(t *testing.T) {
			payload := have[kind]
			in := envelope(t, payload)
			out := roundTrip(t, in)

			if out.Kind != kind {
				t.Errorf("kind = %q, want %q", out.Kind, kind)
			}
			if out.ID != in.ID || out.Seq != in.Seq || out.WireSeq != in.WireSeq {
				t.Errorf("identity or positions lost: %+v", out)
			}
			if out.Version != in.Version || out.Tenant != in.Tenant || out.Actor != in.Actor {
				t.Errorf("envelope lost: %+v", out)
			}
			if out.Run != in.Run || out.Session != in.Session {
				t.Errorf("run or session lost: %+v", out)
			}
			if out.Parent == nil || *out.Parent != *in.Parent {
				t.Errorf("parent = %v, want %v", out.Parent, in.Parent)
			}
			if !out.At.Wall.Equal(in.At.Wall) || out.At.Mono != in.At.Mono {
				t.Errorf("timestamp = %+v, want %+v", out.At, in.At)
			}
			if !payloadEqual(out.Payload, payload) {
				t.Errorf("payload = %#v, want %#v", out.Payload, payload)
			}
		})
	}
}

// payloadEqual compares through JSON so that json.RawMessage fields, which are
// byte slices, compare by content rather than by identity.
func payloadEqual(a, b events.Payload) bool {
	x, err := json.Marshal(a)
	if err != nil {
		return false
	}
	y, err := json.Marshal(b)
	if err != nil {
		return false
	}
	return string(x) == string(y)
}

// The envelope carries the fold keys, so a projection never has to replay the
// stream to attribute a record.
func TestEnvelopeCarriesEveryFoldKey(t *testing.T) {
	b, err := json.Marshal(envelope(t, events.Text{Chunk: "x"}))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got map[string]json.RawMessage
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, key := range []string{
		"id", "seq", "wire_seq", "at", "version", "kind",
		"tenant", "actor", "run", "session", "parent", "payload",
	} {
		if _, ok := got[key]; !ok {
			t.Errorf("envelope has no %q: %s", key, b)
		}
	}
}

// An unrecognised kind is preserved verbatim rather than dropped.
func TestUnrecognisedKindIsPreservedWithItsBytes(t *testing.T) {
	raw := `{"id":"evt_9","seq":1,"wire_seq":0,"at":{"wall":"2026-08-08T12:00:00Z","mono_ns":1},` +
		`"version":1,"kind":"quantum_flux","tenant":"t","actor":{"id":"a","kind":"agent"},` +
		`"run":"r","session":"s","parent":null,"payload":{"nested":{"b":[1,2]},"a":1}}`

	var got events.Event
	if err := json.Unmarshal([]byte(raw), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Kind != events.KindUnknown {
		t.Fatalf("kind = %q, want %q", got.Kind, events.KindUnknown)
	}
	unknown, ok := got.Payload.(events.Unknown)
	if !ok {
		t.Fatalf("payload = %#v, want events.Unknown", got.Payload)
	}
	if unknown.Kind != "quantum_flux" {
		t.Errorf("preserved kind = %q, want %q", unknown.Kind, "quantum_flux")
	}
	if want := `{"nested":{"b":[1,2]},"a":1}`; string(unknown.Raw) != want {
		t.Errorf("preserved bytes = %s, want %s", unknown.Raw, want)
	}
}

func TestUsageAbsenceIsDistinctFromZero(t *testing.T) {
	zero := uint64(0)

	unreported, err := json.Marshal(events.Usage{InputTokens: events.Tokens(10), OutputTokens: events.Tokens(20)})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	none, err := json.Marshal(events.Usage{InputTokens: events.Tokens(10), OutputTokens: events.Tokens(20), ReasoningTokens: &zero})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(unreported) == string(none) {
		t.Fatalf("unreported and zero encode identically: %s", unreported)
	}

	var back events.Usage
	if err := json.Unmarshal(unreported, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if back.ReasoningTokens != nil {
		t.Errorf("ReasoningTokens = %d, want nil", *back.ReasoningTokens)
	}
	if err := json.Unmarshal(none, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if back.ReasoningTokens == nil || *back.ReasoningTokens != 0 {
		t.Errorf("ReasoningTokens = %v, want 0", back.ReasoningTokens)
	}
}

// Cache write and cache read are priced differently, so one field cannot
// compute cost.
func TestUsageSeparatesCacheWritesFromCacheReads(t *testing.T) {
	b, err := json.Marshal(events.Usage{CacheWriteTokens: events.Tokens(3), CacheReadTokens: events.Tokens(4)})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got["cache_write_tokens"] != float64(3) || got["cache_read_tokens"] != float64(4) {
		t.Errorf("cache figures = %v", got)
	}
}

// Kind is derived from the payload, so the two cannot disagree.
func TestKindAndPayloadCannotDisagree(t *testing.T) {
	e := envelope(t, events.Text{Chunk: "x"})
	e.Kind = events.KindUsage
	if _, err := json.Marshal(e); err == nil {
		t.Fatal("marshalling a mismatched kind and payload succeeded, want an error")
	}
}

// Every record carries the version it was written under, so a reader can
// migrate on read.
func TestAnEventWithoutASchemaVersionIsRejected(t *testing.T) {
	e := envelope(t, events.Text{Chunk: "x"})
	e.Version = 0
	if _, err := json.Marshal(e); err == nil {
		t.Fatal("marshalling an unversioned event succeeded, want an error")
	}
}

func TestAnEventWithoutAPayloadIsRejected(t *testing.T) {
	e := envelope(t, nil)
	if _, err := json.Marshal(e); err == nil {
		t.Fatal("marshalling a payloadless event succeeded, want an error")
	}
}

func TestKindOfNamesEveryPayload(t *testing.T) {
	if k, ok := events.KindOf(events.Finished{}); !ok || k != events.KindFinished {
		t.Errorf("KindOf(Finished) = %q, %v", k, ok)
	}
	if _, ok := events.KindOf(nil); ok {
		t.Error("KindOf(nil) reported a kind")
	}
}

// A record written under version 1 still reads. The counters were plain
// integers then, so a figure it carries is a figure; the zero it may have
// written for either "none" or "we were not told" reads as none, which is all a
// record made without the distinction can be asked to say.
func TestAVersionOneUsageRecordStillDecodes(t *testing.T) {
	const stored = `{"id":"evt_1","seq":4,"wire_seq":0,"at":{"wall":"2026-08-09T00:00:00Z","mono":1},` +
		`"version":1,"kind":"usage","tenant":"t","actor":{"id":"a","kind":"human"},"run":"run_1",` +
		`"session":"sess_1","parent":null,` +
		`"payload":{"input_tokens":1200,"output_tokens":340,"cache_write_tokens":0,"cache_read_tokens":0,` +
		`"reasoning_tokens":null,"server_tool_tokens":null,"usd":null}}`

	var got events.Event
	if err := json.Unmarshal([]byte(stored), &got); err != nil {
		t.Fatalf("a version 1 record did not decode: %v", err)
	}
	if got.Version != 1 {
		t.Errorf("version = %d, want the 1 the record was written under — a stored Trace is never rewritten", got.Version)
	}

	usage, ok := got.Payload.(events.Usage)
	if !ok {
		t.Fatalf("payload = %#v, want Usage", got.Payload)
	}
	if usage.InputTokens == nil || *usage.InputTokens != 1200 {
		t.Errorf("input tokens = %v, want the 1200 the record carries", usage.InputTokens)
	}
	if usage.CacheWriteTokens == nil || *usage.CacheWriteTokens != 0 {
		t.Errorf("cache writes = %v, want the zero the record states", usage.CacheWriteTokens)
	}
	if usage.ReasoningTokens != nil {
		t.Errorf("reasoning tokens = %d, want absent — the record says null", *usage.ReasoningTokens)
	}
}

// A counter the provider did not report is absent on the way out, and absent
// again on the way back. A zero here would be a turn claiming it used none.
func TestAnUnreportedCounterSurvivesTheRoundTrip(t *testing.T) {
	out := events.Event{
		ID: "evt_1", Version: events.SchemaVersion, Tenant: "t", Run: "run_1", Session: "sess_1",
		Payload: events.Usage{OutputTokens: events.Tokens(340)},
	}

	encoded, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	var back events.Event
	if err := json.Unmarshal(encoded, &back); err != nil {
		t.Fatalf("decode: %v", err)
	}

	usage, ok := back.Payload.(events.Usage)
	if !ok {
		t.Fatalf("payload = %#v, want Usage", back.Payload)
	}
	if usage.InputTokens != nil {
		t.Errorf("input tokens = %d, want absent: the provider reported none and a zero would say it used none", *usage.InputTokens)
	}
	if usage.OutputTokens == nil || *usage.OutputTokens != 340 {
		t.Errorf("output tokens = %v, want the figure that was reported", usage.OutputTokens)
	}
}

// A Claim nobody classified carries no class, and one that was classified
// carries it as a field rather than inside its prose.
func TestAClaimCarriesItsClassAndSaysNothingWhenThereIsNone(t *testing.T) {
	for _, c := range []struct {
		name  string
		claim events.Claim
		want  string
	}{
		{
			name:  "a run that succeeded",
			claim: events.Claim{Result: events.ResultDone, Summary: "answered"},
			want:  `{"result":"done","summary":"answered"}`,
		},
		{
			name:  "a failure nobody classified",
			claim: events.Claim{Result: events.ResultFailed, Summary: "interrupted"},
			want:  `{"result":"failed","summary":"interrupted"}`,
		},
		{
			name:  "a credential the provider refused",
			claim: events.Claim{Result: events.ResultFailed, Summary: "provider anthropic: 401", ErrorClass: events.ErrorAuthFailed},
			want:  `{"result":"failed","summary":"provider anthropic: 401","error_class":"auth_failed"}`,
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			b, err := json.Marshal(c.claim)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			if string(b) != c.want {
				t.Errorf("encoded %s, want %s", b, c.want)
			}

			var back events.Claim
			if err := json.Unmarshal(b, &back); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if back != c.claim {
				t.Errorf("round trip = %#v, want %#v", back, c.claim)
			}
		})
	}
}

// A Trace written before the class existed still reads, and reads as a failure
// nobody classified rather than as one placed in some default.
func TestAClaimWrittenBeforeTheClassExistsStillDecodes(t *testing.T) {
	var claim events.Claim
	if err := json.Unmarshal([]byte(`{"result":"failed","summary":"provider anthropic: 401"}`), &claim); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if claim.Result != events.ResultFailed {
		t.Errorf("result = %q, want %q", claim.Result, events.ResultFailed)
	}
	if claim.ErrorClass != "" {
		t.Errorf("class = %q, want none — the record predates the field", claim.ErrorClass)
	}
}
