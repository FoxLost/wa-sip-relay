package call

import (
	"context"
	"log/slog"
	"testing"

	"wacalls/internal/voip/core"
	"wacalls/internal/voip/transport"
	"wacalls/internal/voip/wanode"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/types"
)

// fakeRelay é um RelayTransport de teste sem conexão real.
type fakeRelay struct{}

func (fakeRelay) SetSsrc(uint32)                                            {}
func (fakeRelay) SetSubscriptionSsrc(uint32)                                {}
func (fakeRelay) SetStreamSsrcs([]uint32, []uint32)                         {}
func (fakeRelay) SetGroupAllocate(func(string, int, []byte, []byte) []byte) {}
func (fakeRelay) SetOnConnected(func(string, int))                          {}
func (fakeRelay) SetOnReceive(func([]byte))                                 {}
func (fakeRelay) ResendSubscriptions()                                      {}
func (fakeRelay) ConfigureRelays([]transport.RelayConfig)                   {}
func (fakeRelay) Broadcast([]byte)                                          {}
func (fakeRelay) BufferedAmount() uint64                                    { return 0 }
func (fakeRelay) HasConnection() bool                                       { return false }
func (fakeRelay) ConnectedCount() int                                       { return 0 }
func (fakeRelay) Cleanup()                                                  {}

// deviceSock estende fakeSock devolvendo uma lista fixa de devices do destino.
type deviceSock struct {
	fakeSock
	devices []types.JID
}

func (d *deviceSock) GetUSyncDevices(context.Context, []types.JID) ([]types.JID, error) {
	return d.devices, nil
}

func lidDevice(user string, device uint16) types.JID {
	j := types.NewJID(user, types.HiddenUserServer)
	j.Device = device
	return j
}

// ringingManager monta um CallManager com uma chamada de saída em Ringing e a
// lista de devices do destino já preenchida (como fica após o offer).
func ringingManager(sock core.VoipSocket, callee []types.JID) *CallManager {
	m := NewCallManager(sock, slog.Default())
	m.relay = fakeRelay{}
	call := NewOutgoingCall("CALL1", "62440234549366@lid", "caller@lid", core.CallMediaTypeAudio)
	_ = call.ApplyTransition(Transition{Type: TransitionOfferSent}) // → Ringing
	call.EncryptionKey = make([]byte, 32)
	m.currentCall = call
	m.calleeDevices = callee
	return m
}

func acceptNode(callID string, from types.JID) *waBinary.Node {
	return &waBinary.Node{
		Tag:   "call",
		Attrs: waBinary.Attrs{"from": from},
		Content: []waBinary.Node{{
			Tag:   "accept",
			Attrs: waBinary.Attrs{"call-id": callID, "call-creator": "caller@lid"},
		}},
	}
}

func terminateNode(callID string, from types.JID) *waBinary.Node {
	return &waBinary.Node{
		Tag:   "call",
		Attrs: waBinary.Attrs{"from": from},
		Content: []waBinary.Node{{
			Tag:   "terminate",
			Attrs: waBinary.Attrs{"call-id": callID, "call-creator": "caller@lid"},
		}},
	}
}

// elsewhereDests devolve os jids do <destination> do primeiro terminate
// "accepted_elsewhere" enviado, ou nil se não houve.
func elsewhereDests(sent []waBinary.Node) ([]string, bool) {
	for i := range sent {
		kids := wanode.NodeChildren(&sent[i])
		if len(kids) == 0 {
			continue
		}
		inner := kids[0]
		if inner.Tag != "terminate" || wanode.AttrString(inner.Attrs, "reason") != "accepted_elsewhere" {
			continue
		}
		var dests []string
		for _, c := range wanode.NodeChildren(&inner) {
			if c.Tag != "destination" {
				continue
			}
			for _, to := range wanode.NodeChildren(&c) {
				dests = append(dests, wanode.AttrString(to.Attrs, "jid"))
			}
		}
		return dests, true
	}
	return nil, false
}

func TestStartCallPersistsCalleeDevices(t *testing.T) {
	devs := []types.JID{lidDevice("62440234549366", 0), lidDevice("62440234549366", 33)}
	sock := &deviceSock{devices: devs}
	m := NewCallManager(sock, slog.Default())
	m.relay = fakeRelay{}
	t.Cleanup(m.cleanupMedia)

	if err := m.StartCall(context.Background(), "CALL1", lidDevice("62440234549366", 0), false); err != nil {
		t.Fatalf("start call: %v", err)
	}
	m.mu.Lock()
	got := len(m.calleeDevices)
	m.mu.Unlock()
	if got != 2 {
		t.Fatalf("calleeDevices = %d, want 2", got)
	}
}

func TestCompanionAcceptStopsSiblingDevices(t *testing.T) {
	primary := lidDevice("62440234549366", 0)
	companion := lidDevice("62440234549366", 33)
	sock := &deviceSock{devices: []types.JID{primary, companion}}
	m := ringingManager(sock, []types.JID{primary, companion})

	m.HandleCallAccept(context.Background(), acceptNode("CALL1", companion), companion)

	dests, ok := elsewhereDests(sock.sent)
	if !ok {
		t.Fatalf("nenhum terminate accepted_elsewhere enviado; tags=%v", sock.sentTags())
	}
	if len(dests) != 1 || dests[0] != primary.String() {
		t.Fatalf("destination deve listar só o primary %s, veio %v", primary, dests)
	}
}

