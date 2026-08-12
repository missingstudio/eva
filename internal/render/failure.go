package render

import "github.com/missingstudio/eva/internal/events"

// NoResponse is what a turn that did not answer leaves behind, when nothing
// classified why.
const NoResponse = "No response"

func Unanswered(class events.ErrorClass) string {
	switch class {
	case events.ErrorAuthFailed:
		return NoResponse + " — the credential was refused"
	case events.ErrorUnreachable:
		return NoResponse + " — the provider could not be reached"
	case events.ErrorRateLimit:
		return NoResponse + " — the rate limit was reached"
	case events.ErrorOverloaded:
		return NoResponse + " — the provider is overloaded"
	case events.ErrorServerError:
		return NoResponse + " — the provider failed the request"
	case events.ErrorNoSuchModel:
		return NoResponse + " — the provider does not serve this model"
	case events.ErrorBilling:
		return NoResponse + " — the provider will not bill this turn"
	default:
		return NoResponse
	}
}

// Remedy is a next step something checked, and never one it is guessing at.
type Remedy struct {
	Because string
	Do      string
}

func (r Remedy) Said() string {
	switch {
	case r.Because == "":
		return ""
	case r.Do == "":
		return r.Because
	default:
		return r.Because + "\n\n    " + r.Do
	}
}
