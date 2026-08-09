package openai

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/providers/retry"
)

// retryAfter reads the delay a response asked for. There is no response to
// ask when the attempt never reached a server.
func retryAfter(resp *http.Response) time.Duration {
	if resp == nil {
		return 0
	}
	return retry.After(resp.Header)
}

// refusalDoc is the error body this API answers a refusal with, in the two
// fields that name what happened rather than describe it.
//
// Only these two are read. The message beside them is prose, and prose is what
// the class exists so that nothing has to parse.
type refusalDoc struct {
	Error struct {
		Type string `json:"type"`
		Code string `json:"code"`
	} `json:"error"`
}

// classify names why an attempt failed, and says whether another one could go
// differently.
//
// The document is read first, and the status line is the fallback for the proxy
// that answered with a page of HTML. It used to be the other way round — the
// status alone — on the grounds that this API describes a failure in prose
// rather than naming it. That is true of the message and false of the two
// fields beside it, and the difference matters most where the status line lies:
// `insufficient_quota` arrives as a 429, and read as the rate limit it looks
// like, it spends the whole retry policy to discover the account still has no
// credit.
//
// A zero status is a transport that never reached a server — a refused
// connection, a reset — and it is worth another attempt.
func classify(status int, body string) (events.ErrorClass, bool) {
	var doc refusalDoc
	// A body too long to have arrived whole does not parse, and falls through
	// to the status line rather than being guessed at from its first 8KB.
	if json.Unmarshal([]byte(body), &doc) == nil {
		switch {
		case named(doc, "model_not_found"):
			return events.ErrorNoSuchModel, false
		case named(doc, "insufficient_quota"), named(doc, "billing_not_active"):
			return events.ErrorBilling, false
		}
	}

	switch {
	case status == 0:
		return events.ErrorUnreachable, true
	case status == http.StatusTooManyRequests:
		return events.ErrorRateLimit, true
	case status == http.StatusUnauthorized, status == http.StatusForbidden:
		return events.ErrorAuthFailed, false
	case status == http.StatusNotFound:
		return events.ErrorNoSuchModel, false
	case status >= 500:
		return events.ErrorServerError, true
	default:
		return events.ErrorOther, false
	}
}

// named says whether the document calls the failure this, under either of the
// two fields it might put the name in. Which of the two carries it varies by
// endpoint and by year, and neither is worth telling apart.
func named(doc refusalDoc, what string) bool {
	return doc.Error.Code == what || doc.Error.Type == what
}
