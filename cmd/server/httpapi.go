package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"wacalls/internal/voip/core"
	"wacalls/internal/voip/media"

	"go.mau.fi/whatsmeow/types"
)

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/config", s.handleConfig)
	mux.HandleFunc("GET /api/sessions", s.handleSessionList)
	mux.HandleFunc("POST /api/sessions", s.handleSessionCreate)
	mux.HandleFunc("DELETE /api/sessions/{sid}", s.handleSessionDelete)
	mux.HandleFunc("POST /api/sessions/{sid}/logout", s.handleSessionLogout)
	mux.HandleFunc("POST /api/sessions/{sid}/pair", s.handleSessionPair)
	mux.HandleFunc("POST /api/sessions/{sid}/pair-code", s.handleSessionPairCode)
	mux.HandleFunc("POST /api/sessions/{sid}/pair-passkey", s.handlePairPasskey)
	mux.HandleFunc("GET /api/sessions/{sid}/calls", s.handleSessionCalls)
	mux.HandleFunc("GET /api/sessions/{sid}/history", s.handleHistory)

	mux.HandleFunc("GET /api/sip/status", s.handleSIPStatus)
	mux.HandleFunc("GET /api/sessions/{sid}/sip", s.handleSIPConfig)
	mux.HandleFunc("POST /api/sessions/{sid}/sip", s.handleSIPConfig)
	mux.HandleFunc("GET /api/sessions/{sid}/sip-ext", s.handleSIPExtConfig)
	mux.HandleFunc("POST /api/sessions/{sid}/sip-ext", s.handleSIPExtConfig)

	mux.HandleFunc("GET /api/sessions/{sid}/phonebook", s.handlePhonebookConfig)
	mux.HandleFunc("GET /phonebook/{sid}/grandstream.xml", s.handleGrandstreamPhonebook)
	mux.HandleFunc("GET /phonebook/{sid}/contacts.vcf", s.handleVCardPhonebook)
	mux.HandleFunc("GET /phonebook/{sid}/contacts.json", s.handleJSONPhonebook)

	mux.HandleFunc("GET /api/events", s.handleEvents)
	mux.HandleFunc("GET /livez", s.handleLivez)
	mux.HandleFunc("GET /readyz", s.handleLivez)
	mux.HandleFunc("GET /metrics", s.handleMetrics)

	if s.staticDir != "" {
		if _, err := os.Stat(s.staticDir); err == nil {
			mux.Handle("/", s.staticFileHandler())
		}
	}
	s.apiMux = mux
	var handler http.Handler = mux
	if key := os.Getenv("WACALLS_API_KEY"); key != "" {
		handler = withAuth(handler, key, "", nil)
	}
	return withCORS(handler)
}

func withCORS(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Client-Id, X-API-Key, Authorization, Mcp-Session-Id, Mcp-Protocol-Version")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.ServeHTTP(w, r)
	})
}

