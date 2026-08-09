package retry_test

// What a Provider's own tests can show is that a refusal was retried. What
// they cannot show is how long the wait was, or why — the numbers are jittered
// and the rule that picks them is arithmetic. These are that rule's own tests:
// the band each attempt's wait falls in, the cap it stops at, and what a
// server's own ask does to both.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/missingstudio/eva/internal/providers/retry"
)

// policy is a Policy whose numbers are round, so an assertion about a wait
// reads as arithmetic rather than as a fixture.
var policy = retry.Policy{Attempts: 4, Base: time.Second, Cap: time.Minute}

// The wait is half fixed and half jittered: a delay that can round to nothing
// is not a delay, and a delay every caller picks identically is a fleet coming
// back in step. So each attempt's wait lands inside a band rather than on a
// number, and the band doubles with the attempt.
func TestEachWaitLandsInTheHalfJitteredBandForItsAttempt(t *testing.T) {
	for _, tc := range []struct {
		attempt        int
		floor, backoff time.Duration
	}{
		{attempt: 1, floor: 500 * time.Millisecond, backoff: time.Second},
		{attempt: 2, floor: time.Second, backoff: 2 * time.Second},
		{attempt: 3, floor: 2 * time.Second, backoff: 4 * time.Second},
	} {
		// Many draws, because the jitter is what is being asserted about.
		for i := 0; i < 200; i++ {
			got, again := policy.Wait(tc.attempt, 0)
			if !again {
				t.Fatalf("attempt %d of %d refused a retry", tc.attempt, policy.Attempts)
			}
			if got < tc.floor || got > tc.backoff {
				t.Fatalf("attempt %d waited %v, want the band [%v, %v]", tc.attempt, got, tc.floor, tc.backoff)
			}
		}
	}
}

// Attempts are counted from one, because the first request is an attempt. A
// caller that counts from zero is asking about a request that never happened,
// and the answer is no rather than a panic on a negative shift.
func TestAnAttemptBeforeTheFirstIsRefusedRatherThanFatal(t *testing.T) {
	if _, again := policy.Wait(0, 0); again {
		t.Error("a retry was offered before the first attempt was made")
	}
	if _, again := policy.Wait(-1, 0); again {
		t.Error("a retry was offered for a negative attempt")
	}
}

func TestTheLastAttemptIsNotRetried(t *testing.T) {
	if _, again := policy.Wait(policy.Attempts, 0); again {
		t.Errorf("attempt %d of %d was retried — a turn would make more requests than it may", policy.Attempts, policy.Attempts)
	}
	if _, again := policy.Wait(policy.Attempts+1, 0); again {
		t.Error("an attempt past the policy's own count was retried")
	}
}

// The cap is the longest this waits before an attempt, so an exponent that
// runs past it stops there rather than growing.
func TestTheBackoffStopsGrowingAtTheCap(t *testing.T) {
	capped := retry.Policy{Attempts: 40, Base: time.Second, Cap: 4 * time.Second}
	for attempt := 1; attempt < 20; attempt++ {
		got, again := capped.Wait(attempt, 0)
		if !again {
			continue
		}
		if got > capped.Cap {
			t.Fatalf("attempt %d waited %v, past the cap of %v", attempt, got, capped.Cap)
		}
	}
}

// A server that says how long to wait knows what it is recovering from and
// this client does not, so a longer ask is obeyed.
func TestAServerAskRaisesTheWait(t *testing.T) {
	asked := 30 * time.Second
	got, again := policy.Wait(1, asked)
	if !again {
		t.Fatal("a first attempt was not retried")
	}
	if got != asked {
		t.Errorf("waited %v, want the %v the server asked for", got, asked)
	}
}

// ...and never lowers it. The "0" a server sends when it is being polite must
// not turn the retry into a second request with no pause in front of it.
func TestAShortServerAskNeverLowersTheWait(t *testing.T) {
	for i := 0; i < 200; i++ {
		got, again := policy.Wait(3, time.Nanosecond)
		if !again {
			t.Fatal("attempt 3 of 4 was not retried")
		}
		if got < 2*time.Second {
			t.Fatalf("waited %v after a one-nanosecond ask, below the backoff's own floor", got)
		}
	}
}

// A server asking for longer than the cap ends the retries rather than parking
// the turn: a caller told the request failed can decide to come back, and a
// caller stuck inside a Provider cannot decide anything.
func TestAnAskBeyondTheCapEndsTheRetries(t *testing.T) {
	if _, again := policy.Wait(1, policy.Cap+time.Second); again {
		t.Error("a wait longer than the cap was accepted — the turn would park inside the Provider")
	}
}

func TestAZeroPolicyTakesTheDefaults(t *testing.T) {
	got := retry.Policy{}.OrDefault()
	if got != retry.Default {
		t.Errorf("a Policy that chose nothing is %+v, want the default %+v", got, retry.Default)
	}

	// One field chosen is one field kept: filling in the rest must not
	// overwrite what a caller did say.
	partial := retry.Policy{Attempts: 9}.OrDefault()
	if partial.Attempts != 9 {
		t.Errorf("attempts = %d, want the 9 the caller chose", partial.Attempts)
	}
	if partial.Base != retry.Default.Base || partial.Cap != retry.Default.Cap {
		t.Errorf("got %+v, want the default base and cap beside the chosen attempts", partial)
	}
}

func TestSleepGivesUpWhenTheCallerDoes(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	start := time.Now()
	err := retry.Sleep(ctx, time.Hour)
	if !errors.Is(err, context.Canceled) {
		t.Errorf("sleeping under a cancelled caller returned %v, want the cancellation", err)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Errorf("the sleep took %v to notice a cancelled caller", elapsed)
	}
}

func TestSleepWaits(t *testing.T) {
	start := time.Now()
	if err := retry.Sleep(context.Background(), 10*time.Millisecond); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(start); elapsed < 10*time.Millisecond {
		t.Errorf("the sleep returned after %v, short of the 10ms asked for", elapsed)
	}
}
