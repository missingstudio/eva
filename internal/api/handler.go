package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
)

// Handler is the Server's half of the Remote Transport: the Session API, over
// HTTP, against one Session. It listens on nothing and authenticates nobody.
//
// It serves the API rather than an implementation of it, so what a Server holds
// Sessions with is the Server's business.
func Handler(session Session) http.Handler {
	mux := http.NewServeMux()
	s := &server{session: session}

	mux.HandleFunc("POST "+pathAnswer, s.answer)
	mux.HandleFunc("GET "+pathWatch, s.watch)
	mux.HandleFunc("GET "+pathModel, s.model)
	mux.HandleFunc("PUT "+pathModel, s.useModel)
	mux.HandleFunc("POST "+pathClear, s.clear)
	return mux
}

type server struct{ session Session }

func (s *server) answer(w http.ResponseWriter, r *http.Request) {
	var req answerRequest
	if err := decodeBody(r, &req); err != nil {
		refuse(w, http.StatusBadRequest, err)
		return
	}

	outcome, err := s.session.Answer(r.Context(), req.Intent)
	reply := answerReply{Result: outcome.Result, Summary: outcome.Summary, Class: outcome.Class}
	if err != nil {
		reply.Error = err.Error()
	}
	send(w, http.StatusOK, reply)
}

func (s *server) model(w http.ResponseWriter, r *http.Request) {
	model, err := s.session.Model(r.Context())
	if err != nil {
		// The request was understood and the Session could not answer it, which
		// is this Server's failure to report rather than the client's to fix.
		refuse(w, http.StatusInternalServerError, err)
		return
	}
	send(w, http.StatusOK, modelReply{Model: model})
}

func (s *server) useModel(w http.ResponseWriter, r *http.Request) {
	var req modelRequest
	if err := decodeBody(r, &req); err != nil {
		refuse(w, http.StatusBadRequest, err)
		return
	}
	if err := s.session.UseModel(r.Context(), req.Model); err != nil {
		refuse(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) clear(w http.ResponseWriter, r *http.Request) {
	if err := s.session.Clear(r.Context()); err != nil {
		refuse(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// watch holds the connection open and writes one line per thing that happened.
// The Run closing does not end it: a Frontend watches a Session, and a Session
// outlives every Run of it.
func (s *server) watch(w http.ResponseWriter, r *http.Request) {
	flusher, streamable := w.(http.Flusher)
	if !streamable {
		refuse(w, http.StatusInternalServerError, errors.New("this server cannot stream"))
		return
	}

	ctx, stop := context.WithCancel(r.Context())
	defer stop()

	pending := newBacklog(watchBuffer, stop)
	err := s.session.Watch(ctx,
		core.SubscriberFunc(func(_ context.Context, e events.Event) error {
			return pending.record(frame{Event: &e})
		}),
		pending.chunk,
	)
	if err != nil {
		refuse(w, http.StatusInternalServerError, err)
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)

	encoder := json.NewEncoder(w)
	// The watcher is attached before this is written, so a client that has read
	// it knows a turn it starts next is one this stream will carry.
	if err := encoder.Encode(frame{Ready: true}); err != nil {
		return
	}
	flusher.Flush()

	for {
		select {
		case <-ctx.Done():
			return
		case <-pending.done:
			return
		case f := <-pending.frames:
			if err := encoder.Encode(f); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func decodeBody(r *http.Request, into any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(into); err != nil {
		return fmt.Errorf("this request is not one %s takes: %w", r.URL.Path, err)
	}
	return nil
}

func send(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	// The status line is already out, so a failure to write the body is a
	// connection that ended rather than a reply this server can change.
	_ = json.NewEncoder(w).Encode(body)
}

func refuse(w http.ResponseWriter, status int, err error) {
	send(w, status, failure{Error: err.Error()})
}
