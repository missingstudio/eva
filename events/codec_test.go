package events_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/missingstudio/eva/events"
)

// The encoding is a published contract: adapters, extensions, and every
// --json consumer read it. Exercising it is therefore testing external
// behaviour, not reaching into the package.

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

func TestEveryKindRoundTrips(t *testing.T) {
	reasoning := uint64(0)
	usd := 0.25
	cases := []struct {
		kind    events.Kind
		payload events.Payload
	}{
		{events.KindStarted, events.Started{Capabilities: events.Capabilities{StructuredEvents: true, CostReport: true}}},
		{events.KindText, events.Text{Block: 2, Chunk: "hello"}},
		{events.KindToolCall, events.ToolCall{Name: "read", Args: json.RawMessage(`{"path":"go.mod"}`), Redacted: true}},
		{events.KindToolResult, events.ToolResult{Name: "read", Disposition: events.DispositionBudgetDenied, Bytes: 12}},
		{events.KindUsage, events.Usage{InputTokens: 1200, OutputTokens: 340, ReasoningTokens: &reasoning, USD: &usd}},
		{events.KindRetry, events.Retry{Attempt: 2, Max: 5, DelayMS: 750, ErrorClass: events.ErrorRateLimit}},
		{events.KindEdit, events.Edit{Path: "cli/main.go", Hunks: 3}},
		{events.KindNeedsHuman, events.NeedsHuman{Question: "merge?", Resume: events.Cursor{Session: "sess_1", Seq: 7}}},
		{events.KindFinished, events.Finished{Claim: events.Claim{Result: events.ResultDone, Summary: "answered"}}},
		{events.KindDegraded, events.Degraded{Missing: []string{"usage"}}},
		{events.KindUnknown, events.Unknown{Kind: "quantum_flux", Raw: json.RawMessage(`{"a":1}`)}},
	}

	for _, c := range cases {
		t.Run(string(c.kind), func(t *testing.T) {
			in := envelope(t, c.payload)
			out := roundTrip(t, in)

			if out.Kind != c.kind {
				t.Errorf("kind = %q, want %q", out.Kind, c.kind)
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
			if !payloadEqual(out.Payload, c.payload) {
				t.Errorf("payload = %#v, want %#v", out.Payload, c.payload)
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

// ADR 0001: the envelope carries the fold keys, so a projection never has to
// replay the stream to attribute a record.
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

// ADR 0002: an unrecognised kind is preserved verbatim rather than dropped.
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

// ADR 0003: nil means the provider did not report a figure; 0 means none were
// used. Collapsing the two is how a cost report becomes confidently wrong.
func TestUsageAbsenceIsDistinctFromZero(t *testing.T) {
	zero := uint64(0)

	unreported, err := json.Marshal(events.Usage{InputTokens: 10, OutputTokens: 20})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	none, err := json.Marshal(events.Usage{InputTokens: 10, OutputTokens: 20, ReasoningTokens: &zero})
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
// compute cost (ADR 0003).
func TestUsageSeparatesCacheWritesFromCacheReads(t *testing.T) {
	b, err := json.Marshal(events.Usage{CacheWriteTokens: 3, CacheReadTokens: 4})
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

// ADR 0006: every record carries the version it was written under, so a reader
// can migrate on read.
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
