package trace_test

import (
	"testing"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/trace/tracetest"
)

// The TraceSink contract, driven through the suite every sink shares.
func TestTheJSONLSinkKeepsTheTraceSinkContract(t *testing.T) {
	tracetest.Run(t, tracetest.Contract{
		Open: func(t *testing.T) (core.TraceSink, tracetest.Records) {
			sink, path := open(t)
			return sink, func(t *testing.T) []events.Event { return readTrace(t, path) }
		},
		// A record with no schema version cannot be migrated on read, so the
		// encoding refuses it — and this sink stores nothing it cannot encode.
		Refuses: func(e events.Event) events.Event {
			e.Version = 0
			return e
		},
	})
}
