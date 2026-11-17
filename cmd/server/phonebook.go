package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/xml"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"

	"go.mau.fi/whatsmeow/types"
)

type phonebookContact struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
}

type grandstreamAddressBook struct {
	XMLName  xml.Name                `xml:"AddressBook"`
	Contacts []grandstreamXMLContact `xml:"Contact"`
}

type grandstreamXMLContact struct {
	FirstName string                `xml:"FirstName"`
	LastName  string                `xml:"LastName"`
	Phones    []grandstreamXMLPhone `xml:"Phone"`
}

type grandstreamXMLPhone struct {
	Type         string `xml:"type,attr"`
	Number       string `xml:"phonenumber"`
	AccountIndex int    `xml:"accountindex"`
}

func contactDisplayName(contact types.ContactInfo, fallback string) string {
	for _, value := range []string{contact.FullName, contact.PushName, contact.FirstName, contact.BusinessName} {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return fallback
}

func loadPhonebookContacts(ctx context.Context, sess *Session) ([]phonebookContact, error) {
	all, err := sess.client.Store.Contacts.GetAllContacts(ctx)
	if err != nil {
		return nil, err
	}

	byPhone := make(map[string]phonebookContact, len(all))
	for jid, contact := range all {
		var phone string
		switch jid.Server {
		case types.DefaultUserServer:
			phone = jid.User
		case types.HiddenUserServer:
			phone, _ = sess.resolvedPhone(jid)
		default:
			continue
		}
		phone = normalizePhone(phone)
		if phone == "" {
			continue
		}
		name := contactDisplayName(contact, phone)
		if current, found := byPhone[phone]; !found || current.Name == current.Phone {
			byPhone[phone] = phonebookContact{Name: name, Phone: phone}
		}
	}

	contacts := make([]phonebookContact, 0, len(byPhone))
	for _, contact := range byPhone {
		contacts = append(contacts, contact)
	}
	sort.Slice(contacts, func(i, j int) bool {
		left, right := strings.ToLower(contacts[i].Name), strings.ToLower(contacts[j].Name)
		if left == right {
			return contacts[i].Phone < contacts[j].Phone
		}
		return left < right
	})
	return contacts, nil
}

func splitContactName(name string) (first, last string) {
	parts := strings.Fields(name)
	if len(parts) == 0 {
		return "", ""
	}
	if len(parts) == 1 {
		return parts[0], ""
	}
	return parts[0], strings.Join(parts[1:], " ")
}

func renderGrandstreamPhonebook(contacts []phonebookContact) ([]byte, error) {
	book := grandstreamAddressBook{Contacts: make([]grandstreamXMLContact, 0, len(contacts))}
	for _, contact := range contacts {
		first, last := splitContactName(contact.Name)
		book.Contacts = append(book.Contacts, grandstreamXMLContact{
			FirstName: first,
			LastName:  last,
			Phones: []grandstreamXMLPhone{{
				Type: "Mobile", Number: contact.Phone, AccountIndex: 0,
			}},
		})
	}
	body, err := xml.MarshalIndent(book, "", "  ")
	if err != nil {
		return nil, err
	}
	return append([]byte(xml.Header), body...), nil
}

func escapeVCard(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	replacer := strings.NewReplacer("\\", "\\\\", "\n", "\\n", ";", "\\;", ",", "\\,")
	return replacer.Replace(value)
}

func renderVCardPhonebook(contacts []phonebookContact) []byte {
	var out strings.Builder
	for _, contact := range contacts {
		out.WriteString("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:")
		out.WriteString(escapeVCard(contact.Name))
		out.WriteString("\r\nTEL;TYPE=CELL:")
		out.WriteString(contact.Phone)
		out.WriteString("\r\nEND:VCARD\r\n")
	}
	return []byte(out.String())
}

func phonebookToken(sessionID string) (string, bool) {
	key := os.Getenv("WACALLS_API_KEY")
	if key == "" {
		return "", false
	}
	mac := hmac.New(sha256.New, []byte(key))
	_, _ = mac.Write([]byte("phonebook\x00" + sessionID))
	return hex.EncodeToString(mac.Sum(nil)), true
}

func validPhonebookToken(sessionID, provided string) bool {
	expected, ok := phonebookToken(sessionID)
	if !ok || len(provided) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

func (s *server) phonebookSession(w http.ResponseWriter, r *http.Request) *Session {
	sessionID := r.PathValue("sid")
	if !validPhonebookToken(sessionID, r.URL.Query().Get("token")) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return nil
	}
	sess, found := s.sessions.Get(sessionID)
	if !found {
		http.NotFound(w, r)
		return nil
	}
	return sess
}

func (s *server) handlePhonebookConfig(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	token, ok := phonebookToken(sess.id)
	if !ok {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "WACALLS_API_KEY is required for phonebook feeds"})
		return
	}
	base := strings.TrimRight(publicBaseURL(r), "/") + "/phonebook/" + url.PathEscape(sess.id)
	query := "?token=" + url.QueryEscape(token)
	writeJSON(w, http.StatusOK, map[string]string{
		"grandstreamXmlUrl": base + "/grandstream.xml" + query,
		"vcardUrl":          base + "/contacts.vcf" + query,
		"jsonUrl":           base + "/contacts.json" + query,
	})
}

func (s *server) handleGrandstreamPhonebook(w http.ResponseWriter, r *http.Request) {
	sess := s.phonebookSession(w, r)
	if sess == nil {
		return
	}
	contacts, err := loadPhonebookContacts(r.Context(), sess)
	if err != nil {
		http.Error(w, "phonebook unavailable", http.StatusInternalServerError)
		return
	}
	body, err := renderGrandstreamPhonebook(contacts)
	if err != nil {
		http.Error(w, "phonebook unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Cache-Control", "private, max-age=300")
	_, _ = w.Write(body)
}

func (s *server) handleVCardPhonebook(w http.ResponseWriter, r *http.Request) {
	sess := s.phonebookSession(w, r)
	if sess == nil {
		return
	}
	contacts, err := loadPhonebookContacts(r.Context(), sess)
	if err != nil {
		http.Error(w, "phonebook unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/vcard; charset=utf-8")
	w.Header().Set("Cache-Control", "private, max-age=300")
	_, _ = w.Write(renderVCardPhonebook(contacts))
}

func (s *server) handleJSONPhonebook(w http.ResponseWriter, r *http.Request) {
	sess := s.phonebookSession(w, r)
	if sess == nil {
		return
	}
	contacts, err := loadPhonebookContacts(r.Context(), sess)
	if err != nil {
		http.Error(w, "phonebook unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=300")
	writeJSON(w, http.StatusOK, map[string]any{"contacts": contacts})
}
