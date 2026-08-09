package events

import (
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
)

// Payload is what an Event carries beyond its envelope.
//
// The single method is unexported, so no package outside this one can declare
// a payload and the closed kind set is enforced by the compiler rather than by
// review. The alternative — one struct with an optional pointer per payload —
// makes "which pointer is set" and "what Kind says" able to disagree, which is
// an invariant you must then write tests to defend.
//
// isPayload looks like dead code and invites removal. It is the mechanism, not
// decoration: deleting it opens the kind set to every importing package.
//
// # Where the compiler stops
//
// Go has one hole in this and it cannot be closed by a signature: a type that
// embeds Payload has isPayload promoted to it, so it satisfies the interface
// without declaring anything. The compiler cannot tell that apart from a
// legitimate wrapper.
//
// The codec closes it instead, and closes it shut: such a value is not in the
// registry below, so KindOf does not recognise it and Event.MarshalJSON
// refuses to encode it rather than writing a record with no kind. So a forged
// payload cannot reach a Trace — the guarantee holds, but at the codec rather
// than at the compiler, and the distinction is worth knowing before someone
// relies on the wrong one.
type Payload interface{ isPayload() }

// The registry is the one place a Kind and its payload type are tied together.
//
// Before it there were two switches — one to name a payload, one to read it
// back — and nothing made them agree. A payload missing from the second
// encoded fine and decoded as Unknown, which is a Trace that is structurally
// valid and quietly wrong. One table cannot half-agree with itself.
var (
	// kindByType names the Kind a payload's dynamic type belongs to.
	kindByType = map[reflect.Type]Kind{}
	// decoderByKind reads a payload back from its stored bytes.
	decoderByKind = map[Kind]func(json.RawMessage) (Payload, error){}
)

// register ties a Kind to its payload type. It is called from init below, once
// per kind, beside the type it names.
//
// A duplicate registration panics at init rather than at the first Event that
// meets it: two kinds sharing a type, or two types sharing a kind, is a schema
// that cannot round-trip, and a program that cannot round-trip its own Trace
// has nothing to run.
func register[T Payload](kind Kind) {
	var zero T
	typ := reflect.TypeOf(zero)

	if existing, dup := kindByType[typ]; dup {
		panic(fmt.Sprintf("events: %s is already registered as %q", typ, existing))
	}
	if _, dup := decoderByKind[kind]; dup {
		panic(fmt.Sprintf("events: kind %q is registered twice", kind))
	}

	kindByType[typ] = kind
	decoderByKind[kind] = func(raw json.RawMessage) (Payload, error) {
		var p T
		if err := json.Unmarshal(raw, &p); err != nil {
			return nil, fmt.Errorf("events: decode %s payload: %w", kind, err)
		}
		return p, nil
	}
}

// Capabilities is what a Run can actually do. It is discovered twice and the
// per-run value wins, because configuration — bare mode, managed settings, a
// missing MCP server — changes what a Run can do. Feature-detect on this;
// never compare version strings to infer capability.
type Capabilities struct {
	// Resume continues an interrupted Run.
	Resume bool `json:"resume"`
	// CostReport emits real token and dollar usage.
	CostReport bool `json:"cost_report"`
	// StructuredEvents means every step is recorded as a typed Event, rather
	// than as output an adapter has to scrape.
	StructuredEvents bool `json:"structured_events"`
	// ToolPolicy honours an external allowlist.
	ToolPolicy bool `json:"tool_policy"`
	// MCP speaks the Model Context Protocol.
	MCP bool `json:"mcp"`
	// Subagents decomposes in parallel internally.
	Subagents bool `json:"subagents"`
	// Interrupt cancels cleanly.
	Interrupt bool `json:"interrupt"`
}

// KindStarted opens a Run.
const KindStarted Kind = "started"

// Started opens a Run.
//
// It carries the Spec's intent because the Trace is the single source of
// truth, and a transcript whose first message is missing is one a Trace cannot
// reconstruct. Without this field the prompt exists only in the process that
// answered it, and resume, branch, and rewind have nothing to resume from.
type Started struct {
	// Intent is what the Spec asked for: the first message of the transcript.
	// It is absent on a Run opened by something other than a Spec, which is
	// why it is omitempty rather than always present.
	Intent       string       `json:"intent,omitempty"`
	Capabilities Capabilities `json:"capabilities"`
}

func (Started) isPayload() {}

// KindText names one chunk of one content block.
const KindText Kind = "text"

// Text is one chunk of one content block.
//
// Chunks stream one at a time on the wire, and the Trace sink folds
// consecutive chunks of one block into a single record when it commits, so a
// Trace record corresponds to a unit of meaning rather than to a token. Block
// is what the fold folds on.
type Text struct {
	Block int    `json:"block"`
	Chunk string `json:"chunk"`
}