// withAuth protege as rotas /api/* com uma API key (header X-API-Key,
// Authorization: Bearer ou ?apiKey=).
// Exceções: o webhook do Chatwoot (chamado externamente pelo próprio Chatwoot)
// e os arquivos estáticos do painel (precisam carregar a tela de login).
//
// Segurança (issue #10): a chave-MESTRA (key) libera tudo; a chave de WIDGET
// (widgetKey, opcional) libera SÓ a superfície que o widget do Chatwoot precisa
// (resolve, eventos SSE e operações de chamada). Como o widget expõe a chave no
// data-api-key/URL do EventSource, usar a de widget limita o estrago se ela
// vazar: quem a pega NÃO consegue listar/apagar sessões, mandar mensagens nem
// mexer na config do Chatwoot.
//
// sessionScope (opcional) devolve conta/caixa do Chatwoot de uma sessão: com ele, um
// token de widget só opera chamadas das sessões da própria conta (e caixa, se fixada).
func withAuth(h http.Handler, key, widgetKey string, sessionScope func(sid string) (acct, inbox int)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		guarded := strings.HasPrefix(p, "/api/") && !strings.HasSuffix(p, "/chatwoot/webhook")
		if guarded {
			got := requestAPIKey(r)
			if got == key {
				h.ServeHTTP(w, r) // chave-mestra: libera tudo
				return
			}
			// Superfície de widget: chave estática (por instância) OU token efêmero (por conta).
			if widgetAllowed(r) {
				if widgetKey != "" && got == widgetKey {
					// sem conta o SSE viraria "painel admin" e receberia tudo (QR inclusive).
					if p == "/api/events" && asInt(r.URL.Query().Get("accountId")) == 0 && accountFromClientID(clientID(r)) == 0 {
						writeJSON(w, http.StatusForbidden, map[string]string{"error": "account_required"})
						return
					}
					h.ServeHTTP(w, r)
					return
				}
				if claims, ok := parseWidgetToken(got); ok {
					// escopo de conta no SSE: um token só recebe eventos da sua própria conta.
					if p == "/api/events" && !widgetTokenAccountMatches(r, claims) {
						writeJSON(w, http.StatusForbidden, map[string]string{"error": "account_scope_mismatch"})
						return
					}
					if p == "/api/chatwoot/resolve" && asInt(r.URL.Query().Get("account_id")) != claims.AccountID {
						writeJSON(w, http.StatusForbidden, map[string]string{"error": "account_scope_mismatch"})
						return
					}
					// e só opera chamadas de sessões da própria conta/caixa.
					if sid := sessionIDFromPath(p); sid != "" && sessionScope != nil {
						acct, inbox := sessionScope(sid)
						if acct != claims.AccountID || (claims.InboxID > 0 && inbox != claims.InboxID) {
							writeJSON(w, http.StatusForbidden, map[string]string{"error": "session_scope_mismatch"})
							return
						}
					}
					h.ServeHTTP(w, r)
					return
				}
			}
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		h.ServeHTTP(w, r)
	})
}

// sessionIDFromPath devolve o {sid} de /api/sessions/{sid}/... ("" se não for rota de sessão).
func sessionIDFromPath(p string) string {
	rest, ok := strings.CutPrefix(p, "/api/sessions/")
	if !ok {
		return ""
	}
	sid, _, _ := strings.Cut(rest, "/")
	return sid
}

// requestAPIKey extrai a chave da requisição (X-API-Key, Bearer ou ?apiKey=).
func requestAPIKey(r *http.Request) string {
	got := r.Header.Get("X-API-Key")
	if got == "" {
		got, _ = strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	}
	if got == "" {
		got = r.URL.Query().Get("apiKey")
	}
	return got
}

// eventInboxes lê as caixas (inbox) do Chatwoot que o assinante do SSE atende:
// ?inboxIds=1,2 (ou ?inboxId=1). Um token de widget com caixa fixa SEMPRE fica
// restrito a ela, mesmo que a query peça outras. nil = todas as caixas da conta.
func eventInboxes(r *http.Request) map[int]bool {
	if c, ok := parseWidgetToken(requestAPIKey(r)); ok && c.InboxID > 0 {
		return map[int]bool{c.InboxID: true}
	}
	q := r.URL.Query()
	raw := q.Get("inboxIds")
	if raw == "" {
		raw = q.Get("inboxId")
	}
	if raw == "" {
		return nil
	}
	// lista sem nenhum id válido (ex.: "0", agente sem caixa) = não recebe nada.
	out := map[int]bool{}
	for _, p := range strings.Split(raw, ",") {
		if id := asInt(strings.TrimSpace(p)); id > 0 {
			out[id] = true
		}
	}
	return out
}

// widgetAllowed diz se a rota faz parte da superfície mínima do widget do
// Chatwoot — a única coisa que a chave de widget (WACALLS_WIDGET_KEY) autoriza.
func widgetAllowed(r *http.Request) bool {
	p := r.URL.Path
	switch {
	case p == "/api/events": // SSE de chamadas
		return true
	case r.Method == http.MethodGet && p == "/api/chatwoot/resolve": // nome/telefone do contato
		return true
	// operações de chamada: iniciar, atender/recusar, webrtc, vídeo, encerrar
	// (/api/sessions/{sid}/calls e abaixo). Não abre a gestão de sessões em si.
	case strings.HasPrefix(p, "/api/sessions/") && strings.Contains(p, "/calls"):
		return true
	}
	return false
}

