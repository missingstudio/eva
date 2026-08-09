package anthropic

import (
	"context"
	"errors"
	"math/rand/v2"
	"net/http"
	"strconv"
	"time"

	sdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/missingstudio/eva/internal/events"
)

// Policy is how a refused attempt is retried.
type Policy struct {
	// Attempts is how many requests one turn may make in total, the first
	// included. One means a turn that never retries.
	Attempts int
	// Base is the wait before the second attempt. Each further attempt
	// doubles it.
	Base time.Duration
	// Cap is the longest this Provider waits before an attempt, whether the
	// wait was computed here or asked for by the server. A server asking for
	// longer than Cap ends the retries rather than parking the turn: a caller
	// that has been told the request failed can decide to come back, and a
	// caller stuck inside a Provider cannot decide anything.
	//
	// It is therefore sized for what a rate limit actually asks for rather
	// than for what the backoff reaches. A minute is what the API asks for
	// when it asks; a cap under that would turn the commonest recoverable
	// failure there is into a turn that never retried at all.
	Cap time.Duration
}

// DefaultPolicy is what a turn retries under when nothing chooses otherwise.
var DefaultPolicy = Policy{Attempts: 4, Base: 500 * time.Millisecond, Cap: time.Minute}

func (p Policy) orDefault() Policy {
	if p.Attempts <= 0 {
		p.Attempts = DefaultPolicy.Attempts
	}
	if p.Base <= 0 {
		p.Base = DefaultPolicy.Base
	}
	if p.Cap <= 0 {
		p.Cap = DefaultPolicy.Cap
	}
	return p
}

// wait reports how long to wait before the attempt after this one, and whether
// there should be one at all.
//
// The floor is exponential backoff with half of it jittered, so that a fleet of
// Workers that all failed at once does not come back at once.
//
// A server that said how long to wait raises that floor and never lowers it. It
// knows what it is recovering from and this client does not, so a longer ask is
// obeyed — and a shorter one, or the "0" a server sends when it is being
// polite, must not turn the retry into a second request with no pause in front
// of it.
func (p Policy) wait(attempt int, err error) (time.Duration, bool) {
	if attempt >= p.Attempts {
		return 0, false
	}

	backoff := p.Base << min(attempt-1, 32)
	if backoff <= 0 || backoff > p.Cap {
		backoff = p.Cap
	}
	// Half fixed, half jittered: a delay that can round to nothing is not a
	// delay, and a delay every caller picks identically is a thundering herd.
	wait := backoff/2 + time.Duration(rand.Int64N(int64(backoff/2)+1))

	if asked, ok := retryAfter(err); ok && asked > wait {
		if asked > p.Cap {
			return 0, false
		}
		wait = asked
	}
	return wait, true
}

// retryAfter reads the delay the server asked for, in seconds.
func retryAfter(err error) (time.Duration, bool) {
	var apiErr *sdk.Error
	if !errors.As(err, &apiErr) || apiErr.Response == nil {
		return 0, false
	}
	seconds, cerr := strconv.ParseFloat(apiErr.Response.Header.Get("retry-after"), 64)
	if cerr != nil || seconds < 0 {
		return 0, false
	}
	return time.Duration(seconds * float64(time.Second)), true
}

// classify names why an attempt failed, and says whether another one could go
// differently.
//
// The class comes from the error document when the API sent one, because that
// is the API saying what happened rather than this client inferring it from a
// status line. The status line is the fallback, for the proxy that returned a
// page of HTML with a 502 on it.
func classify(err error) (events.ErrorClass, bool) {
	var apiErr *sdk.Error
	if !errors.As(err, &apiErr) {
		// No response at all: a refused connection, a reset, a stream that
		// stopped mid-frame. The fixed set has no member for a transport that
		// never reached a server, and inventing one would make the set
		// disagree with the schema — so it is Other, and it is worth another
		// attempt, which is the part that matters.
		return events.ErrorOther, true
	}

	switch apiErr.Type() {
	case sdk.ErrorTypeRateLimitError:
		return events.ErrorRateLimit, true
	case sdk.ErrorTypeOverloadedError:
		return events.ErrorOverloaded, true
	case sdk.ErrorTypeAuthenticationError, sdk.ErrorTypePermissionError:
		return events.ErrorAuthFailed, false
	case sdk.ErrorTypeAPIError, sdk.ErrorTypeTimeoutError:
		return events.ErrorServerError, true
	case sdk.ErrorTypeInvalidRequestError, sdk.ErrorTypeNotFoundError, sdk.ErrorTypeBillingError:
		// A request the API would not accept, a model that does not exist, and
		// a balance that will not cover the turn are all the same shape: the
		// next attempt fails the same way and costs the same money.
		return events.ErrorOther, false
	}

	switch code := apiErr.StatusCode; {
	case code == http.StatusTooManyRequests:
		return events.ErrorRateLimit, true
	case code == statusOverloaded:
		return events.ErrorOverloaded, true
	case code == http.StatusUnauthorized, code == http.StatusForbidden:
		return events.ErrorAuthFailed, false
	case code >= 500:
		return events.ErrorServerError, true
	default:
		return events.ErrorOther, false
	}
}

// statusOverloaded is what the API answers when it has no capacity. It is not
// in net/http, because it is not in the RFC.
const statusOverloaded = 529

// sleep waits, and gives up when the caller does.
func sleep(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
