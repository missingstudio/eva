package events

import (
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
)

type Payload interface{ isPayload() }

// The registry is the one place a Kind and its payload type are tied together.
var (
	// kindByType names the Kind a payload's dynamic type belongs to.
	kindByType = map[reflect.Type]Kind{}
	// decoderByKind reads a payload back from its stored bytes.
	decoderByKind = map[Kind]func(json.RawMessage) (Payload, error){}
)

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
	Resume     bool `json:"resume"`
	CostReport bool `json:"cost_report"`
	// StructuredEvents means every step is recorded as a typed Event, rather
	// than as output an adapter has to scrape.
	StructuredEvents bool `json:"structured_events"`
	ToolPolicy       bool `json:"tool_policy"`
	MCP              bool `json:"mcp"`
	Subagents        bool `json:"subagents"`
	Interrupt        bool `json:"interrupt"`
}

const KindStarted Kind = "started"

type Started struct {
	// Intent is what the Spec asked for: the first message of the transcript.
	// It is absent on a Run opened by something other than a Spec, which is
	// why it is omitempty rather than always present.
	Intent       string       `json:"intent,omitempty"`
	Capabilities Capabilities `json:"capabilities"`
}

func (Started) isPayload() {}

const KindText Kind = "text"

type Text struct {
	Block int    `json:"block"`
	Chunk string `json:"chunk"`
}

func (Text) isPayload() {}

const KindToolCall Kind = "tool_call"

// ToolCall is a request to run a tool. Args stay raw because a tool's schema is
// the tool's, and Redacted says the arguments held something a Trace must not.
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

const KindToolResult Kind = "tool_result"

// ToolResult is how a tool call ended. A tool call always has one, whatever
// happened to it, so the transcript stays structurally valid for the next
// provider call.
type ToolResult struct {
	Call        string      `json:"call"`
	Name        string      `json:"name"`
	Disposition Disposition `json:"disposition"`
	Content     string      `json:"content"`
	Bytes       int         `json:"bytes"`
}

func (ToolResult) isPayload() {}

const KindUsage Kind = "usage"

// Usage is normalized, rather than mirroring any one provider's shape.
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

func Tokens(n uint64) *uint64 { return &n }

// ErrorClass is why an attempt failed, from a fixed set, so that a rejected
// credential can be told apart from a rate limit without parsing prose.
type ErrorClass string

const (
	ErrorRateLimit  ErrorClass = "rate_limit"
	ErrorOverloaded ErrorClass = "overloaded"
	ErrorAuthFailed ErrorClass = "auth_failed"
	// ErrorUnreachable is no answer from the provider at all: a refused
	// connection, a reset, a stream cut mid-frame. It is told apart from a
	// server that answered badly because the two want opposite things from
	// whoever is watching — one is a network to wait out, and the other is a
	// vendor to wait out — and because only the first can be caused by the
	// machine Eva is running on.
	ErrorUnreachable ErrorClass = "unreachable"
	ErrorServerError ErrorClass = "server_error"
	// ErrorNoSuchModel is a model the provider does not serve. It is separate
	// from ErrorOther despite deciding the same thing about retrying, because
	// retrying is not the only question the class answers any more: this is the
	// most fixable failure Eva can meet — the name came out of a file, and the
	// person who wrote it can change it — and it arrived at a screen as the
	// line reserved for failures nobody could place.
	ErrorNoSuchModel ErrorClass = "no_such_model"
	// ErrorBilling is a provider that will not bill the turn: no credit, a
	// spend cap, a suspended account. Nothing about the request is wrong, so a
	// person told only that it failed would go and look at the request.
	ErrorBilling ErrorClass = "billing"
	ErrorOther   ErrorClass = "other"
)

// ErrorClasses is the set, so that anything which has to answer for every
// member can be checked against it rather than against a list somebody
// remembered to update.
func ErrorClasses() []ErrorClass {
	return []ErrorClass{
		ErrorRateLimit,
		ErrorOverloaded,
		ErrorAuthFailed,
		ErrorUnreachable,
		ErrorServerError,
		ErrorNoSuchModel,
		ErrorBilling,
		ErrorOther,
	}
}

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

const KindEdit Kind = "edit"

// Edit is a change to a file. It carries the shape of the change rather than
// its content: a Trace records that a file was edited and how much, and the
// diff itself lives where diffs live.
type Edit struct {
	Path  string `json:"path"`
	Hunks int    `json:"hunks"`
}

func (Edit) isPayload() {}

const KindNeedsHuman Kind = "needs_human"

// NeedsHuman is escalation, which is an Outcome rather than an error. Resume
// is the position the answer re-enters at, not the Session it belongs to.
type NeedsHuman struct {
	Question string `json:"question"`
	Resume   Cursor `json:"resume"`
}

func (NeedsHuman) isPayload() {}

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
	Result Result `json:"result"`
	// Summary is what went wrong, in whatever words the thing that failed
	// used. It is written for whoever is debugging the failure — a vendor's
	// error document, a request identifier, a status line — and it is the
	// reason ErrorClass exists beside it: a projection that has to show a
	// person why their turn produced nothing cannot show them this.
	Summary string `json:"summary,omitempty"`
	// ErrorClass is why the work failed, in the fixed set, and is absent on a
	// Claim nobody classified — a success, an interruption, a failure that
	// arrived from a path with no opinion about it.
	ErrorClass ErrorClass `json:"error_class,omitempty"`
}

const KindFinished Kind = "finished"

type Finished struct {
	Claim Claim `json:"claim"`
}

func (Finished) isPayload() {}

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