// staticFileHandler serve o painel estático.
//
//   - index.html e widget.js revalidam (Cache-Control: no-cache) para o agente
//     sempre pegar a última versão — um index.html velho apontaria pra um bundle
//     antigo (sem o fallback de transporte da chamada), causando "chamada muda"
//     após deploy. Os bundles com hash (/assets/index-<hash>.js) são imutáveis e
//     seguem em cache normal.
//   - Se WACALLS_DEFAULT_TRANSPORT estiver setado (ex.: "websocket"), injeta o
//     valor no index.html (window.__WACALLS_DEFAULT_TRANSPORT). O painel então usa
//     esse transporte por padrão, sem o agente precisar de ?transport=ws — útil
//     em redes/servidores onde o WebRTC (UDP) não fecha e o WS é o caminho
//     confiável. ?transport= e localStorage continuam tendo prioridade.
func (s *server) staticFileHandler() http.Handler {
	fs := http.FileServer(http.Dir(s.staticDir))
	defaultTransport := strings.TrimSpace(os.Getenv("WACALLS_DEFAULT_TRANSPORT"))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/", "/index.html":
			w.Header().Set("Cache-Control", "no-cache, must-revalidate")
			if defaultTransport != "" {
				if b, err := os.ReadFile(filepath.Join(s.staticDir, "index.html")); err == nil {
					inject := "<script>window.__WACALLS_DEFAULT_TRANSPORT=" + strconv.Quote(defaultTransport) + ";</script>"
					html := strings.Replace(string(b), "</head>", inject+"</head>", 1)
					w.Header().Set("Content-Type", "text/html; charset=utf-8")
					_, _ = w.Write([]byte(html))
					return
				}
			}
		case "/widget.js":
			w.Header().Set("Cache-Control", "no-cache, must-revalidate")
		}
		fs.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// accountFromClientID extrai o número da conta do padrão "astrachat_accN" usado pela
// integração do Chatwoot (ex.: "astrachat_acc4" -> 4). Devolve 0 se não casar, para
// o chamador manter o comportamento de escopo admin.
func accountFromClientID(cid string) int {
	const prefix = "astrachat_acc"
	if !strings.HasPrefix(cid, prefix) {
		return 0
	}
	return asInt(strings.TrimPrefix(cid, prefix))
}

func clientID(r *http.Request) string {
	if id := r.Header.Get("X-Client-Id"); id != "" {
		return id
	}
	return r.URL.Query().Get("clientId")
}

func (s *server) sessionByID(w http.ResponseWriter, sid string) *Session {
	sess, ok := s.sessions.Get(sid)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such session"})
		return nil
	}
	return sess
}

func (s *server) handleEvents(w http.ResponseWriter, r *http.Request) {
	// accountId (opcional) escopa os eventos de chamada por conta do Chatwoot: o
	// widget do Chatwoot passa a conta dele; o painel admin não passa e recebe tudo.
	acc := asInt(r.URL.Query().Get("accountId"))
	cid := clientID(r)
	// Rede de segurança: se a integração conectar SEM accountId, o escopo cairia em
	// 0 (=painel admin) e essa conexão passaria a receber chamadas de TODAS as contas
	// — misturando empresas (chamada tocando/contato criado na conta errada). Quando o
	// clientId vem no padrão "astrachat_accN", derivamos a conta do próprio N para não
	// depender da integração lembrar de mandar o parâmetro.
	if acc == 0 {
		if derived := accountFromClientID(cid); derived != 0 {
			acc = derived
		}
	}
	// diagnóstico: quem conectou no SSE e com qual conta (o widget deve passar a
	// conta do Chatwoot; o painel, nenhuma). Ajuda a ver se a chamada não "entra"
	// no Chatwoot por o widget não estar conectado ou estar em outra conta.
	host := ""
	if acc != 0 {
		host = s.sessions.chatwootScopeHost(r.Header.Get("Origin"))
	}
	var inboxes map[int]bool
	if acc != 0 {
		inboxes = eventInboxes(r) // filtro por caixa só vale para widget de conta
	}
	s.log.Info("sse connect", "clientId", cid, "accountId", acc, "origin", r.Header.Get("Origin"), "cwHost", host, "inboxes", len(inboxes))
	s.broker.serveSSE(w, r, cid, acc, host, inboxes)
	s.log.Info("sse disconnect", "clientId", cid, "accountId", acc)
}