func (Text) isPayload() {}

// KindToolCall names a request to run a tool.
const KindToolCall Kind = "tool_call"

// ToolCall is a request to run a tool. Args stay raw because a tool's schema is
// the tool's, and Redacted says the arguments held something a Trace must not.
//
// ID is what the result of this call answers, and it is the provider's own
// identifier rather than one Eva mints: the next request has to name the call
// in the words the provider used, so an identifier of our own would have to be
// translated back at the wire and would be a second identity for one call.
// Without it a fold could put a call and a result in one transcript and still
// not say which answered which, and a turn with two calls in flight is the
// ordinary case rather than the exotic one.
type ToolCall struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Args     json.RawMessage `json:"args"`
	Redacted bool            `json:"redacted"`
}

func (ToolCall) isPayload() {}

// Disposition is how a tool call ended. Each value implies a different
// recovery, so a boolean would make the model infer the right one from prose
// in an error string.
type Disposition string

const (
	// DispositionOK is a tool call that ran and returned.
	DispositionOK Disposition = "ok"
	// DispositionDenied is a policy refusal the model should route around.
	DispositionDenied Disposition = "denied"
	// DispositionFailed is a tool call that ran and broke. Usually not
	// recoverable by retrying the same call.
	DispositionFailed Disposition = "failed"
	// DispositionSkipped is what unstarted calls in a parallel group become
	// when the user steers mid-turn, so that nothing is orphaned.
	DispositionSkipped Disposition = "skipped"
	// DispositionCancelled is a call the caller stopped.
	DispositionCancelled Disposition = "cancelled"
	// DispositionUnknownTool is recoverable by choosing a different tool.
	DispositionUnknownTool Disposition = "unknown_tool"
	// DispositionBudgetDenied is the one where the correct recovery is to
	// summarize partial work and return Exhausted. Budget exhaustion enters
	// the transcript as a recoverable result rather than arriving as a
	// process kill from outside.
	DispositionBudgetDenied Disposition = "budget_denied"
)

// KindToolResult names how a tool call ended.
const KindToolResult Kind = "tool_result"

// ToolResult is how a tool call ended. A tool call always has one, whatever
// happened to it, so the transcript stays structurally valid for the next
// provider call.
//
// Call names the ToolCall this answers, and Content is what the model is shown
// of the outcome. Both are here because the transcript is a fold and nothing
// else: a record that said only that a call ended would leave the fold able to
// rebuild that something happened and unable to rebuild the conversation, and
// the next request would carry a call with no answer — which every provider
// rejects. Bytes stays beside Content because what a projection shows and what
// a model is sent are different sizes once a result is elided for display.
//
// Content is a string rather than raw JSON: what goes back to the provider is
// what the model reads, and a tool that answers in JSON answers with JSON in
// it. Redaction happens before a result reaches here, for the reason it happens
// at the sink rather than after — written then scrubbed is a breach with extra
// steps.
type ToolResult struct {
	Call        string      `json:"call"`
	Name        string      `json:"name"`
	Disposition Disposition `json:"disposition"`
	Content     string      `json:"content"`
	Bytes       int         `json:"bytes"`
}

func (ToolResult) isPayload() {}

// KindUsage names what a turn cost.
const KindUsage Kind = "usage"

// Usage is normalized, rather than mirroring any one provider's shape.
//
// Nullability here is load-bearing, not stylistic: nil means the provider did
// not tell us, and 0 means none were used. Collapsing the two is how a cost
// report becomes confidently wrong.
//
// Every counter is nullable, including the four a turn almost always reports.
// They were plain integers until the distinction they most needed was the one
// they could not make: a provider that reported nothing produced a record of
// zeros, which reads as a turn that cost nothing rather than a turn nobody
// measured. One provider rebuilt the distinction beside the schema and the
// next one to arrive would have had to know to. It is in the type now, so a
// provider that says nothing cannot say zero by accident.
type Usage struct {
	InputTokens  *uint64 `json:"input_tokens"`
	OutputTokens *uint64 `json:"output_tokens"`
	// A cache write costs more than base input and a cache read costs far
	// less, so one field cannot compute cost — and cache-hit rate is the
	// largest single lever on cost per task.
	CacheWriteTokens *uint64 `json:"cache_write_tokens"`
	CacheReadTokens  *uint64 `json:"cache_read_tokens"`
	// ReasoningTokens is unfillable on Anthropic, which bills thinking tokens
	// inside OutputTokens and reports no separate figure. It is real and
	// necessary for OpenAI-compatible providers.
	ReasoningTokens  *uint64 `json:"reasoning_tokens"`
	ServerToolTokens *uint64 `json:"server_tool_tokens"`
	// USD is never populated with an estimate. Billing meters from
	// provider-reported usage reconciled against invoices, so a wall-clock
	// derived figure here would become a financial liability.
	USD *float64 `json:"usd"`
}

