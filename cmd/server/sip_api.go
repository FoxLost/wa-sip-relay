package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// HTTP endpoints for per-session SIP status and configuration.

func (s *server) handleSIPStatus(w http.ResponseWriter, r *http.Request) {
	if s.sipGW == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"enabled": false,
			"message": "SIP Gateway not started",
		})
		return
	}

	s.sipGW.mu.RLock()
	regs := make([]map[string]string, 0, len(s.sipGW.registrations))
	for _, reg := range s.sipGW.registrations {
		regs = append(regs, map[string]string{
			"sip_user":    reg.sipUser,
			"session_id":  reg.sessionID,
			"contact":     reg.contact,
			"client_name": reg.clientName,
			"source_ip":   reg.sourceIP,
		})
	}
	calls := make([]map[string]string, 0, len(s.sipGW.activeCalls))
	for _, sc := range s.sipGW.activeCalls {
		calls = append(calls, map[string]string{
			"sip_call_id": sc.sipCallID,
			"session_id":  sc.sessionID,
			"wa_call_id":  sc.waCallID,
			"from":        sc.fromURI,
			"to":          sc.toURI,
		})
	}
	s.sipGW.mu.RUnlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":       true,
		"port":          5060,
		"registrations": regs,
		"active_calls":  calls,
	})
}

func sipConfigPayload(sess *Session) map[string]any {
	user, pass, url := sess.directSIPCredentials()
	return map[string]any{
		"sip_user":   user,
		"sip_pass":   pass,
		"sip_url":    url,
		"sip_realm":  "astracalls",
		"sip_port":   5060,
		"codecs":     []string{"PCMU/8000", "PCMA/8000"},
		"session_id": sess.id,
	}
}

func validSIPUsername(user string) bool {
	if len(user) < 3 || len(user) > 64 {
		return false
	}
	for _, c := range user {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
			(c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.' {
			continue
		}
		return false
	}
	return true
}

func validSIPPassword(password string) bool {
	return len(password) >= 8 && len(password) <= 128 &&
		!strings.ContainsAny(password, "\x00\r\n")
}

