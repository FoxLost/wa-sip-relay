package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

type sessionRow struct {
	ID                  string
	Name                string
	JID                 string
	LastJID             string
	Webhook             string
	WebhookSecret       string
	WebhookEvents       string // CSV dos tipos de evento; vazio = todos
	WebhookIgnoreGroups bool   // não entrega eventos de grupo no webhook
	Webhooks            string // JSON []WebhookTarget; vazio = só o webhook legado (colunas acima)
	Chatwoot            string
	Recording           bool
	Proxy               string
	SIPUser             string
	SIPPass             string
	// Modelo 2 (UAC): esta sessão se REGISTRA num PBX externo.
	SIPExtEnabled bool
	SIPExtHost    string
	SIPExtPort    int
	SIPExtUser    string
	SIPExtPass    string
	SIPExtDest    string // ramal/número no PBX p/ tocar chamadas recebidas do WhatsApp (opcional)
	SIPExtProxy   string // outbound proxy (host[:porta]); vazio = usa host
	SIPExtOpts    string // JSON de sipAgentOpts (modo do INVITE entrante)
}

type sessionStore struct{ db *sql.DB }

const sessionSchemaVersion = 1

func sessionTableDDL(name string) string {
	return fmt.Sprintf(`CREATE TABLE %s (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		jid TEXT,
		last_jid TEXT,
		webhook TEXT,
		webhook_secret TEXT,
		webhook_events TEXT,
		webhook_ignore_groups INTEGER NOT NULL DEFAULT 0,
		webhooks TEXT,
		chatwoot TEXT,
		recording INTEGER NOT NULL DEFAULT 0,
		proxy TEXT,
		sip_user TEXT,
		sip_pass TEXT,
		sip_ext_enabled INTEGER NOT NULL DEFAULT 0,
		sip_ext_host TEXT,
		sip_ext_port INTEGER NOT NULL DEFAULT 5060,
		sip_ext_user TEXT,
		sip_ext_pass TEXT,
		sip_ext_dest TEXT,
		sip_ext_proxy TEXT,
		sip_ext_opts TEXT,
		created_at INTEGER NOT NULL DEFAULT (unixepoch())
	)`, name)
}

const sessionColumns = `id, name, jid, last_jid, webhook, webhook_secret,
	webhook_events, webhook_ignore_groups, webhooks, chatwoot, recording, proxy,
	sip_user, sip_pass, sip_ext_enabled, sip_ext_host, sip_ext_port, sip_ext_user,
	sip_ext_pass, sip_ext_dest, sip_ext_proxy, sip_ext_opts, created_at`

func sessionTableHasColumn(ctx context.Context, db *sql.DB, column string) (tableExists, found bool, err error) {
	rows, err := db.QueryContext(ctx, `PRAGMA table_info(sessions)`)
	if err != nil {
		return false, false, err
	}
	defer rows.Close()
	for rows.Next() {
		tableExists = true
		var cid, notNull, primaryKey int
		var name, dataType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &primaryKey); err != nil {
			return false, false, err
		}
		if name == column {
			found = true
		}
	}
	return tableExists, found, rows.Err()
}

func migrateLegacySessionTable(ctx context.Context, db *sql.DB) error {
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); err != nil {
		return err
	}
	defer conn.ExecContext(context.Background(), `PRAGMA foreign_keys = ON`)

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, sessionTableDDL("sessions_v1")); err != nil {
		return err
	}
	copySQL := `INSERT INTO sessions_v1 (` + sessionColumns + `) SELECT ` + sessionColumns + ` FROM sessions`
	if _, err := tx.ExecContext(ctx, copySQL); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DROP TABLE sessions`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `ALTER TABLE sessions_v1 RENAME TO sessions`); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`); err != nil {
		return err
	}
	rows, err := conn.QueryContext(ctx, `PRAGMA foreign_key_check`)
	if err != nil {
		return err
	}
	defer rows.Close()
	if rows.Next() {
		return fmt.Errorf("session schema migration left invalid foreign keys")
	}
	return rows.Err()
}

