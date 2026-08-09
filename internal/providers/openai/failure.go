package openai

import (
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

// classify names why an attempt failed, and says whether another one could go
// differently.
//
// The status line is all there is to go on: this API's error document names
// what went wrong in prose, not in a type an error class could be read from.
// A zero status is a transport that never reached a server — a refused
// connection, a reset — which the fixed set has no member for, so it is Other
// and worth another attempt, which is the part that matters.
func classify(status int) (events.ErrorClass, bool) {
	switch {
	case status == 0:
		return events.ErrorOther, true
	case status == http.StatusTooManyRequests:
		return events.ErrorRateLimit, true
	case status == http.StatusUnauthorized, status == http.StatusForbidden:
		return events.ErrorAuthFailed, false
	case status >= 500:
		return events.ErrorServerError, true
	default:
		return events.ErrorOther, false
	}
}
