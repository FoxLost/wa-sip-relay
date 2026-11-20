package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	waLog "go.mau.fi/whatsmeow/util/log"
)

func TestWebUIPasswordAuthenticatesHeaderAndStreamingQuery(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	h := withAuth(ok, "integration-key", "panel-password", "", nil)

	for name, req := range map[string]*http.Request{
		"header": httptest.NewRequest(http.MethodGet, "/api/config", nil),
		"query":  httptest.NewRequest(http.MethodGet, "/api/events?auth=panel-password", nil),
		"wrong":  httptest.NewRequest(http.MethodGet, "/api/config?auth=wrong", nil),
	} {
		if name == "header" {
			req.Header.Set("X-API-Key", "panel-password")
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		want := http.StatusNoContent
		if name == "wrong" {
			want = http.StatusUnauthorized
		}
		if rec.Code != want {
			t.Errorf("%s authentication status = %d, want %d", name, rec.Code, want)
		}
	}
}

func TestSIPCredentialsCanBeCustomizedAndRemainUnique(t *testing.T) {
	ctx := context.Background()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	provider, err := newDBProvider(ctx, filepath.Join(t.TempDir(), "relay.db"), waLog.Noop, log)
	if err != nil {
		t.Fatal(err)
	}
	db, err := provider.openMainDB(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	store, err := newSessionStore(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	user1, pass1, err := store.insert(ctx, "s1", "First")
	if err != nil {
		t.Fatal(err)
	}
	user2, pass2, err := store.insert(ctx, "s2", "Second")
	if err != nil {
		t.Fatal(err)
	}

	sess1 := &Session{id: "s1", SIPUser: user1, SIPPass: pass1}
	sess2 := &Session{id: "s2", SIPUser: user2, SIPPass: pass2}
	mgr := &SessionManager{
		store:    store,
		sessions: map[string]*Session{"s1": sess1, "s2": sess2},
		order:    []string{"s1", "s2"},
	}
	gateway := &SIPGateway{registrations: map[string]*sipRegistration{
		user1: {sipUser: user1, sessionID: "s1"},
	}}
	srv := &server{sessions: mgr, sipGW: gateway}

	update := func(sessionID, user, password string) *httptest.ResponseRecorder {
		t.Helper()
		body, err := json.Marshal(map[string]string{"sip_user": user, "sip_pass": password})
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, "/api/sessions/"+sessionID+"/sip", bytes.NewReader(body))
		req.SetPathValue("sid", sessionID)
		rec := httptest.NewRecorder()
		srv.handleSIPConfig(rec, req)
		return rec
	}

	if rec := update("s1", "office_1001", "new-secret-1001"); rec.Code != http.StatusOK {
		t.Fatalf("custom credential update status = %d, body = %s", rec.Code, rec.Body.String())
	}
	gotUser, gotPass, _ := sess1.directSIPCredentials()
	if gotUser != "office_1001" || gotPass != "new-secret-1001" {
		t.Fatalf("memory credentials = %q/%q", gotUser, gotPass)
	}
	if len(gateway.registrations) != 0 {
		t.Fatalf("old registration was not removed: %+v", gateway.registrations)
	}
	rows, err := store.list(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if rows[0].SIPUser != "office_1001" || rows[0].SIPPass != "new-secret-1001" {
		t.Fatalf("persisted credentials = %q/%q", rows[0].SIPUser, rows[0].SIPPass)
	}

	if rec := update("s2", "office_1001", "another-secret"); rec.Code != http.StatusConflict {
		t.Fatalf("duplicate username status = %d, body = %s", rec.Code, rec.Body.String())
	}
	gotUser, gotPass, _ = sess2.directSIPCredentials()
	if gotUser != user2 || gotPass != pass2 {
		t.Fatalf("duplicate update changed memory credentials to %q/%q", gotUser, gotPass)
	}

	if rec := update("s2", "invalid user", "another-secret"); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid username status = %d, body = %s", rec.Code, rec.Body.String())
	}
}