func ensureSessionSchema(ctx context.Context, db *sql.DB) error {
	var version int
	if err := db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		return err
	}
	if version > sessionSchemaVersion {
		return fmt.Errorf("SQLite schema version %d is newer than supported version %d", version, sessionSchemaVersion)
	}
	exists, singleton, err := sessionTableHasColumn(ctx, db, "singleton")
	if err != nil {
		return err
	}
	switch {
	case !exists:
		if _, err := db.ExecContext(ctx, sessionTableDDL("sessions")); err != nil {
			return err
		}
	case singleton:
		if err := migrateLegacySessionTable(ctx, db); err != nil {
			return fmt.Errorf("migrate single-account session table: %w", err)
		}
	}
	for _, statement := range []string{
		`CREATE UNIQUE INDEX IF NOT EXISTS sessions_sip_user_unique
			ON sessions (sip_user) WHERE sip_user IS NOT NULL AND sip_user <> ''`,
		`CREATE INDEX IF NOT EXISTS sessions_created ON sessions (created_at, id)`,
	} {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf(`PRAGMA user_version = %d`, sessionSchemaVersion)); err != nil {
		return err
	}
	return nil
}

const callHistoryDDL = `CREATE TABLE IF NOT EXISTS call_history (
	session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
	call_id TEXT NOT NULL,
	owner TEXT,
	direction TEXT NOT NULL,
	peer TEXT NOT NULL,
	started_at BIGINT NOT NULL,
	status TEXT NOT NULL,
	held BOOLEAN NOT NULL DEFAULT false,
	ended_at BIGINT,
	end_reason TEXT,
	source TEXT,
	PRIMARY KEY (session_id, call_id)
)`

func newSessionStore(ctx context.Context, db *sql.DB) (*sessionStore, error) {
	if err := ensureSessionSchema(ctx, db); err != nil {
		return nil, err
	}
	schema := []string{
		callHistoryDDL,
		`CREATE INDEX IF NOT EXISTS call_history_session_ended
			ON call_history (session_id, ended_at DESC, started_at DESC)`,
		`CREATE TABLE IF NOT EXISTS messages (
			session_id TEXT NOT NULL,
			chat_jid TEXT NOT NULL,
			sender_jid TEXT NOT NULL,
			msg_id TEXT NOT NULL,
			from_me INTEGER NOT NULL,
			ts INTEGER NOT NULL,
			type TEXT NOT NULL,
			body TEXT,
			raw TEXT,
			PRIMARY KEY (session_id, chat_jid, msg_id)
		)`,
		`CREATE INDEX IF NOT EXISTS messages_chat_ts
			ON messages (session_id, chat_jid, ts DESC)`,
		`CREATE INDEX IF NOT EXISTS messages_session_ts
			ON messages (session_id, ts DESC)`,
		`CREATE TABLE IF NOT EXISTS scheduled_messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			to_jid TEXT NOT NULL,
			msg TEXT NOT NULL,
			send_at INTEGER NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			last_error TEXT,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS scheduled_due
			ON scheduled_messages (status, send_at)`,
		`CREATE TABLE IF NOT EXISTS chatwoot_outbox (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			source_id TEXT NOT NULL,
			payload TEXT NOT NULL,
			attempts INTEGER NOT NULL DEFAULT 0,
			next_at INTEGER NOT NULL,
			created_at INTEGER NOT NULL,
			last_error TEXT,
			dead INTEGER NOT NULL DEFAULT 0,
			UNIQUE (session_id, source_id)
		)`,
		`CREATE INDEX IF NOT EXISTS chatwoot_outbox_due
			ON chatwoot_outbox (dead, next_at)`,
		`CREATE TABLE IF NOT EXISTS mcp_keys (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			name TEXT NOT NULL DEFAULT '',
			key_hash TEXT NOT NULL UNIQUE,
			prefix TEXT NOT NULL,
			read_only INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_used_at TIMESTAMP
		)`,
	}
	for _, statement := range schema {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return nil, err
		}
	}
	return &sessionStore{db: db}, nil
}

