package openai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/providers"
)

// wire is this Provider's half of a turn: one POST, and the server-sent-event
// body it answers with.
//
// Everything around it — the queue, the retry that is a record before it is a
// wait, the books closing once — is the Driver's, and is the same here as it is
// for a Provider that speaks a vendor's SDK.
type wire struct {
	provider *Provider
	body     []byte

	// resp and frames are the connection, once there is one.
	resp   *http.Response
	frames *bufio.Scanner

	// emitted counts the bytes of each output item already handed over as
	// Text. The subscription backend restates a whole item after streaming
	// its deltas, and a public-API turn may state one it never streamed — so
	// what the restatement adds is the part past this count, and a turn that
	// streamed everything adds nothing twice.
	emitted map[int]int
}

var _ providers.Wire = (*wire)(nil)

// Dial makes one attempt.
//
// The credential is resolved here, per attempt, rather than once for the turn:
// a subscription token renews under a long session, and the attempt made after
// a retry wait must send the token that is live then.
func (w *wire) Dial(ctx context.Context) *providers.Refusal {
	token, err := w.provider.credential.Resolve()
	if err != nil {
		// Not a refusal from the API but a credential that cannot be had —
		// nothing about it improves on retry, and its message already names
		// the fix. It is classed with the credentials the API rejects: a login
		// that would not renew and a key the API refuses are one problem to
		// whoever has to go and fix it, whichever side noticed.
		return fatal(events.ErrorAuthFailed, err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.provider.transport.endpoint, bytes.NewReader(w.body))
	if err != nil {
		return fatal(events.ErrorOther, err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Authorization", "Bearer "+token)
	if err := w.provider.transport.decorate(req.Header, token); err != nil {
		return fatal(events.ErrorOther, err)
	}

	resp, err := w.provider.httpc.Do(req)
	if err != nil {
		return refused(0, err.Error(), 0)
	}
	if resp.StatusCode != http.StatusOK {
		// Enough of the body to say what happened, never all of it: an error
		// page from a proxy can be any size at all.
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 8*1024))
		asked := retryAfter(resp)
		_ = resp.Body.Close()
		return refused(resp.StatusCode, strings.TrimSpace(string(snippet)), asked)
	}

	frames := bufio.NewScanner(resp.Body)
	// The subscription backend restates a whole output item in one frame, so
	// the line budget is sized for an answer rather than for a delta.
	frames.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	w.resp, w.frames = resp, frames
	return nil
}

// fatal is an attempt that failed for a reason no further attempt improves on.
func fatal(class events.ErrorClass, err error) *providers.Refusal {
	return &providers.Refusal{Err: err, Class: class, Again: false}
}

// refused names why the API turned an attempt away, and whether another one
// could go differently. A zero status is an attempt that never reached a
// server, which has no status line to report.
func refused(status int, detail string, asked time.Duration) *providers.Refusal {
	class, recoverable := classify(status, detail)
	err := fmt.Errorf("openai: %s: %s", class, detail)
	if status != 0 {
		err = fmt.Errorf("openai: %s: the API answered %d: %s", class, status, detail)
	}
	return &providers.Refusal{Err: err, Class: class, Again: recoverable, After: asked}
}

// pump advances the connection by one frame.
//
// The lines between frames — the blank separators, the event names, the [DONE]
// sentinel — say nothing a Trace needs, so this reads until it has one data
// frame or the stream is over.
func (w *wire) Pump(d *providers.Driver) {
	for w.frames.Scan() {
		data, ok := strings.CutPrefix(strings.TrimSpace(w.frames.Text()), "data:")
		if !ok {
			continue
		}
		data = strings.TrimSpace(data)
		if data == "" || data == "[DONE]" {
			continue
		}

		var frame wireFrame
		if err := json.Unmarshal([]byte(data), &frame); err != nil {
			// A frame this client cannot read is not a frame it can act on.
			// The ones that matter are covered below; anything else the API
			// adds later must not break a turn that never needed it.
			continue
		}
		w.frame(d, frame)
		return
	}

	// The scanner is done: the connection ended without this turn reaching a
	// terminal frame, because a terminal frame ends the turn and the Driver
	// stops calling here. Either way the turn broke — there is no usage to
	// close the books with, and a claim of failure needs no caveat beside it.
	err := w.frames.Err()
	_ = w.Close()

	// Both endings are the connection failing rather than the API answering: one
	// read error, one body that stopped arriving before the turn was over.
	if err != nil {
		d.Break(events.ErrorUnreachable, fmt.Errorf("openai: %s: %w", events.ErrorUnreachable, err))
		return
	}
	d.Break(events.ErrorUnreachable, fmt.Errorf("openai: the stream ended before the response completed"))
}

// Close releases the connection.
func (w *wire) Close() error {
	if w.resp == nil {
		return nil
	}
	resp := w.resp
	w.resp, w.frames = nil, nil
	return resp.Body.Close()
}

// frame acts on one frame of the turn.
func (w *wire) frame(d *providers.Driver, frame wireFrame) {
	switch frame.Type {
	case "response.output_text.delta":
		if frame.Delta == "" {
			return
		}
		d.Say(events.Text{Block: frame.OutputIndex, Chunk: frame.Delta})
		w.count(frame.OutputIndex, len(frame.Delta))

	case "response.output_item.done":
		// The assembled item. The subscription backend omits every item from
		// its terminal frame, so this is where a turn's text is authoritative
		// — and a turn whose deltas already said all of it adds nothing here.
		var item wireItemDone
		if err := json.Unmarshal(frame.Item, &item); err != nil || item.Type != "message" {
			return
		}
		var whole strings.Builder
		for _, part := range item.Content {
			if part.Type == "output_text" {
				whole.WriteString(part.Text)
			}
		}
		if said := w.emitted[frame.OutputIndex]; whole.Len() > said {
			d.Say(events.Text{Block: frame.OutputIndex, Chunk: whole.String()[said:]})
			w.count(frame.OutputIndex, whole.Len()-said)
		}

	case "response.completed":
		var resp wireResponse
		_ = json.Unmarshal(frame.Response, &resp)
		spend(d.Spend(), resp.Usage)
		d.Complete()

	case "response.incomplete":
		var resp wireResponse
		_ = json.Unmarshal(frame.Response, &resp)
		// Said where it is learned. The frames of a truncated turn are the
		// frames of a whole one, so an answer that stopped mid-sentence would
		// otherwise reach the Trace looking finished.
		missing := "the end of the answer: the response is incomplete"
		if resp.IncompleteDetails != nil && resp.IncompleteDetails.Reason == "max_output_tokens" {
			missing = "the end of the answer, cut off at the model's token cap"
		}
		d.Say(events.Degraded{Missing: []string{missing}})
		spend(d.Spend(), resp.Usage)
		d.Complete()

	case "response.failed", "error":
		detail := frame.Message
		if frame.Error != nil && frame.Error.Message != "" {
			detail = frame.Error.Message
		}
		if detail == "" && len(frame.Response) > 0 {
			var resp wireResponse
			if err := json.Unmarshal(frame.Response, &resp); err == nil && resp.Error != nil {
				detail = resp.Error.Message
			}
		}
		if detail == "" {
			detail = "the API failed the response and said nothing further"
		}
		// The API reached the end of a turn it had accepted and then failed it.
		// What it says about why is prose, so there is nothing to place this
		// more precisely with, and Other is the honest answer rather than a
		// server error this client would be inferring.
		d.Break(events.ErrorOther, fmt.Errorf("openai: %s", detail))
	}
}

func (w *wire) count(block, n int) {
	if w.emitted == nil {
		w.emitted = map[int]int{}
	}
	w.emitted[block] += n
}

// spend reads what the terminal frame said the turn cost.
//
// The figures arrive once, so unlike Anthropic's two-frame books there is
// nothing to restate — but the nullability is the same, and it is the Spend's
// rule rather than this Provider's. What is this Provider's is knowing that
// this API says "did the API state this" by sending a null.
func spend(s *providers.Spend, u *wireUsage) {
	if u == nil {
		return
	}
	s.Input(stated(u.InputTokens))
	s.Output(stated(u.OutputTokens))
	if u.InputTokensDetails != nil {
		s.CacheRead(stated(u.InputTokensDetails.CachedTokens))
	}
	if u.OutputTokensDetails != nil {
		s.Reasoning(stated(u.OutputTokensDetails.ReasoningTokens))
	}
	// Cache writes stay absent: this API has no such figure.
}

// stated unwraps one nullable figure into the number and whether there was one.
func stated(n *int64) (int64, bool) {
	if n == nil {
		return 0, false
	}
	return *n, true
}

// wireFrame is one SSE data frame, holding whichever fields its type uses.
type wireFrame struct {
	Type        string          `json:"type"`
	OutputIndex int             `json:"output_index"`
	Delta       string          `json:"delta"`
	Item        json.RawMessage `json:"item"`
	Response    json.RawMessage `json:"response"`
	Message     string          `json:"message"`
	Error       *wireError      `json:"error"`
}

type wireItemDone struct {
	Type    string     `json:"type"`
	Content []wirePart `json:"content"`
}

type wireResponse struct {
	Status            string     `json:"status"`
	IncompleteDetails *wireWhy   `json:"incomplete_details"`
	Error             *wireError `json:"error"`
	Usage             *wireUsage `json:"usage"`
}

type wireWhy struct {
	Reason string `json:"reason"`
}

type wireError struct {
	Message string `json:"message"`
}

type wireUsage struct {
	InputTokens        *int64 `json:"input_tokens"`
	OutputTokens       *int64 `json:"output_tokens"`
	InputTokensDetails *struct {
		CachedTokens *int64 `json:"cached_tokens"`
	} `json:"input_tokens_details"`
	OutputTokensDetails *struct {
		ReasoningTokens *int64 `json:"reasoning_tokens"`
	} `json:"output_tokens_details"`
}
