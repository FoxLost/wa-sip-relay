package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	waLog "go.mau.fi/whatsmeow/util/log"
)

type server struct {
	broker    *Broker
	sessions  *SessionManager
	log       *slog.Logger
	staticDir string
	sipGW     *SIPGateway
	apiMux    *http.ServeMux // usado pelo MCP para despachar as ferramentas em processo
}

// newServer opens the SQLite database and initializes the relay.
func newServer(ctx context.Context, dbPath, staticDir string, maxCalls, maxAccounts int, log *slog.Logger) (*server, error) {
	waLogger := waLog.Noop
	if log.Enabled(ctx, slog.LevelDebug) {
		waLogger = waLog.Stdout("WA", "DEBUG", true)
	}

	provider, err := newDBProvider(ctx, dbPath, waLogger, log)
	if err != nil {
		return nil, err
	}

	mainDB, err := provider.openMainDB(ctx)
	if err != nil {
		return nil, err
	}
	store, err := newSessionStore(ctx, mainDB)
	if err != nil {
		_ = mainDB.Close()
		return nil, err
	}

	broker := NewBroker()
	mgr := newSessionManager(ctx, provider, broker, store, waLogger, log, maxCalls, maxAccounts)
	broker.OnCallEnded = func(record CallRecord) {
		persistCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := store.appendCallHistory(persistCtx, record); err != nil {
			log.Error("persist call history", "session", record.SessionID, "call_id", record.CallID, "err", err)
		}
	}
	broker.SessionsFn = mgr.infos
	broker.AccountForSession = mgr.accountIDForSession
	broker.HostForSession = mgr.hostForSession
	broker.InboxForSession = mgr.inboxIDForSession

	// Gateway SIP: o PBX/softphone do cliente se registra aqui (modelo Wavoip).
	// Endereço configurável por WACALLS_SIP_ADDR (padrão 0.0.0.0:5060).
	sipAddr := os.Getenv("WACALLS_SIP_ADDR")
	if sipAddr == "" {
		sipAddr = "0.0.0.0:5060"
	}
	sipGateway, err := NewSIPGateway(mgr, log)
	if err != nil {
		log.Error("SIP gateway init failed", "err", err)
	} else {
		mgr.sipInbound = sipGateway.handleInboundCall
		mgr.sipAgentCount = sipGateway.agentCount
		mgr.sipExtApply = sipGateway.applyExtRegistration
		mgr.sipExtRemove = sipGateway.removeExtRegistration
		_ = sipGateway.Start(ctx, sipAddr)
	}

	return &server{broker: broker, sessions: mgr, log: log, staticDir: staticDir, sipGW: sipGateway}, nil
}

func (s *server) close() {
	s.sessions.disconnectAll()
	if err := s.sessions.store.db.Close(); err != nil {
		s.log.Warn("close SQLite database", "err", err)
	}
}