func (Usage) isPayload() {}

// Tokens is a reported counter, for the caller that has a figure to state.
//
// The absent counter is the zero value and needs no constructor. This exists so
// that stating a figure is one expression rather than a local variable and its
// address, which is the shape that makes a caller reach for a plain zero
// instead.
func Tokens(n uint64) *uint64 { return &n }

// ErrorClass is why a retry happened, from a fixed set, so that rate limits
// can be told apart from server errors without parsing prose.
type ErrorClass string

const (
	ErrorRateLimit   ErrorClass = "rate_limit"
	ErrorOverloaded  ErrorClass = "overloaded"
	ErrorAuthFailed  ErrorClass = "auth_failed"
	ErrorServerError ErrorClass = "server_error"
	ErrorOther       ErrorClass = "other"
)

// KindRetry names an attempt that spent money and produced nothing.
const KindRetry Kind = "retry"

// Retry spends money and wall clock but produces no ToolCall, so it is its own
// record. Without it, the cost of retries is invisible.
type Retry struct {
	Attempt    int        `json:"attempt"`
	Max        int        `json:"max"`
	DelayMS    int        `json:"delay_ms"`
	ErrorClass ErrorClass `json:"error_class"`
}

func (Retry) isPayload() {}

// KindEdit names a change to a file.
const KindEdit Kind = "edit"

// Edit is a change to a file. It carries the shape of the change rather than
// its content: a Trace records that a file was edited and how much, and the
// diff itself lives where diffs live.
type Edit struct {
	Path  string `json:"path"`
	Hunks int    `json:"hunks"`
}

func (Edit) isPayload() {}

// KindNeedsHuman names an escalation.
const KindNeedsHuman Kind = "needs_human"

// NeedsHuman is escalation, which is an Outcome rather than an error. Resume
// is the position the answer re-enters at, not the Session it belongs to.
type NeedsHuman struct {
	Question string `json:"question"`
	Resume   Cursor `json:"resume"`
}

func (NeedsHuman) isPayload() {}

// Result is how a Unit ended.
type Result string

const (
	ResultDone       Result = "done"
	ResultFailed     Result = "failed"
	ResultNeedsHuman Result = "needs_human"
	ResultExhausted  Result = "exhausted"
)

// Claim is an assertion of success by whatever did the work. A Claim is never
// Evidence, however trustworthy its source.
type Claim struct {
	Result  Result `json:"result"`
	Summary string `json:"summary,omitempty"`
}

// KindFinished names the close of a Run.
const KindFinished Kind = "finished"

// Finished closes a Run with a claim, not a verdict.
type Finished struct {
	Claim Claim `json:"claim"`
}

func (Finished) isPayload() {}

// KindDegraded names incomplete data.
const KindDegraded Kind = "degraded"

// Degraded says that some data is incomplete, estimated, or unreported.
// Its presence is the flag — it is absent when the Run is clean, so a CI gate
// fails on a non-empty array without needing a separate boolean.
type Degraded struct {
	Missing []string `json:"missing"`
}

func (Degraded) isPayload() {}

// KindUnknown names a kind this build does not recognise.
const KindUnknown Kind = "unknown"

// Unknown is an Event kind this build does not recognise, preserved verbatim.
// Eva's own loop cannot emit one; it arrives from a foreign Harness. Dropping
// it would produce a Trace that is structurally valid and quietly wrong, and
// the Trace is the only instrument the project has.
type Unknown struct {
	Kind string          `json:"kind"`
	Raw  json.RawMessage `json:"raw"`
}

func (Unknown) isPayload() {}

func init() {
	register[Started](KindStarted)
	register[Text](KindText)
	register[ToolCall](KindToolCall)
	register[ToolResult](KindToolResult)
	register[Usage](KindUsage)
	register[Retry](KindRetry)
	register[Edit](KindEdit)
	register[NeedsHuman](KindNeedsHuman)
	register[Finished](KindFinished)
	register[Degraded](KindDegraded)
	register[Unknown](KindUnknown)
}

// KindOf names the Kind a payload belongs to. It reports false for a payload
// this build does not know, which nothing outside this package can construct —
// and for a type that embeds Payload to borrow its method, which is the one
// hole the compiler leaves open.
func KindOf(p Payload) (Kind, bool) {
	if p == nil {
		return "", false
	}
	kind, ok := kindByType[reflect.TypeOf(p)]
	return kind, ok
}

// Kinds is the registered set, sorted so that the order is the same on every
// run. A test that iterates this covers every kind the build knows, including
// the one added after the test was written.
func Kinds() []Kind {
	out := make([]Kind, 0, len(decoderByKind))
	for kind := range decoderByKind {
		out = append(out, kind)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}
