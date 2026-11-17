package main

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"go.mau.fi/whatsmeow/store/sqlstore"
	waLog "go.mau.fi/whatsmeow/util/log"
	_ "modernc.org/sqlite"
)

const defaultSQLitePath = "data/wa-sip-relay.db"

// dbProvider opens independent connection pools to one SQLite file. The
// application tables and the WhatsMeow device store intentionally share that
// file because the relay supports exactly one WhatsApp account.
type dbProvider struct {
	dsn      string
	path     string
	waLogger waLog.Logger
}

func newDBProvider(ctx context.Context, path string, waLogger waLog.Logger, log *slog.Logger) (*dbProvider, error) {
	dsn, displayPath, err := sqliteDSN(path)
	if err != nil {
		return nil, err
	}
	provider := &dbProvider{dsn: dsn, path: displayPath, waLogger: waLogger}
	db, err := provider.openDB(ctx)
	if err != nil {
		return nil, err
	}
	if err := db.Close(); err != nil {
		return nil, fmt.Errorf("close SQLite startup connection: %w", err)
	}
	log.Info("SQLite storage ready", "path", displayPath)
	return provider, nil
}

func sqliteDSN(path string) (dsn, displayPath string, err error) {
	path = strings.TrimSpace(path)
	if path == "" {
		path = defaultSQLitePath
	}
	if path == ":memory:" {
		return "file:wa-sip-relay?mode=memory&cache=shared&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)", path, nil
	}

	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return "", "", fmt.Errorf("resolve SQLite path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolutePath), 0o700); err != nil {
		return "", "", fmt.Errorf("create SQLite directory: %w", err)
	}

	dsnURL := &url.URL{Scheme: "file", Path: filepath.ToSlash(absolutePath)}
	query := dsnURL.Query()
	query.Add("_pragma", "foreign_keys(1)")
	query.Add("_pragma", "busy_timeout(5000)")
	query.Add("_pragma", "journal_mode(WAL)")
	dsnURL.RawQuery = query.Encode()
	return dsnURL.String(), absolutePath, nil
}

func (p *dbProvider) openDB(ctx context.Context) (*sql.DB, error) {
	db, err := sql.Open("sqlite", p.dsn)
	if err != nil {
		return nil, fmt.Errorf("open SQLite database: %w", err)
	}
	db.SetMaxOpenConns(4)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("open SQLite database %s: %w", p.path, err)
	}
	return db, nil
}

func (p *dbProvider) openMainDB(ctx context.Context) (*sql.DB, error) {
	return p.openDB(ctx)
}

func (p *dbProvider) openSessionContainer(ctx context.Context, _ string) (*sqlstore.Container, *sql.DB, error) {
	db, err := p.openDB(ctx)
	if err != nil {
		return nil, nil, err
	}
	container := sqlstore.NewWithDB(db, "sqlite", p.waLogger)
	if err := container.Upgrade(ctx); err != nil {
		_ = db.Close()
		return nil, nil, fmt.Errorf("upgrade WhatsApp device store: %w", err)
	}
	return container, db, nil
}