func (s *server) handleConfig(w http.ResponseWriter, r *http.Request) {
	cfg := map[string]any{
		"maxCallsPerSession": s.sessions.maxCalls,
		// Transporte de mídia padrão da chamada (ex.: "websocket") — o widget do
		// Chatwoot lê isso p/ usar WS por padrão onde o WebRTC (UDP) não fecha.
		"defaultTransport": strings.TrimSpace(os.Getenv("WACALLS_DEFAULT_TRANSPORT")),
		// Build rodando — o painel mostra `version` (canal: develop/vX.Y.Z) ao lado da
		// logo e `commit` (SHA) no tooltip.
		"version": version,
		"commit":  commit,
		// Chamada em grupo (experimental) habilitada nesta instância.
		"groupCalls": groupCallsEnabled(),
	}
	// IP público anunciado no WebRTC/SIP e de onde veio (env, interface, stun:…,
	// http:…) — diagnóstico do WACALLS_PUBLIC_IP=auto.
	if ip, src := publicIPInfo(); ip != "" {
		cfg["publicIp"], cfg["publicIpSource"] = ip, src
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (s *server) handleSessionList(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"sessions": s.sessions.infos()})
}

func (s *server) handleSessionCalls(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"active":             sess.reg.count(),
		"maxCallsPerSession": s.sessions.maxCalls,
	})
}

func (s *server) handleSessionCreate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = "Session"
	}
	id, err := s.sessions.Create(name)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id})
}

