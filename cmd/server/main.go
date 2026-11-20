package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

// version é o CANAL do build (nome do branch/tag: "develop", "v1.0.2"...), injetado
// via ldflags no Docker (-X main.version=$BUILD_VERSION). commit é o SHA do git
// (-X main.commit=$BUILD_REV). "dev" em builds locais. Expostos em /api/config; o
// painel mostra `version` ao lado da logo e o `commit` no tooltip.
var (
	version = "dev"
	commit  = "dev"
)

// envInt lê um inteiro de uma variável de ambiente (com valor padrão).
func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

// envStr lê uma string de uma variável de ambiente (com valor padrão).
func envStr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	addr := flag.String("addr", ":8080", "HTTP listen address")
	dbPath := flag.String("db", envStr("WA_SIP_RELAY_DB", defaultSQLitePath), "SQLite database path")
	staticDir := flag.String("static", "client/dist", "static client directory (optional)")
	debug := flag.Bool("debug", false, "verbose logging")
	maxCalls := flag.Int("max-calls-per-session", envInt("WACALLS_MAX_CALLS", 1), "max concurrent calls per WhatsApp account (0 = unlimited)")
	maxAccounts := flag.Int("max-accounts", envInt("WACALLS_MAX_ACCOUNTS", 5), "maximum linked WhatsApp accounts (0 = unlimited)")
	flag.Parse()
	configureDeviceIdentity()

	level := slog.LevelInfo
	if *debug {
		level = slog.LevelDebug
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))

	if os.Getenv("WACALLS_API_KEY") == "" {
		log.Error("WACALLS_API_KEY is required")
		os.Exit(2)
	}
	if len(os.Getenv("WACALLS_WEBUI_PASSWORD")) < 8 {
		log.Error("WACALLS_WEBUI_PASSWORD must contain at least 8 characters")
		os.Exit(2)
	}
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv, err := newServer(ctx, *dbPath, *staticDir, *maxCalls, *maxAccounts, log)
	if err != nil {
		log.Error("startup failed", "err", err)
		os.Exit(1)
	}
	defer srv.close()

	if err := srv.sessions.Restore(ctx); err != nil {
		log.Error("session restore failed", "err", err)
		os.Exit(1)
	}

	httpSrv := &http.Server{Addr: *addr, Handler: srv.routes()}
	go func() {
		log.Info("HTTP server listening", "addr", *addr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("http server error", "err", err)
		}
	}()

	<-ctx.Done()
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}
