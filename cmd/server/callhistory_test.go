package main

import (
	"context"
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestCallHistoryPersistsAndUpdates(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	ctx := context.Background()
	if _, err := db.ExecContext(ctx, `CREATE TABLE sessions (id TEXT PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, callHistoryDDL); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO sessions (id) VALUES ('session-1')`); err != nil {
		t.Fatal(err)
	}

	owner := "sip:desk-phone"
	endedAt := int64(2000)
	record := CallRecord{
		SessionID: "session-1",
		CallID:    "call-1",
		Owner:     &owner,
		Direction: "incoming",
		Peer:      "628123456789",
		StartedAt: 1000,
		Status:    StatusEnded,
		EndedAt:   &endedAt,
		EndReason: "hangup",
	}
	store := &sessionStore{db: db}
	if err := store.appendCallHistory(ctx, record); err != nil {
		t.Fatal(err)
	}
	record.EndReason = "remote_hangup"
	if err := store.appendCallHistory(ctx, record); err != nil {
		t.Fatal(err)
	}

	rows, err := store.listCallHistory(ctx, "session-1", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(rows))
	}
	got := rows[0]
	if got.CallID != record.CallID || got.EndReason != "remote_hangup" || got.EndedAt == nil || *got.EndedAt != endedAt {
		t.Fatalf("unexpected persisted record: %+v", got)
	}
	if got.Owner == nil || *got.Owner != owner {
		t.Fatalf("owner was not persisted: %+v", got.Owner)
	}
}
