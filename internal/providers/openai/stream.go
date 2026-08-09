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
	"github.com/missingstudio/eva/internal/providers/retry"
)

// stream is one turn in progress.
//
// It is a queue and a state machine rather than a loop, because the caller
// pulls one payload at a time and the interesting things happen between pulls.
// A retry is yielded before the wait it caused, so the Trace holds the attempt
// at the moment it failed rather than however many seconds later the answer
// arrived.
type stream struct {
	provider *Provider
	body     []byte

	// resp and frames are the connection, once there is one.
	resp   *http.Response
	frames *bufio.Scanner

	// attempts is how many requests have been made, and owed is the wait the
	// last refusal asked for and the next attempt must take first.
	attempts int
	owed     time.Duration

	// queue is what has been produced and not yet handed over.
	queue []events.Payload
	// spent is what the API said the turn cost, when it said anything.
	spent spend

	// emitted counts the bytes of each output item already handed over as
	// Text. The subscription backend restates a whole item after streaming
	// its deltas, and a public-API turn may state one it never streamed — so
	// what the restatement adds is the part past this count, and a turn that
	// streamed everything adds nothing twice.
	emitted map[int]int

	// fatal is the failure to report once the queue is drained, and done says
	// the turn ended cleanly. Both wait for the queue, because a payload
	// already produced is part of the turn whichever way it ended.
	fatal error
	done  bool
}

var _ providers.Stream = (*stream)(nil)

// Next returns the next payload of the turn, or io.EOF when it is complete.
func (s *stream) Next(ctx context.Context) (events.Payload, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if len(s.queue) > 0 {
			payload := s.queue[0]
			s.queue = s.queue[1:]
			return payload, nil
		}
		switch {
		case s.fatal != nil:
			return nil, s.fatal
		case s.done:
			return nil, io.EOF
		case s.resp == nil:
			s.dial(ctx)
		default:
			s.pump()
		}
	}
}

// Close releases the turn, whether or not it ran to completion.
func (s *stream) Close() error {
	s.queue, s.done = nil, true
	if s.resp == nil {
		return nil
	}
	resp := s.resp
	s.resp, s.frames = nil, nil
	return resp.Body.Close()
}

// dial makes one attempt.
//
// The credential is resolved here, per attempt, rather than once for the
// turn: a subscription token renews under a long session, and the attempt
// made after a retry wait must send the token that is live then.
//
// A refusal that another attempt could survive queues a Retry and returns, so
// that the record of the attempt reaches the caller before the wait. The wait
// itself is taken at the top of the next call, which is what makes this one
// attempt per call rather than a loop nothing can observe from outside.
func (s *stream) dial(ctx context.Context) {
	if s.owed > 0 {
		wait := s.owed
		s.owed = 0
		if err := retry.Sleep(ctx, wait); err != nil {
			s.fatal = err
			return
		}
	}

	s.attempts++

	token, err := s.provider.credential()
	if err != nil {
		// Not a refusal from the API but a credential that cannot be had —
		// nothing about it improves on retry, and its message already names
		// the fix.
		s.fatal = err
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.provider.endpoint, bytes.NewReader(s.body))
	if err != nil {
		s.fatal = err
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Authorization", "Bearer "+token)
	if s.provider.subscription {
		account, err := accountID(token)
		if err != nil {
			s.fatal = err
			return
		}
		req.Header.Set("chatgpt-account-id", account)
		req.Header.Set("originator", "eva")
		req.Header.Set("OpenAI-Beta", "responses=experimental")
	}

	resp, err := s.provider.httpc.Do(req)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			s.fatal = ctxErr
			return
		}
		s.refused(0, err.Error(), 0)
		return
	}
	if resp.StatusCode != http.StatusOK {
		// Enough of the body to say what happened, never all of it: an error
		// page from a proxy can be any size at all.
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 8*1024))
		asked := retryAfter(resp)
		_ = resp.Body.Close()
		s.refused(resp.StatusCode, strings.TrimSpace(string(snippet)), asked)
		return
	}

	frames := bufio.NewScanner(resp.Body)
	// The subscription backend restates a whole output item in one frame, so
	// the line budget is sized for an answer rather than for a delta.
	frames.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	s.resp, s.frames = resp, frames
}

// refused closes the books on one failed attempt: another try when the
// failure class and the policy allow one, the turn's failure otherwise.
func (s *stream) refused(status int, detail string, asked time.Duration) {
	class, recoverable := classify(status)
	wait, again := s.provider.retry.Wait(s.attempts, asked)
	if !recoverable || !again {
		if status == 0 {
			s.fatal = fmt.Errorf("openai: %s: %s", class, detail)
		} else {
			s.fatal = fmt.Errorf("openai: %s: the API answered %d: %s", class, status, detail)
		}
		return
	}

	s.owed = wait
	s.queue = append(s.queue, events.Retry{
		Attempt:    s.attempts,
		Max:        s.provider.retry.Attempts,
		DelayMS:    int(wait.Milliseconds()),
		ErrorClass: class,
	})
}

