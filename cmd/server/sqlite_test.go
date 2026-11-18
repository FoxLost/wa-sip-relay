package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"

	"go.mau.fi/whatsmeow/types"
	waLog "go.mau.fi/whatsmeow/util/log"
)

func TestSQLiteProviderPersistsMultipleRelayAndWhatsAppAccounts(t *testing.T) {
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
	if _, _, err := store.insert(ctx, "session-1", "First account"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.insert(ctx, "session-2", "Second account"); err != nil {
		t.Fatalf("second WhatsApp account was rejected: %v", err)
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

	waContainer, waDB, err := provider.openSessionContainer(ctx, "session-1")
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
	zero32 := make([]byte, 32)
	zero64 := make([]byte, 64)
	for _, rawJID := range []string{"628111111111:1@s.whatsapp.net", "628222222222:2@s.whatsapp.net"} {
		if _, err := waDB.ExecContext(ctx, `INSERT INTO whatsmeow_device (
			jid, registration_id, noise_key, identity_key, signed_pre_key,
			signed_pre_key_id, signed_pre_key_sig, adv_key, adv_details,
			adv_account_sig, adv_account_sig_key, adv_device_sig
		) VALUES ($1, 1, $2, $2, $2, 1, $3, $2, $2, $3, $2, $3)`,
			rawJID, zero32, zero64,
		); err != nil {
			t.Fatalf("insert device %s: %v", rawJID, err)
		}
		jid, err := types.ParseJID(rawJID)
		if err != nil {
			t.Fatal(err)
		}
		got, err := waContainer.GetDevice(ctx, jid)
		if err != nil || got == nil || got.ID == nil || got.ID.String() != jid.String() {
			t.Fatalf("get exact device %s: device=%v err=%v", rawJID, got, err)
		}
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
	if len(rows) != 2 || rows[0].ID != "session-1" || rows[1].ID != "session-2" {
		t.Fatalf("restored sessions = %+v, want session-1 and session-2", rows)
	}
}

func TestSQLiteMigratesSingletonSessionSchema(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "legacy.db")
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	provider, err := newDBProvider(ctx, path, waLog.Noop, log)
	if err != nil {
		t.Fatal(err)
	}
	db, err := provider.openMainDB(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	legacyDDL := strings.Replace(
		sessionTableDDL("sessions"),
		"id TEXT PRIMARY KEY,",
		"id TEXT PRIMARY KEY,\n\t\tsingleton INTEGER NOT NULL DEFAULT 1 CHECK (singleton = 1) UNIQUE,",
		1,
	)
	if _, err := db.ExecContext(ctx, legacyDDL); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx,
		`INSERT INTO sessions (id, singleton, name, jid, sip_user, sip_pass)
		 VALUES ('legacy', 1, 'Existing account', '628111111111:1@s.whatsapp.net', 'wa_legacy', 'secret')`,
	); err != nil {
		t.Fatal(err)
	}

	store, err := newSessionStore(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := store.list(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].ID != "legacy" || rows[0].SIPUser != "wa_legacy" {
		t.Fatalf("legacy account was not preserved: %+v", rows)
	}
	if _, _, err := store.insert(ctx, "second", "Second account"); err != nil {
		t.Fatalf("second account after migration: %v", err)
	}
	exists, singleton, err := sessionTableHasColumn(ctx, db, "singleton")
	if err != nil {
		t.Fatal(err)
	}
	if !exists || singleton {
		t.Fatalf("migrated sessions table exists=%v singleton=%v", exists, singleton)
	}
	var version int
	if err := db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != sessionSchemaVersion {
		t.Fatalf("schema version = %d, want %d", version, sessionSchemaVersion)
	}
}

func TestSessionManagerRejectsAccountAboveConfiguredLimit(t *testing.T) {
	mgr := &SessionManager{
		maxAccounts: 2,
		sessions: map[string]*Session{
			"one": {id: "one"},
			"two": {id: "two"},
		},
	}
	if _, err := mgr.Create("Third account"); !errors.Is(err, errAccountLimitReached) {
		t.Fatalf("Create() error = %v, want account limit error", err)
	}
}