// genSIPCredential returns a random hexadecimal token for SIP credentials.
func genSIPCredential(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// generateRandomString returns a random hexadecimal string with n characters.
func generateRandomString(n int) string {
	b := make([]byte, (n+1)/2)
	rand.Read(b)
	return hex.EncodeToString(b)[:n]
}

func newSessionID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *sessionStore) list(ctx context.Context) ([]sessionRow, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, COALESCE(jid, ''), COALESCE(last_jid, ''), COALESCE(webhook, ''), COALESCE(webhook_secret, ''), COALESCE(webhook_events, ''), COALESCE(webhook_ignore_groups, false), COALESCE(webhooks, ''), COALESCE(chatwoot, ''), COALESCE(recording, false), COALESCE(proxy, ''), COALESCE(sip_user, ''), COALESCE(sip_pass, ''), COALESCE(sip_ext_enabled, false), COALESCE(sip_ext_host, ''), COALESCE(sip_ext_port, 5060), COALESCE(sip_ext_user, ''), COALESCE(sip_ext_pass, ''), COALESCE(sip_ext_dest, ''), COALESCE(sip_ext_proxy, ''), COALESCE(sip_ext_opts, '') FROM sessions ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []sessionRow
	for rows.Next() {
		var r sessionRow
		if err := rows.Scan(&r.ID, &r.Name, &r.JID, &r.LastJID, &r.Webhook, &r.WebhookSecret, &r.WebhookEvents, &r.WebhookIgnoreGroups, &r.Webhooks, &r.Chatwoot, &r.Recording, &r.Proxy, &r.SIPUser, &r.SIPPass, &r.SIPExtEnabled, &r.SIPExtHost, &r.SIPExtPort, &r.SIPExtUser, &r.SIPExtPass, &r.SIPExtDest, &r.SIPExtProxy, &r.SIPExtOpts); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// insert cria a sessão já com credenciais SIP geradas e as devolve.
func (s *sessionStore) insert(ctx context.Context, id, name string) (sipUser, sipPass string, err error) {
	sipPass = genSIPCredential(12)
	for range 5 {
		sipUser = "wa_" + genSIPCredential(4)
		_, err = s.db.ExecContext(ctx,
			`INSERT INTO sessions (id, name, jid, sip_user, sip_pass) VALUES ($1, $2, NULL, $3, $4)`,
			id, name, sipUser, sipPass)
		if err == nil {
			return sipUser, sipPass, nil
		}
		if !strings.Contains(err.Error(), "sessions.sip_user") {
			return "", "", err
		}
	}
	return "", "", fmt.Errorf("generate unique SIP username: %w", err)
}

var errSIPUsernameExists = errors.New("SIP username already exists")

func (s *sessionStore) setSIP(ctx context.Context, id, sipUser, sipPass string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET sip_user = $1, sip_pass = $2 WHERE id = $3`, sipUser, sipPass, id)
	if err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed: sessions.sip_user") {
		return fmt.Errorf("%w: %s", errSIPUsernameExists, sipUser)
	}
	return err
}

// setSIPExt persists mode 2 configuration for registration with an external PBX.
func (s *sessionStore) setSIPExt(ctx context.Context, id string, enabled bool, host string, port int, user, pass, dest, proxy string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE sessions SET sip_ext_enabled = $1, sip_ext_host = $2, sip_ext_port = $3, sip_ext_user = $4, sip_ext_pass = $5, sip_ext_dest = $6, sip_ext_proxy = $7 WHERE id = $8`,
		enabled, host, port, user, pass, dest, proxy, id)
	return err
}

// setSIPAgent persiste as opções do modo agente (JSON) da sessão.
func (s *sessionStore) setSIPAgent(ctx context.Context, id, opts string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET sip_ext_opts = $1 WHERE id = $2`, opts, id)
	return err
}

func (s *sessionStore) setJID(ctx context.Context, id, jid string) error {
	// ao conectar (jid != ''), atualiza também o last_jid; ao desconectar (jid=''),
	// preserva o last_jid para o painel mostrar o último número.
	_, err := s.db.ExecContext(ctx,
		`UPDATE sessions SET jid = $1, last_jid = CASE WHEN $1 <> '' THEN $1 ELSE last_jid END WHERE id = $2`, jid, id)
	return err
}

// setWebhooks grava a lista de webhooks (JSON) e espelha o "default" nas colunas
// legadas (assim uma imagem antiga ainda acha o webhook principal).
func (s *sessionStore) setWebhooks(ctx context.Context, id, listJSON, url, secret, events string, ignoreGroups bool) error {
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET webhooks = $1, webhook = $2, webhook_secret = $3, webhook_events = $4, webhook_ignore_groups = $5 WHERE id = $6`, listJSON, url, secret, events, ignoreGroups, id)
	return err
}

