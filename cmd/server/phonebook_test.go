package main

import (
	"encoding/xml"
	"strings"
	"testing"
)

func TestRenderGrandstreamPhonebook(t *testing.T) {
	body, err := renderGrandstreamPhonebook([]phonebookContact{
		{Name: "Alice & Bob", Phone: "628123456789"},
	})
	if err != nil {
		t.Fatal(err)
	}
	var book grandstreamAddressBook
	if err := xml.Unmarshal(body, &book); err != nil {
		t.Fatalf("invalid XML: %v\n%s", err, body)
	}
	if len(book.Contacts) != 1 {
		t.Fatalf("got %d contacts", len(book.Contacts))
	}
	contact := book.Contacts[0]
	if contact.FirstName != "Alice" || contact.LastName != "& Bob" {
		t.Fatalf("unexpected name split: %+v", contact)
	}
	if len(contact.Phones) != 1 || contact.Phones[0].Number != "628123456789" {
		t.Fatalf("unexpected phone: %+v", contact.Phones)
	}
}

func TestRenderVCardPhonebookEscapesValues(t *testing.T) {
	body := string(renderVCardPhonebook([]phonebookContact{
		{Name: "Alice; Support, Tier 1", Phone: "628123456789"},
	}))
	for _, want := range []string{
		"BEGIN:VCARD\r\nVERSION:3.0\r\n",
		"FN:Alice\\; Support\\, Tier 1\r\n",
		"TEL;TYPE=CELL:628123456789\r\n",
		"END:VCARD\r\n",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("vCard missing %q:\n%s", want, body)
		}
	}
}

func TestPhonebookTokenIsSessionScoped(t *testing.T) {
	t.Setenv("WACALLS_API_KEY", "test-master-key")
	one, ok := phonebookToken("session-1")
	if !ok || one == "" {
		t.Fatal("token was not generated")
	}
	two, _ := phonebookToken("session-2")
	if one == two {
		t.Fatal("different sessions received the same token")
	}
	if !validPhonebookToken("session-1", one) {
		t.Fatal("valid token was rejected")
	}
	if validPhonebookToken("session-1", two) || validPhonebookToken("session-1", one+"x") {
		t.Fatal("invalid token was accepted")
	}
}
