package harness

import (
	"github.com/missingstudio/eva/internal/providers"
	"github.com/missingstudio/eva/internal/trace"

	// The Providers a build can select, each registering itself as it loads.
	// They are imported here because this is the layer that opens one by name,
	// and a registry with nothing in it fails where the lookup happens.
	_ "github.com/missingstudio/eva/internal/providers/anthropic"
	_ "github.com/missingstudio/eva/internal/providers/openai"
)

// Selectable is what this build can be configured to use: the Harnesses that
// answer a prompt, the Providers they reach, and the sinks a Trace is written
// by. Each list is read from the registry that owns it, so a starter
// configuration cannot offer something this build does not have. The Providers
// are imported above; the Harnesses are imported by the layer that wires a Run,
// because one imports this layer and a cycle is not a choice.
type Selectable struct {
	Harnesses []string
	Providers []string
	Sinks     []string

	// DefaultSink is the sink a configuration that names none gets.
	DefaultSink string
}

func Choices() Selectable {
	return Selectable{
		Harnesses:   Names(),
		Providers:   providers.Names(),
		Sinks:       trace.Kinds(),
		DefaultSink: trace.JSONL,
	}
}
