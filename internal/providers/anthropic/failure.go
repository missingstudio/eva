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
func classify(err error) (events.ErrorClass, bool) {
	var apiErr *sdk.Error
	if !errors.As(err, &apiErr) {
		// No response at all: a refused connection, a reset, a stream that
		// stopped mid-frame. It is worth another attempt, and it is now worth
		// naming — a person told only that the turn failed cannot tell a
		// network they can fix from a vendor they can only wait out.
		return events.ErrorUnreachable, true
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
	case sdk.ErrorTypeNotFoundError:
		return events.ErrorNoSuchModel, false
	case sdk.ErrorTypeBillingError:
		return events.ErrorBilling, false
	case sdk.ErrorTypeInvalidRequestError:
		// A request the API would not accept. It is not retried, and there is
		// nothing more specific to call it: what is wrong with the request is
		// in the API's prose, and reading that prose to classify it is the
		// parser this whole set exists to avoid.
		return events.ErrorOther, false
	}

	// These three were one answer once — not retried, and called Other —
	// because retrying is the only thing they decide alike. What a person is
	// told is the other thing the class decides, and there a model that does
	// not exist, a balance that will not cover the turn, and a request the API
	// would not accept are three different mornings.

	switch code := apiErr.StatusCode; {
	case code == http.StatusTooManyRequests:
		return events.ErrorRateLimit, true
	case code == statusOverloaded:
		return events.ErrorOverloaded, true
	case code == http.StatusUnauthorized, code == http.StatusForbidden:
		return events.ErrorAuthFailed, false
	case code == http.StatusNotFound:
		return events.ErrorNoSuchModel, false
	case code >= 500:
		return events.ErrorServerError, true
	default:
		return events.ErrorOther, false
	}
}

// statusOverloaded is what the API answers when it has no capacity. It is not
// in net/http, because it is not in the RFC.
const statusOverloaded = 529
