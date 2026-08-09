package anthropic

import (
	"errors"
	"net/http"
	"time"

	sdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/providers/retry"
)

// retryAfter unwraps the response a delay was stated on. What the header says
// is read the one way both APIs state it; getting to the header is the part
// that is this vendor's, because the SDK carries it inside its error type.
func retryAfter(err error) time.Duration {
	var apiErr *sdk.Error
	if !errors.As(err, &apiErr) || apiErr.Response == nil {
		return 0
	}
	return retry.After(apiErr.Response.Header)
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
