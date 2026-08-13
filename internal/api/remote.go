package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/missingstudio/eva/internal/core"
)

// maxLine caps one line of the watch stream. A Text record holds a whole
// content block, so the cap is generous; what it stops is a stream that is not
// what it claims to be filling this process's memory.
const maxLine = 8 << 20

// Remote is the Session API spoken over the wire to a Server. It is the same
// API the Direct Transport carries, and the only difference is the distance.
//
// The client is the caller's, so a timeout, a proxy, and a credential are
// decided where those are known. A nil one is the default client.
func Remote(address string, client *http.Client) Session {
	if client == nil {
		client = http.DefaultClient
	}
	return &remote{address: strings.TrimRight(address, "/"), client: client}
}

type remote struct {
	address string
	client  *http.Client
}

var _ Session = (*remote)(nil)

func (r *remote) Answer(ctx context.Context, intent string) (core.Outcome, error) {
	var reply answerReply
	if err := r.call(ctx, http.MethodPost, pathAnswer, answerRequest{Intent: intent}, &reply); err != nil {
		return core.Outcome{}, err
	}

	outcome := core.Outcome{Result: reply.Result, Summary: reply.Summary, Class: reply.Class}
	if reply.Error != "" {
		// The record failed on the far side. What crosses is its account of
		// itself: an error's identity does not survive a wire, and pretending
		// otherwise is how a client comes to match on a sentence.
		return outcome, errors.New(reply.Error)
	}
	return outcome, nil
}

func (r *remote) Model(ctx context.Context) (string, error) {
	var reply modelReply
	if err := r.call(ctx, http.MethodGet, pathModel, nil, &reply); err != nil {
		return "", err
	}
	return reply.Model, nil
}

func (r *remote) UseModel(ctx context.Context, model string) error {
	return r.call(ctx, http.MethodPut, pathModel, modelRequest{Model: model}, nil)
}

func (r *remote) Clear(ctx context.Context) error {
	return r.call(ctx, http.MethodPost, pathClear, nil, nil)
}

// Watch opens the stream and returns once the Server says the watcher is
// attached, so a turn started next is one this stream carries. What follows is
// read until ctx ends.
func (r *remote) Watch(ctx context.Context, sub core.Subscriber, arriving func(chunk string)) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, r.address+pathWatch, nil)
	if err != nil {
		return fmt.Errorf("api: reach %s: %w", pathWatch, err)
	}

	response, err := r.client.Do(request)
	if err != nil {
		return fmt.Errorf("api: reach %s: %w", pathWatch, err)
	}
	if response.StatusCode != http.StatusOK {
		defer func() { _ = response.Body.Close() }()
		return refusal(response)
	}

	lines := bufio.NewScanner(response.Body)
	lines.Buffer(nil, maxLine)
	if !lines.Scan() {
		_ = response.Body.Close()
		return fmt.Errorf("api: %s said nothing, so nothing is watching", pathWatch)
	}
	var first frame
	if err := json.Unmarshal(lines.Bytes(), &first); err != nil || !first.Ready {
		_ = response.Body.Close()
		return fmt.Errorf("api: %s did not open with a watcher attached", pathWatch)
	}

	go r.follow(ctx, response.Body, lines, sub, arriving)
	return nil
}

// follow reads the stream to its end. The rule it holds is the Cursor's own:
// only a durable Event moves one, so a record is what was committed and a chunk
// is a turn still arriving.
func (r *remote) follow(ctx context.Context, body io.ReadCloser, lines *bufio.Scanner, sub core.Subscriber, arriving func(chunk string)) {
	defer func() { _ = body.Close() }()

	for lines.Scan() {
		var next frame
		if err := json.Unmarshal(lines.Bytes(), &next); err != nil {
			// A line this client cannot read is the stream ending as far as it
			// is concerned. Every record is on the far side's disk, and a client
			// that reattaches is told what it missed.
			return
		}

		if next.Event == nil {
			if arriving != nil {
				arriving(next.Chunk)
			}
			continue
		}
		if sub == nil {
			continue
		}
		if err := sub.Committed(ctx, *next.Event); err != nil {
			// A projection that broke stops itself, here as in one process.
			return
		}
	}
}

// call makes one request and reads one reply. A nil body sends none, and a nil
// reply reads none.
func (r *remote) call(ctx context.Context, method, path string, body, reply any) error {
	var payload io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("api: %s: %w", path, err)
		}
		payload = bytes.NewReader(encoded)
	}

	request, err := http.NewRequestWithContext(ctx, method, r.address+path, payload)
	if err != nil {
		return fmt.Errorf("api: reach %s: %w", path, err)
	}
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}

	response, err := r.client.Do(request)
	if err != nil {
		return fmt.Errorf("api: reach %s: %w", path, err)
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode < 200 || response.StatusCode > 299 {
		return refusal(response)
	}
	if reply == nil {
		return nil
	}
	if err := json.NewDecoder(response.Body).Decode(reply); err != nil {
		return fmt.Errorf("api: %s answered with something this client cannot read: %w", path, err)
	}
	return nil
}

// refusal turns what a Server would not serve into an error in the Server's own
// words, and says the status when it offered none.
func refusal(response *http.Response) error {
	var said failure
	if err := json.NewDecoder(io.LimitReader(response.Body, maxLine)).Decode(&said); err == nil && said.Error != "" {
		return fmt.Errorf("api: %s: %s", response.Request.URL.Path, said.Error)
	}
	return fmt.Errorf("api: %s: the server answered %s", response.Request.URL.Path, response.Status)
}