func (s *server) handleSIPConfig(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	if r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, sipConfigPayload(sess))
		return
	}

	var body struct {
		SIPUser string `json:"sip_user"`
		SIPPass string `json:"sip_pass"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	body.SIPUser = strings.TrimSpace(body.SIPUser)
	if !validSIPUsername(body.SIPUser) {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "SIP username must be 3-64 characters using letters, numbers, dot, dash, or underscore",
		})
		return
	}
	if !validSIPPassword(body.SIPPass) {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "SIP password must be 8-128 characters without line breaks",
		})
		return
	}

	sess.sipConfigMu.Lock()
	err := s.sessions.store.setSIP(r.Context(), sess.id, body.SIPUser, body.SIPPass)
	if err == nil {
		sess.setDirectSIPCredentials(body.SIPUser, body.SIPPass)
	}
	sess.sipConfigMu.Unlock()
	if errors.Is(err, errSIPUsernameExists) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "SIP username is already used by another account"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not save SIP credentials"})
		return
	}

	// Existing bindings authenticated with the old credentials must register again.
	if s.sipGW != nil {
		s.sipGW.removeDirectRegistrations(sess.id)
	}
	writeJSON(w, http.StatusOK, sipConfigPayload(sess))
}

// handleSIPExtConfig reads or writes mode 2: register this session as an
// extension on the customer's external PBX.
func (s *server) handleSIPExtConfig(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}

	if r.Method == http.MethodGet {
		cfg := sess.sipExtSnapshot()
		state, lastErr := "", ""
		if s.sipGW != nil {
			state, lastErr = s.sipGW.extRegStatus(sess.id)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"enabled":                 cfg.Enabled,
			"host":                    cfg.Host,
			"port":                    cfg.Port,
			"user":                    cfg.User,
			"authUser":                cfg.Agent.AuthUser,
			"pass":                    cfg.Pass,
			"dest":                    cfg.Dest,
			"proxy":                   cfg.Proxy,
			"inboundMode":             cfg.Agent.mode(),
			"agentAutoAnswer":         cfg.Agent.AutoAnswer,
			"agentRingTimeoutSeconds": int(cfg.Agent.ringTimeout() / time.Second),
			"status":                  state,
			"error":                   lastErr,
			"advertise":               sipAdvertiseHost() + ":" + itoa(sipAdvertisePort()),
		})
		return
	}

	// POST updates the stored configuration and applies it.
	var body struct {
		Enabled bool   `json:"enabled"`
		Host    string `json:"host"`
		Port    int    `json:"port"`
		User    string `json:"user"`
		Pass    string `json:"pass"`
		Dest    string `json:"dest"`
		Proxy   string `json:"proxy"`
		// Authentication username (3CX Authentication ID); nil preserves the value.
		AuthUser *string `json:"authUser"`
		// Optional agent-mode fields; absent values preserve the current setting.
		InboundMode string `json:"inboundMode"`
		AutoAnswer  *bool  `json:"agentAutoAnswer"`
		RingTimeout *int   `json:"agentRingTimeoutSeconds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	if body.Port <= 0 {
		body.Port = 5060
	}
	if body.Enabled && (body.Host == "" || body.User == "") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "host e usuário são obrigatórios"})
		return
	}
	agent := sess.sipExtSnapshot().Agent
	if body.AuthUser != nil {
		agent.AuthUser = strings.TrimSpace(*body.AuthUser)
	}
	if m := strings.TrimSpace(body.InboundMode); m != "" {
		switch m {
		case sipInboundOriginate, sipInboundAgent, sipInboundAuto:
			agent.InboundMode = m
		default:
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "inboundMode deve ser originate, agent ou auto"})
			return
		}
	}
	if body.AutoAnswer != nil {
		agent.AutoAnswer = *body.AutoAnswer
	}
	if body.RingTimeout != nil {
		if *body.RingTimeout < 0 || *body.RingTimeout > 600 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "agentRingTimeoutSeconds deve ficar entre 0 e 600"})
			return
		}
		agent.RingTimeout = *body.RingTimeout
	}
	cfg := sipExtConfig{
		Enabled: body.Enabled, Host: body.Host, Port: body.Port,
		User: body.User, Pass: body.Pass, Dest: body.Dest, Proxy: strings.TrimSpace(body.Proxy),
		Agent: agent,
	}
	sess.setSIPExt(cfg)
	if raw, err := json.Marshal(agent); err == nil {
		if err := s.sessions.store.setSIPAgent(r.Context(), sess.id, string(raw)); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
	}
	if err := s.sessions.store.setSIPExt(r.Context(), sess.id, cfg.Enabled, cfg.Host, cfg.Port, cfg.User, cfg.Pass, cfg.Dest, cfg.Proxy); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if s.sipGW != nil {
		s.sipGW.applyExtRegistration(sess)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// handleSIPAgentConfig lê/atualiza SÓ o modo do INVITE entrante (sem mexer no
// registro no PBX): GET/POST /api/sessions/{sid}/sip-agent
// {"inboundMode":"agent","agentAutoAnswer":false,"agentRingTimeoutSeconds":30}.
func (s *server) handleSIPAgentConfig(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	cfg := sess.sipExtSnapshot()
	if r.Method == http.MethodPost {
		var body struct {
			InboundMode string `json:"inboundMode"`
			AutoAnswer  *bool  `json:"agentAutoAnswer"`
			RingTimeout *int   `json:"agentRingTimeoutSeconds"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
			return
		}
		if m := strings.TrimSpace(body.InboundMode); m != "" {
			switch m {
			case sipInboundOriginate, sipInboundAgent, sipInboundAuto:
				cfg.Agent.InboundMode = m
			default:
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "inboundMode deve ser originate, agent ou auto"})
				return
			}
		}
		if body.AutoAnswer != nil {
			cfg.Agent.AutoAnswer = *body.AutoAnswer
		}
		if body.RingTimeout != nil {
			if *body.RingTimeout < 0 || *body.RingTimeout > 600 {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "agentRingTimeoutSeconds deve ficar entre 0 e 600"})
				return
			}
			cfg.Agent.RingTimeout = *body.RingTimeout
		}
		raw, _ := json.Marshal(cfg.Agent)
		if err := s.sessions.store.setSIPAgent(r.Context(), sess.id, string(raw)); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		sess.setSIPExt(cfg)
		s.sessions.broker.emitSessionList(s.sessions.infos())
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"inboundMode":             cfg.Agent.mode(),
		"agentAutoAnswer":         cfg.Agent.AutoAnswer,
		"agentRingTimeoutSeconds": int(cfg.Agent.ringTimeout() / time.Second),
	})
}

func itoa(n int) string { return strconv.Itoa(n) }
