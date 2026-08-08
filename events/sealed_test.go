package events_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// The closed kind set is a guarantee, not a review habit. The only way to
// assert that is to compile a package that tries to break it, so the test
// writes one — a source file that fails to compile cannot live in this
// module — and builds it.
func TestAPayloadCannotBeDeclaredOutsideThisModule(t *testing.T) {
	out, err := buildOutside(t, `package main

import "github.com/missingstudio/eva/events"

// forged is what an extension or a foreign adapter would write to invent an
// Event kind of its own.
type forged struct{}

func (forged) isPayload() {}

func main() {
	var p events.Payload = forged{}
	_ = p
}
`)
	if err == nil {
		t.Fatal("a package outside events declared a Payload and compiled; the kind set is not sealed")
	}
	if !strings.Contains(out, "isPayload") {
		t.Fatalf("the build failed for some other reason:\n%s", out)
	}
}

// The one hole the compiler cannot close: a type that embeds Payload has
// isPayload promoted to it, and satisfies the interface without declaring
// anything. This test pins down what actually stops such a value — the codec
// refuses to encode it — so that nobody discovers the hole by finding a
// kindless record in a Trace.
func TestAnEmbeddedPayloadCompilesButCannotReachATrace(t *testing.T) {
	out, err := buildOutside(t, `package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/missingstudio/eva/events"
)

// forged embeds the interface rather than declaring the method.
type forged struct{ events.Payload }

func main() {
	var p events.Payload = forged{}
	if _, err := json.Marshal(events.Event{Version: events.SchemaVersion, Payload: p}); err != nil {
		fmt.Println("refused:", err)
		return
	}
	fmt.Println("encoded a forged payload")
	os.Exit(1)
}
`)
	if err != nil {
		t.Fatalf("embedding no longer compiles, so this test is describing a hole that is now closed:\n%s", out)
	}
	if !strings.Contains(out, "refused:") {
		t.Fatalf("the codec encoded a forged payload:\n%s", out)
	}
}

// buildOutside compiles and runs body as its own module against this one, and
// returns what the go tool and the program said.
func buildOutside(t *testing.T, body string) (string, error) {
	t.Helper()
	if testing.Short() {
		t.Skip("compiles a throwaway module")
	}

	schema, err := filepath.Abs(".")
	if err != nil {
		t.Fatalf("locate this module: %v", err)
	}

	dir := t.TempDir()
	write := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	write("go.mod", "module sealed\n\ngo 1.26\n\nrequire github.com/missingstudio/eva/events v0.0.0\n\nreplace github.com/missingstudio/eva/events => "+schema+"\n")
	write("main.go", body)

	// GOWORK=off so the throwaway module resolves through its own replace
	// directive rather than through this repository's workspace.
	cmd := exec.Command("go", "run", ".")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GOWORK=off", "GOFLAGS=-mod=mod")
	out, err := cmd.CombinedOutput()
	return string(out), err
}
