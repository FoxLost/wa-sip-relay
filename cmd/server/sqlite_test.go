package main

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	waLog "go.mau.fi/whatsmeow/util/log"
)

func TestSQLiteProviderPersistsRelayAndWhatsAppSchemas(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "relay.db")
	log := slog.New(slog.NewTextHandler(io.Discard, nil))

	provider, err := newDBProvider(ctx, path, waLog.Noop, log)
	if err != nil {
		t.Fatal(err)
	}
	mainDB, err := provider.openMainDB(ctx)
	if err != nil {
		t.Fatal(err)
	}
	store, err := newSessionStore(ctx, mainDB)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.insert(ctx, "session-1", "WhatsApp Relay"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.insert(ctx, "session-2", "Second account"); err == nil {
		t.Fatal("second WhatsApp account was accepted")
	}
	message := storedMessage{
		ChatJID: "628123456789@s.whatsapp.net", SenderJID: "628123456789@s.whatsapp.net",
		MsgID: "message-1", Timestamp: 1000, Type: "text", Body: "SQLite relay",
	}
	if err := store.saveMessage(ctx, "session-1", message); err != nil {
		t.Fatal(err)
	}
	messages, err := store.listMessagesIn(ctx, "session-1", []string{message.ChatJID}, 10, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || messages[0].MsgID != message.MsgID {
		t.Fatalf("stored messages = %+v, want message-1", messages)
	}
	results, err := store.searchMessages(ctx, "session-1", "relay", "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 {
		t.Fatalf("search results = %d, want 1", len(results))
	}
	if _, err := store.enqueueScheduled(ctx, "session-1", message.ChatJID, []byte(`{}`), 2000, 1000); err != nil {
		t.Fatal(err)
	}
	if err := store.enqueueOutbox(ctx, "session-1", "source-1", []byte(`{}`), 2000, 1000); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.createMCPKey(ctx, "session-1", "test", true); err != nil {
		t.Fatal(err)
	}

	_, waDB, err := provider.openSessionContainer(ctx, "session-1")
	if err != nil {
		t.Fatal(err)
	}
	var whatsAppSchema int
	if err := waDB.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'whatsmeow_device'`).Scan(&whatsAppSchema); err != nil {
		t.Fatal(err)
	}
	if whatsAppSchema != 1 {
		t.Fatalf("WhatsApp schema count = %d, want 1", whatsAppSchema)
	}
	var foreignKeys int
	if err := waDB.QueryRowContext(ctx, `PRAGMA foreign_keys`).Scan(&foreignKeys); err != nil {
		t.Fatal(err)
	}
	if foreignKeys != 1 {
		t.Fatalf("foreign_keys = %d, want 1", foreignKeys)
	}
	if err := waDB.Close(); err != nil {
		t.Fatal(err)
	}
	if err := mainDB.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := newDBProvider(ctx, path, waLog.Noop, log)
	if err != nil {
		t.Fatal(err)
	}
	reopenedDB, err := reopened.openMainDB(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer reopenedDB.Close()
	reopenedStore, err := newSessionStore(ctx, reopenedDB)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := reopenedStore.list(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].ID != "session-1" {
		t.Fatalf("restored sessions = %+v, want session-1", rows)
	}
}