func (s *sessionStore) setChatwoot(ctx context.Context, id, cfgJSON string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET chatwoot = $1 WHERE id = $2`, cfgJSON, id)
	return err
}

func (s *sessionStore) setRecording(ctx context.Context, id string, on bool) error {
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET recording = $1 WHERE id = $2`, on, id)
	return err
}

func (s *sessionStore) setProxy(ctx context.Context, id, proxyURL string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET proxy = $1 WHERE id = $2`, proxyURL, id)
	return err
}

func (s *sessionStore) appendCallHistory(ctx context.Context, record CallRecord) error {
	var owner any
	if record.Owner != nil {
		owner = *record.Owner
	}
	var endedAt any
	if record.EndedAt != nil {
		endedAt = *record.EndedAt
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO call_history (
		session_id, call_id, owner, direction, peer, started_at, status, held, ended_at, end_reason, source
	) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	ON CONFLICT (session_id, call_id) DO UPDATE SET
		owner = EXCLUDED.owner,
		direction = EXCLUDED.direction,
		peer = EXCLUDED.peer,
		started_at = EXCLUDED.started_at,
		status = EXCLUDED.status,
		held = EXCLUDED.held,
		ended_at = EXCLUDED.ended_at,
		end_reason = EXCLUDED.end_reason,
		source = EXCLUDED.source`,
		record.SessionID, record.CallID, owner, record.Direction, record.Peer,
		record.StartedAt, string(record.Status), record.Held, endedAt, record.EndReason, record.Source,
	)
	return err
}

func (s *sessionStore) listCallHistory(ctx context.Context, sessionID string, limit int) ([]CallRecord, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `SELECT
		session_id, call_id, owner, direction, peer, started_at, status, held, ended_at,
		COALESCE(end_reason, ''), COALESCE(source, '')
		FROM call_history
		WHERE session_id = $1
		ORDER BY ended_at DESC NULLS LAST, started_at DESC
		LIMIT $2`, sessionID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := make([]CallRecord, 0, limit)
	for rows.Next() {
		var record CallRecord
		var owner sql.NullString
		var endedAt sql.NullInt64
		if err := rows.Scan(
			&record.SessionID, &record.CallID, &owner, &record.Direction, &record.Peer,
			&record.StartedAt, &record.Status, &record.Held, &endedAt,
			&record.EndReason, &record.Source,
		); err != nil {
			return nil, err
		}
		if owner.Valid {
			value := owner.String
			record.Owner = &value
		}
		if endedAt.Valid {
			value := endedAt.Int64
			record.EndedAt = &value
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func (s *sessionStore) delete(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, statement := range []string{
		`DELETE FROM messages WHERE session_id = $1`,
		`DELETE FROM scheduled_messages WHERE session_id = $1`,
		`DELETE FROM chatwoot_outbox WHERE session_id = $1`,
		`DELETE FROM sessions WHERE id = $1`,
	} {
		if _, err := tx.ExecContext(ctx, statement, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}
