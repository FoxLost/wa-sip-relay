# WA SIP Relay

WA SIP Relay bridges one linked WhatsApp account to SIP phones or an external PBX.
It is derived from [AstraCalls](https://github.com/AstraOnlineWeb/AstraCalls) and
keeps the proven WhatsApp call signaling, MLow media path, SIP registrar, and SIP
UAC registration flow.

## Scope

- Incoming WhatsApp call to SIP phone or PBX.
- Outgoing SIP call to a WhatsApp number.
- Direct SIP registrar mode.
- External PBX registration mode.
- PCMU and PCMA (G.711) with RFC 4733 telephone events.
- Persistent relay call history.
- WhatsApp contact feeds for Grandstream XML, vCard, and JSON.
- Docker builds for amd64 and arm64.

Messaging, browser calling, video, group calling, recording, Chatwoot, automation,
and AI integrations are outside the relay product scope.

## Codec policy

PCMU and PCMA are enabled because they are supported by almost every SIP phone and
PBX and have the lowest transcoding cost. WhatsApp uses MLow audio, so every SIP
codec requires conversion; no standard SIP codec can be passed through unchanged.

G.729, G.723.1, iLBC, G.726, Opus, and G.722 are deliberately not advertised.
Advertising a codec without a tested encoder and decoder would cause one-way or
silent audio. A PBX can transcode an endpoint that does not support G.711.

## SIP modes

### Direct registrar

Configure the phone with the relay host as its SIP server. The session SIP
username and password are available from the authenticated administration API and
panel. SIP uses UDP or TCP port 5060. RTP uses UDP ports 40000 through 40049 by
default.

### External PBX

The relay can register one WhatsApp session as an extension on an external PBX.
Configure the PBX host, port, extension, authentication ID, password, destination,
and optional outbound proxy in the SIP settings.

The two routing models should not be enabled for the same endpoint.

## Call history

Completed calls are persisted in PostgreSQL and returned by:

```text
GET /api/sessions/{sessionId}/history
```

This records calls handled by the relay from the time it is installed. WhatsApp
does not expose the account's old native call log, so historical calls from before
installation cannot be imported. Calls routed through a SIP phone also appear in
that phone's normal local call log.

## Phonebook feeds

The relay reads known WhatsApp contacts, discards unresolved LID-only identities,
deduplicates real phone numbers, and publishes:

```text
GET /phonebook/{sessionId}/grandstream.xml?token=...
GET /phonebook/{sessionId}/contacts.vcf?token=...
GET /phonebook/{sessionId}/contacts.json?token=...
```

Retrieve the authenticated feed URLs from:

```text
GET /api/sessions/{sessionId}/phonebook
```

Configure `grandstreamXmlUrl` as the remote phonebook URL on a Grandstream phone.
The URL token is scoped to the session and derived from `WACALLS_API_KEY`.

## Runtime configuration

Required:

```text
WACALLS_API_KEY       strong administration API key
WACALLS_PG_URL        PostgreSQL maintenance URL; the role needs CREATEDB
WACALLS_PUBLIC_IP     LAN or public address advertised in SIP and RTP
```

Relevant defaults:

```text
HTTP                  0.0.0.0:8080
SIP UDP/TCP           0.0.0.0:5060
RTP UDP               40000-40049
maximum calls         1 per WhatsApp session
```

Use host networking for SIP and RTP:

```bash
git submodule update --init --recursive
docker build -t wa-sip-relay:local .
docker run --rm --network host \
  -e WACALLS_API_KEY='replace-me' \
  -e WACALLS_PG_URL='postgres://relay:password@127.0.0.1:5432/postgres?sslmode=disable' \
  -e WACALLS_PUBLIC_IP='192.168.1.10' \
  wa-sip-relay:local
```

Do not publish SIP, RTP, PostgreSQL, or the administration UI directly to the
internet. Restrict SIP and RTP to a trusted LAN or VPN.

## Development

The live media build requires the `opus_mlow` submodule and cgo:

```bash
git submodule update --init --recursive
go test ./cmd/server ./internal/voip/call
docker build -t wa-sip-relay:local .
```

## License and upstream

WA SIP Relay is a modified network service based on AstraCalls and is licensed as
a whole under GNU AGPL-3.0. Modified source must be offered to users who interact
with the service over a network. The original WaCalls MIT notice is preserved in
[`LICENSE.WaCalls`](LICENSE.WaCalls).

This repository is independent and is not an official AstraCalls distribution.
