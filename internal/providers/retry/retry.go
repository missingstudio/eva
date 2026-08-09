// Package retry holds how a refused attempt is retried: the wait before the
// next one, and whether there should be one at all.
//
// It is a leaf under providers because two Providers need the same rule and
// neither may import the other. What is here is the arithmetic — the exponent,
// the jitter, the cap, and what a server's own ask does to them — and the
// reading of the one header a server states that ask in.
//
// Naming why an attempt failed stays with each Provider. That is the part that
// genuinely differs: one reads a typed error document from a vendor's SDK, the
// other a status line, and a rule here that could read either would be a rule
// with an opinion about which.
package retry

import (
	"context"
	"math/rand/v2"
	"net/http"
	"strconv"
	"time"
)

// Policy is how a refused attempt is retried.
type Policy struct {
	// Attempts is how many requests one turn may make in total, the first
	// included. One means a turn that never retries.
	Attempts int
	// Base is the wait before the second attempt. Each further attempt
	// doubles it.
	Base time.Duration
	// Cap is the longest this waits before an attempt, whether the wait was
	// computed here or asked for by the server. A server asking for longer
	// than Cap ends the retries rather than parking the turn: a caller that
	// has been told the request failed can decide to come back, and a caller
	// stuck inside a Provider cannot decide anything.
	//
	// It is therefore sized for what a rate limit actually asks for rather
	// than for what the backoff reaches. A minute is what an API asks for when
	// it asks; a cap under that would turn the commonest recoverable failure
	// there is into a turn that never retried at all.
	Cap time.Duration
}

// Default is what a turn retries under when nothing chooses otherwise.
var Default = Policy{Attempts: 4, Base: 500 * time.Millisecond, Cap: time.Minute}

// OrDefault fills in what a caller left at zero, and keeps what it chose.
func (p Policy) OrDefault() Policy {
	if p.Attempts <= 0 {
		p.Attempts = Default.Attempts
	}
	if p.Base <= 0 {
		p.Base = Default.Base
	}
	if p.Cap <= 0 {
		p.Cap = Default.Cap
	}
	return p
}

// Wait reports how long to wait before the attempt after this one, and whether
// there should be one at all. asked is the delay the server itself asked for,
// and is zero when it asked for nothing.
//
// The floor is exponential backoff with half of it jittered, so that a fleet of
// Workers that all failed at once does not come back at once.
//
// A server that said how long to wait raises that floor and never lowers it. It
// knows what it is recovering from and this client does not, so a longer ask is
// obeyed — and a shorter one, or the "0" a server sends when it is being
// polite, must not turn the retry into a second request with no pause in front
// of it.
func (p Policy) Wait(attempt int, asked time.Duration) (time.Duration, bool) {
	// Attempts are counted from one, because the first request is an attempt.
	// Nothing precedes it, so there is nothing to wait before.
	if attempt < 1 || attempt >= p.Attempts {
		return 0, false
	}

	backoff := p.Base << min(attempt-1, 32)
	if backoff <= 0 || backoff > p.Cap {
		backoff = p.Cap
	}
	// Half fixed, half jittered: a delay that can round to nothing is not a
	// delay, and a delay every caller picks identically is a thundering herd.
	wait := backoff/2 + time.Duration(rand.Int64N(int64(backoff/2)+1))

	if asked > wait {
		if asked > p.Cap {
			return 0, false
		}
		wait = asked
	}
	return wait, true
}

// After reads the delay a server asked for out of the one header both APIs
// state it in. Zero is a server that asked for nothing, which is also what an
// unparseable or negative ask is worth: a delay that cannot be believed is not
// a shorter delay, and Wait treats a zero as no ask at all.
//
// Reaching the header is each Provider's own — one unwraps it from a vendor's
// error type, the other reads it off a response — and what is behind it is the
// same seconds either way.
func After(h http.Header) time.Duration {
	seconds, err := strconv.ParseFloat(h.Get("retry-after"), 64)
	if err != nil || seconds < 0 {
		return 0
	}
	return time.Duration(seconds * float64(time.Second))
}

// Sleep waits, and gives up when the caller does.
func Sleep(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