func TestAcceptWithoutSiblingsSendsNoElsewhere(t *testing.T) {
	only := lidDevice("62440234549366", 0)
	sock := &deviceSock{devices: []types.JID{only}}
	m := ringingManager(sock, []types.JID{only})

	m.HandleCallAccept(context.Background(), acceptNode("CALL1", only), only)

	if _, ok := elsewhereDests(sock.sent); ok {
		t.Fatal("destino de device único não deve receber accepted_elsewhere")
	}
}

func TestSecondAcceptFromAnotherDeviceIsIgnored(t *testing.T) {
	primary := lidDevice("62440234549366", 0)
	companion := lidDevice("62440234549366", 33)
	sock := &deviceSock{devices: []types.JID{primary, companion}}
	m := ringingManager(sock, []types.JID{primary, companion})

	m.HandleCallAccept(context.Background(), acceptNode("CALL1", companion), companion)
	before := len(sock.sent)
	m.HandleCallAccept(context.Background(), acceptNode("CALL1", primary), primary)

	m.mu.Lock()
	accepted := m.acceptedByJid
	m.mu.Unlock()
	if accepted != companion.String() {
		t.Fatalf("first accept must win: acceptedByJid=%q, want %q", accepted, companion)
	}
	if after := len(sock.sent); after != before {
		t.Fatalf("accept duplicado não deve enviar stanzas: %d -> %d", before, after)
	}
}

func TestSameDeviceAcceptRetryDoesNotRepeatElsewhereFanout(t *testing.T) {
	primary := lidDevice("62440234549366", 0)
	companion := lidDevice("62440234549366", 33)
	sock := &deviceSock{devices: []types.JID{primary, companion}}
	m := ringingManager(sock, []types.JID{primary, companion})

	m.HandleCallAccept(context.Background(), acceptNode("CALL1", companion), companion)
	m.HandleCallAccept(context.Background(), acceptNode("CALL1", companion), companion)

	elsewheres := 0
	for i := range sock.sent {
		kids := wanode.NodeChildren(&sock.sent[i])
		if len(kids) > 0 && wanode.AttrString(kids[0].Attrs, "reason") == "accepted_elsewhere" {
			elsewheres++
		}
	}
	if elsewheres != 1 {
		t.Fatalf("fan-out elsewhere deve sair exatamente uma vez, veio %d", elsewheres)
	}
}

func TestLateRejectFromNonAnsweringDeviceKeepsCall(t *testing.T) {
	primary := lidDevice("62440234549366", 0)
	companion := lidDevice("62440234549366", 33)
	sock := &deviceSock{devices: []types.JID{primary, companion}}
	m := ringingManager(sock, []types.JID{primary, companion})

	m.HandleCallAccept(context.Background(), acceptNode("CALL1", companion), companion)
	m.HandleCallTerminate(terminateNode("CALL1", primary))
	if m.CurrentCall().IsEnded() {
		t.Fatal("terminate do device que não atendeu não pode encerrar a chamada")
	}

	m.HandleCallTerminate(terminateNode("CALL1", companion))
	if !m.CurrentCall().IsEnded() {
		t.Fatal("terminate do device que atendeu deve encerrar a chamada")
	}
}

func TestOfferAckAdvertisesRelayLatency(t *testing.T) {
	primary := lidDevice("62440234549366", 0)
	companion := lidDevice("62440234549366", 33)
	sock := &deviceSock{devices: []types.JID{primary, companion}}
	m := ringingManager(sock, []types.JID{primary, companion})

	m.HandleCallAck(context.Background(), &waBinary.Node{
		Tag:   "ack",
		Attrs: waBinary.Attrs{"type": "offer"},
		Content: []waBinary.Node{
			{
				Tag: "user",
				Content: []waBinary.Node{
					{Tag: "device", Attrs: waBinary.Attrs{"jid": "999:0@lid"}},
					{Tag: "device", Attrs: waBinary.Attrs{"jid": companion.String()}},
				},
			},
			{
				Tag: "relay",
				Content: []waBinary.Node{
					{Tag: "key", Content: []byte("relay-key")},
					{Tag: "token", Attrs: waBinary.Attrs{"id": "0"}, Content: []byte{0xaa}},
					{
						Tag: "te2",
						Attrs: waBinary.Attrs{
							"token_id": "0", "relay_name": "relay-A",
							"protocol": "0", "c2r_rtt": "7",
						},
						Content: []byte{57, 144, 1, 2, 0x0d, 0x96},
					},
				},
			},
		},
	})

	for i := range sock.sent {
		children := wanode.NodeChildren(&sock.sent[i])
		if len(children) == 0 || children[0].Tag != "relaylatency" {
			continue
		}
		if wanode.AttrString(sock.sent[i].Attrs, "id") == "" {
			t.Fatal("relaylatency call wrapper must carry an id")
		}
		inner := children[0]
		var foundRelay, foundDestination bool
		for _, child := range wanode.NodeChildren(&inner) {
			switch child.Tag {
			case "te":
				foundRelay = wanode.AttrString(child.Attrs, "relay_name") == "relay-A" &&
					wanode.AttrString(child.Attrs, "latency") == "33554439"
			case "destination":
				foundDestination = len(wanode.NodeChildren(&child)) == 2
			}
		}
		if !foundRelay || !foundDestination {
			t.Fatalf("relaylatency missing relay or destination: %#v", inner)
		}
		return
	}
	t.Fatal("offer ack did not send relaylatency")
}