// pump advances the connection by one frame.
//
// The lines between frames — the blank separators, the event names, the
// [DONE] sentinel — say nothing a Trace needs, so this reads until it has one
// data frame or the stream is over.
func (s *stream) pump() {
	for s.frames.Scan() {
		data, ok := strings.CutPrefix(strings.TrimSpace(s.frames.Text()), "data:")
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
		s.frame(frame)
		return
	}

	// The scanner is done: the connection ended without this turn reaching a
	// terminal frame, because a terminal frame sets done and Next stops
	// calling here. Either way the turn broke — there is no usage to close
	// the books with, and a claim of failure needs no caveat beside it.
	err := s.frames.Err()
	_ = s.resp.Body.Close()
	s.resp, s.frames = nil, nil

	if err != nil {
		s.fatal = fmt.Errorf("openai: %s: %w", events.ErrorOther, err)
		return
	}
	s.fatal = fmt.Errorf("openai: the stream ended before the response completed")
}

// frame acts on one frame of the turn.
func (s *stream) frame(frame wireFrame) {
	switch frame.Type {
	case "response.output_text.delta":
		if frame.Delta == "" {
			return
		}
		s.queue = append(s.queue, events.Text{Block: frame.OutputIndex, Chunk: frame.Delta})
		s.count(frame.OutputIndex, len(frame.Delta))

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
		if said := s.emittedOf(frame.OutputIndex); whole.Len() > said {
			s.queue = append(s.queue, events.Text{Block: frame.OutputIndex, Chunk: whole.String()[said:]})
			s.count(frame.OutputIndex, whole.Len()-said)
		}

	case "response.completed":
		var resp wireResponse
		_ = json.Unmarshal(frame.Response, &resp)
		s.spent.take(resp.Usage)
		s.end()

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
		s.queue = append(s.queue, events.Degraded{Missing: []string{missing}})
		s.spent.take(resp.Usage)
		s.end()

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
		s.fatal = fmt.Errorf("openai: %s", detail)
	}
}

// end closes the turn's books: what it cost, or that nobody said.
func (s *stream) end() {
	if s.spent.reported() {
		s.queue = append(s.queue, s.spent.usage())
	} else {
		// Silence is not the same as free. A Usage of all zeros would say
		// "none were used", which is a different claim from "we were never
		// told", so nothing is emitted — and the caveat is what stops the
		// absence reading as a turn nobody looked at.
		s.queue = append(s.queue, events.Degraded{
			Missing: []string{"what this turn cost: the provider reported no usage"},
		})
	}
	s.done = true
}

func (s *stream) count(block, n int) {
	if s.emitted == nil {
		s.emitted = map[int]int{}
	}
	s.emitted[block] += n
}

func (s *stream) emittedOf(block int) int { return s.emitted[block] }

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

// spend accumulates what the API says a turn cost. The figures arrive on the
// terminal frame, so unlike Anthropic's two-frame books there is nothing to
// overwrite — but the nullability is the same: a field the API did not state
// stays absent rather than becoming a zero.
type spend struct {
	input, output, cacheRead, reasoning *uint64
}

func (s *spend) reported() bool {
	return s.input != nil || s.output != nil || s.cacheRead != nil || s.reasoning != nil
}

func (s *spend) take(u *wireUsage) {
	if u == nil {
		return
	}
	record(u.InputTokens, &s.input)
	record(u.OutputTokens, &s.output)
	if u.InputTokensDetails != nil {
		record(u.InputTokensDetails.CachedTokens, &s.cacheRead)
	}
	if u.OutputTokensDetails != nil {
		record(u.OutputTokensDetails.ReasoningTokens, &s.reasoning)
	}
}

// record takes one figure. The API types these signed and a negative count is
// not a thing that exists, so one is read as none rather than as an enormous
// unsigned number.
func record(n *int64, into **uint64) {
	if n == nil {
		return
	}
	v := *n
	if v < 0 {
		v = 0
	}
	*into = events.Tokens(uint64(v))
}

// usage is the normalized payload.
//
// The reasoning figure is a subset of the output tokens rather than a count
// beside them — anything that sums the two has double-counted the thinking.
// Cache writes stay absent because this API has no such figure, and a dollar
// figure is never derived here: billing meters from provider-reported usage
// reconciled against invoices, and a made-up number would become a financial
// liability.
func (s *spend) usage() events.Usage {
	return events.Usage{
		InputTokens:     s.input,
		OutputTokens:    s.output,
		CacheReadTokens: s.cacheRead,
		ReasoningTokens: s.reasoning,
	}
}