func (s *server) handleSessionDelete(w http.ResponseWriter, r *http.Request) {
	if err := s.sessions.Delete(r.Context(), r.PathValue("sid")); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleSessionLogout(w http.ResponseWriter, r *http.Request) {
	if err := s.sessions.Logout(r.Context(), r.PathValue("sid")); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleSessionPair(w http.ResponseWriter, r *http.Request) {
	if err := s.sessions.Pair(r.PathValue("sid")); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/sessions/{sid}/pair-code {phone}  → pareamento por código (sem QR)
func (s *server) handleSessionPairCode(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Phone string `json:"phone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || strings.TrimSpace(b.Phone) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "phone required"})
		return
	}
	code, err := s.sessions.PairPhone(r.PathValue("sid"), normalizePhone(b.Phone))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"code": code})
}

func (s *server) handleStartCall(w http.ResponseWriter, r *http.Request) {
	if sess := s.sessionByID(w, r.PathValue("sid")); sess != nil {
		s.doStartCall(sess, w, r)
	}
}

func (s *server) handleFakeCall(w http.ResponseWriter, r *http.Request) {
	if sess := s.sessionByID(w, r.PathValue("sid")); sess != nil {
		s.doFakeCall(sess, w, r)
	}
}

func (s *server) handleWebRTC(w http.ResponseWriter, r *http.Request) {
	if sess := s.sessionByID(w, r.PathValue("sid")); sess != nil {
		s.doWebRTC(sess, w, r)
	}
}

func (s *server) handleAccept(w http.ResponseWriter, r *http.Request) {
	if sess := s.sessionByID(w, r.PathValue("sid")); sess != nil {
		s.doAccept(sess, w, r)
	}
}

func (s *server) handleReject(w http.ResponseWriter, r *http.Request) {
	if sess := s.sessionByID(w, r.PathValue("sid")); sess != nil {
		s.doReject(sess, w, r)
	}
}

func (s *server) handleEndCall(w http.ResponseWriter, r *http.Request) {
	if sess := s.sessionByID(w, r.PathValue("sid")); sess != nil {
		s.doEndCall(sess, w, r)
	}
}

// handleCallVideo controla a negociação de vídeo mid-call numa chamada ativa.
// action ∈ {request, accept, reject, stop}: pedir upgrade p/ vídeo, aceitar/recusar
// um pedido recebido, ou desligar o vídeo (downgrade p/ áudio).
// handleCallMute anuncia ao peer o estado do nosso microfone (<mute_v2>). Body:
// {"muted": true|false}. Portado do zapo (indicador de mic-off no outro lado).
func (s *server) handleCallMute(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	ac, ok := sess.reg.get(r.PathValue("id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such call"})
		return
	}
	var b struct {
		Muted bool `json:"muted"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	if err := ac.cm.AnnounceMute(r.Context(), b.Muted); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "muted": b.Muted})
}

// handleCallHand anuncia ao peer a nossa mão levantada/baixada. Body: {"raised": bool}.
func (s *server) handleCallHand(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	ac, ok := sess.reg.get(r.PathValue("id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such call"})
		return
	}
	var b struct {
		Raised bool `json:"raised"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	if err := ac.cm.SetHandRaised(r.Context(), b.Raised); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "raised": b.Raised})
}

func (s *server) handleCallVideo(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	id := r.PathValue("id")
	ac, ok := sess.reg.get(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such call"})
		return
	}
	var err error
	switch action := r.PathValue("action"); action {
	case "request":
		err = ac.cm.RequestVideoUpgrade(r.Context())
	case "accept":
		err = ac.cm.AcceptVideoUpgrade(r.Context())
	case "reject":
		err = ac.cm.RejectVideoUpgrade(r.Context())
	case "stop":
		err = ac.cm.StopVideo(r.Context())
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown video action"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// handleHold coloca uma chamada ativa em espera. Body opcional {"moh": true} liga a
// música de espera para o interlocutor (padrão: true). O leg segue vivo.
func (s *server) handleHold(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	if c := s.sipAgentByID(sess, r.PathValue("id")); c != nil {
		s.sipAgentHold(c, w, r)
		return
	}
	id := r.PathValue("id")
	ac, ok := sess.reg.get(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such call"})
		return
	}
	moh := true // por padrão toca música de espera
	var body struct {
		MOH *bool `json:"moh"`
	}
	if json.NewDecoder(r.Body).Decode(&body) == nil && body.MOH != nil {
		moh = *body.MOH
	}
	if err := ac.cm.Hold(moh); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "held": true, "moh": moh})
}

// handleResume tira uma chamada da espera e volta a enviar/receber o áudio.
func (s *server) handleResume(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	if c := s.sipAgentByID(sess, r.PathValue("id")); c != nil {
		s.sipAgentResume(c, w, r)
		return
	}
	id := r.PathValue("id")
	ac, ok := sess.reg.get(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such call"})
		return
	}
	if err := ac.cm.Resume(); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "held": false})
}

// handleTransfer faz uma transferência CEGA de uma chamada ativa para outro atendente:
// põe a chamada em espera com música (o interlocutor não fica no silêncio), libera o
// dono e re-oferece a chamada. Body opcional {"to":"<clientId>"} mira um atendente
// específico; sem ele, a oferta vai a todos os atendentes da conta (fila).
// O leg do WhatsApp NÃO é tocado — só muda quem tem a ponte de áudio.
func (s *server) handleTransfer(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	if c := s.sipAgentByID(sess, r.PathValue("id")); c != nil {
		s.sipAgentTransfer(c, w, r)
		return
	}
	id := r.PathValue("id")
	ac, ok := sess.reg.get(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such call"})
		return
	}
	var body struct {
		To string `json:"to"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	// Melhor esforço: coloca em espera com música. Se já estiver em espera, tudo bem.
	_ = ac.cm.Hold(true)

	from := clientID(r)
	s.broker.reassignOwner(id, nil) // libera o dono para o alvo poder assumir
	peer := ""
	if cr, ok := s.broker.getCall(id); ok && cr != nil {
		peer = cr.Peer
	}
	s.broker.emitTransferOffer(sess.id, id, peer, from, strings.TrimSpace(body.To))
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "transferred": true, "to": strings.TrimSpace(body.To)})
}

