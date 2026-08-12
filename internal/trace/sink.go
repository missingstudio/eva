package trace

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sync"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
)

// Sink is the append-only JSONL Trace: one Event per line.
type Sink struct {
	// mu serialises commits. Trace position is assigned under it, so two
	// goroutines cannot be handed the same one.
	mu   sync.Mutex
	file *os.File

	// next is the Trace position each Session will be given, counting from 1.
	// Zero on an Event means "not committed", so the sequence cannot start
	// there.
	next map[events.SessionID]uint64
}

// Sink is the implementation of the interface core declares. The assertion is
// here rather than in a test because it costs nothing and fails at build time.
var _ core.TraceSink = (*Sink)(nil)

func Open(path string) (*Sink, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("trace: make %s: %w", filepath.Dir(path), err)
	}

	next, err := reached(path)
	if err != nil {
		return nil, err
	}

	// O_APPEND so every write lands at the end of the file as it is at that
	// moment, rather than at an offset this process remembered.
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("trace: open %s: %w", path, err)
	}
	return &Sink{file: file, next: next}, nil
}

func reached(path string) (map[events.SessionID]uint64, error) {
	next := map[events.SessionID]uint64{}

	file, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return next, nil
	}
	if err != nil {
		return nil, fmt.Errorf("trace: read %s: %w", path, err)
	}
	defer func() { _ = file.Close() }()

	// A folded content block is one line and has no bound, so the reader grows
	// to the line rather than the line having to fit a buffer.
	lines := bufio.NewReader(file)
	for {
		line, readErr := lines.ReadString('\n')
		if len(line) > 0 {
			var mark struct {
				Seq     uint64           `json:"seq"`
				Session events.SessionID `json:"session"`
			}
			if json.Unmarshal([]byte(line), &mark) == nil && mark.Session != "" && mark.Seq >= next[mark.Session] {
				next[mark.Session] = mark.Seq + 1
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return next, nil
			}
			return nil, fmt.Errorf("trace: read %s: %w", path, readErr)
		}
	}
}

func (s *Sink) Append(ctx context.Context, group []events.Event) ([]events.Event, error) {
	if len(group) == 0 {
		return nil, nil
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	group = fold(group)

	s.mu.Lock()
	defer s.mu.Unlock()

	// A closed sink says so in its own words. Writing to the closed file
	// reports too, because the standard library refuses a nil receiver — but it
	// refuses it with "invalid argument", which tells a reader that something
	// about their group was wrong rather than that the Trace they are appending
	// to is no longer open.
	if s.file == nil {
		return nil, errors.New("trace: append to a closed Trace")
	}

	// Positions are taken from a copy of the counters, and only written back
	// once the group is durable. A rejected group must not leave a gap.
	taken := make(map[events.SessionID]uint64, len(group))
	committed := make([]events.Event, len(group))
	var buf bytes.Buffer

	for i, e := range group {
		seq, ok := taken[e.Session]
		if !ok {
			seq = s.next[e.Session]
			if seq == 0 {
				seq = 1
			}
		}
		taken[e.Session] = seq + 1

		e.Seq = seq
		line, err := json.Marshal(e)
		if err != nil {
			return nil, fmt.Errorf("trace: encode event %d of %d: %w", i+1, len(group), err)
		}
		buf.Write(line)
		buf.WriteByte('\n')
		committed[i] = e
	}

	n, err := s.file.Write(buf.Bytes())
	if err != nil {
		return nil, fmt.Errorf("trace: append: %w", err)
	}
	if n != buf.Len() {
		return nil, fmt.Errorf("trace: append wrote %d of %d bytes", n, buf.Len())
	}

	for session, seq := range taken {
		s.next[session] = seq
	}
	return committed, nil
}

func fold(group []events.Event) []events.Event {
	out := make([]events.Event, 0, len(group))

	for _, e := range group {
		text, isText := e.Payload.(events.Text)
		if !isText || len(out) == 0 {
			out = append(out, e)
			continue
		}

		prev := out[len(out)-1]
		prevText, prevIsText := prev.Payload.(events.Text)
		if !prevIsText || prevText.Block != text.Block || !mergeable(prev, e) {
			out = append(out, e)
			continue
		}

		prevText.Chunk += text.Chunk
		out[len(out)-1].Payload = prevText
	}

	return out
}

func mergeable(a, b events.Event) bool {
	if a.Version != b.Version || a.Session != b.Session || a.Run != b.Run {
		return false
	}
	if a.Tenant != b.Tenant || a.Actor != b.Actor {
		return false
	}
	switch {
	case a.Parent == nil && b.Parent == nil:
		return true
	case a.Parent == nil || b.Parent == nil:
		return false
	default:
		return *a.Parent == *b.Parent
	}
}

func (s *Sink) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.file == nil {
		return nil
	}
	err := s.file.Close()
	s.file = nil
	if err != nil {
		return fmt.Errorf("trace: close: %w", err)
	}
	return nil
}