// handlePickup assume uma chamada transferida: fixa o novo dono SEM re-aceitar no
// WhatsApp (a chamada já está ativa). Em seguida o navegador do atendente chama
// .../webrtc (abre a ponte, que troca automaticamente) e depois .../resume para tirar
// da espera.
func (s *server) handlePickup(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	if c := s.sipAgentByID(sess, r.PathValue("id")); c != nil {
		s.sipAgentPickup(c, w, r)
		return
	}
	id := r.PathValue("id")
	if _, ok := sess.reg.get(id); !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such call"})
		return
	}
	owner := clientID(r)
	if !s.broker.reassignOwner(id, &owner) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such call"})
		return
	}
	s.broker.emitTransferClaimed(sess.id, id, owner)
	writeJSON(w, http.StatusOK, map[string]any{"call": map[string]string{"callId": id}})
}

func (s *server) handleHistory(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	rows, err := s.sessions.store.listCallHistory(r.Context(), sess.id, 50)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": rows})
}

func (s *server) doStartCall(sess *Session, w http.ResponseWriter, r *http.Request) {
	if sess.client.Store.ID == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "not paired"})
		return
	}
	var body struct {
		Phone      string  `json:"phone"`
		DurationMs flexInt `json:"duration_ms"` // reservado (ignorado); aceita número ou string
		Record     bool    `json:"record"`
		Video      bool    `json:"video"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Phone) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "phone required"})
		return
	}
	owner := clientID(r)
	// (removido) regra "1 chamada por operador" — agora o mesmo navegador/aba
	// pode disparar várias ligações na mesma sessão (até -max-calls-per-session).
	if max := s.sessions.maxCalls; max > 0 && sess.activeCallCount() >= max {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "max concurrent calls"})
		return
	}
	peer := types.NewJID(normalizePhone(body.Phone), types.DefaultUserServer)

	callID, err := sess.startOutgoing(r.Context(), peer, body.Video, body.Record)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.broker.upsertCall(CallRecord{
		SessionID: sess.id, CallID: callID, Owner: &owner, Direction: "outbound", Peer: peer.String(),
		StartedAt: time.Now().UnixMilli(), Status: StatusRinging,
	})
	writeJSON(w, http.StatusOK, map[string]any{"call": map[string]string{"callId": callID}})
}

// doFakeCall dispara um "toque fantasma": faz o aparelho do destinatário tocar por
// alguns segundos (offer) e encerra (terminate), sem estabelecer áudio/vídeo. Serve
// só para chamar atenção. Corpo: {phone, video?, duration_ms?}. duration_ms default
// 3000, teto 30000 (evita virar chamada real longa).
func (s *server) doFakeCall(sess *Session, w http.ResponseWriter, r *http.Request) {
	if sess.client.Store.ID == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "not paired"})
		return
	}
	var body struct {
		Phone      string  `json:"phone"`
		Video      bool    `json:"video"`
		DurationMs flexInt `json:"duration_ms"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Phone) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "phone required"})
		return
	}
	dur := 3 * time.Second
	if body.DurationMs.Int() > 0 {
		dur = time.Duration(body.DurationMs.Int()) * time.Millisecond
	}
	if dur > 30*time.Second {
		dur = 30 * time.Second
	}
	peer := types.NewJID(normalizePhone(body.Phone), types.DefaultUserServer)
	callID, err := sess.fakeCall(r.Context(), peer, body.Video, dur)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"call":       map[string]string{"callId": callID},
		"durationMs": dur.Milliseconds(),
	})
}

func (s *server) doWebRTC(sess *Session, w http.ResponseWriter, r *http.Request) {
	callID := r.PathValue("id")
	if c := s.sipAgentByID(sess, callID); c != nil {
		s.sipAgentWebRTC(c, w, r)
		return
	}
	ac, ok := sess.reg.get(callID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such call"})
		return
	}
	var body struct {
		SDPOffer string `json:"sdp_offer"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.SDPOffer == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "sdp_offer required"})
		return
	}
	bridge, answer, err := NewBridge(body.SDPOffer, s.log)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	browserOpus, ocErr := media.NewOpusCodec(48000, 960)
	if ocErr != nil {
		s.log.Warn("browser Opus codec unavailable — call audio disabled", "err", ocErr)
		browserOpus = nil
	}
	bridge.OnBrowserRTP = func(payload []byte) {
		if browserOpus == nil {
			return
		}
		pcm48, err := browserOpus.Decode(payload)
		if err != nil {
			return
		}
		down := media.Downsample48to16(pcm48)
		ac.recorder.writeBrowser(down)
		ac.spies.feed(spySideAgent, down)
		ac.cm.FeedCapturedPCM(down)
	}
	bridge.OnBrowserVideo = func(au []byte) {
		ac.cm.FeedCapturedVideo(au)
	}
	bridge.OnTerminalICE = func() {
		go sess.terminateCall(callID, core.EndCallReasonUserEnded)
	}
	sess.setBridge(callID, bridge, browserOpus)
	writeJSON(w, http.StatusOK, map[string]string{"sdp_answer": answer})
}

// sipAgentByID devolve a chamada do modo agente SIP com esse id na sessão (ou nil).
func (s *server) sipAgentByID(sess *Session, id string) *sipAgentCall {
	if s.sipGW == nil || !strings.HasPrefix(id, "sip-") {
		return nil
	}
	return s.sipGW.agentCall(sess.id, id)
}

func (s *server) doAccept(sess *Session, w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if c := s.sipAgentByID(sess, id); c != nil {
		s.sipAgentAccept(c, w, r)
		return
	}
	ac, ok := sess.reg.get(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such call"})
		return
	}
	owner := clientID(r)
	// Antes bloqueávamos o operador de aceitar uma 2ª chamada com uma já ativa. Agora
	// permitimos "atender em espera": o painel coloca a atual em hold e aceita a nova.
	// Mantemos só a reivindicação de dono (evita dois clientes pegarem a mesma chamada).
	if !s.broker.setOwner(id, owner) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "claimed by another client"})
		return
	}
	s.broker.emitIncomingClaimed(sess.id, id, owner)
	// atendida aqui (painel, ponte de voz): para de tocar no PBX pelo tronco SIP —
	// senão o ramal seguia chamando enquanto outro já estava na ligação.
	if s.sipGW != nil {
		s.sipGW.cancelInboundRing(id)
	}
	if err := ac.cm.AcceptCall(r.Context(), id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"call": map[string]string{"callId": id}})
}

func (s *server) doReject(sess *Session, w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if c := s.sipAgentByID(sess, id); c != nil {
		s.sipAgentReject(c, w, r)
		return
	}
	ac, ok := sess.reg.get(id)
	if !ok {
		// callId desconhecido: NÃO responde 200 (antes respondia, então o cliente
		// não distinguia "recusou" de "id errado/chamada já encerrada"). 404 deixa
		// claro que a recusa não foi aplicada — o id certo é o mesmo do evento
		// `incoming`/`call-list` (a chave da chamada).
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such call", "status": "not_applied"})
		return
	}
	// RejectCall envia o <reject> ao WhatsApp (encerra de fato a chamada de entrada).
	err := ac.cm.RejectCall(r.Context(), id, core.EndCallReasonDeclined)
	sess.removeCall(id)
	s.broker.endCall(id, string(core.EndCallReasonDeclined))
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error(), "status": "not_applied"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) doEndCall(sess *Session, w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if c := s.sipAgentByID(sess, id); c != nil {
		c.end("agent_hangup", 486)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if ac, ok := sess.reg.get(id); ok {
		_ = ac.cm.EndCall(r.Context(), core.EndCallReasonUserEnded)
	}
	sess.removeCall(id)
	s.broker.endCall(id, string(core.EndCallReasonUserEnded))
	w.WriteHeader(http.StatusNoContent)
}

func normalizePhone(p string) string {
	p = strings.TrimSpace(p)
	p = strings.TrimPrefix(p, "+")
	var b strings.Builder
	for _, c := range p {
		if c >= '0' && c <= '9' {
			b.WriteRune(c)
		}
	}
	return b.String()
}
