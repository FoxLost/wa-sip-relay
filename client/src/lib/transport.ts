/**
 * Call media transport selection.
 *
 * Available transports:
 *   - "webrtc" (default): Opus audio and H264 video through RTCPeerConnection and UDP.
 *   - "websocket": PCM16 audio through WSS, suitable for reverse proxies that block UDP.
 *
 * Selection priority:
 *   1. URL query parameter: ?transport=ws or ?transport=webrtc
 *   2. localStorage: wacalls.transport = "websocket" | "webrtc"
 *   3. "auto"
 *
 * Auto mode tries WebRTC first and falls back to audio-only WebSocket when ICE cannot connect.
 * An explicit query parameter disables fallback.
 */

export type Transport = "webrtc" | "websocket";

const STORAGE_KEY = "wacalls.transport";

function normalize(v: string | null): Transport | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (s === "ws" || s === "websocket") return "websocket";
  if (s === "webrtc" || s === "rtc") return "webrtc";
  return null;
}

/**
 * Transport mode that distinguishes an explicit choice from automatic selection.
 * Explicit WebRTC or WebSocket may come from the query parameter or localStorage.
 * Auto tries WebRTC first and falls back to WebSocket when UDP is unavailable.
 */
export type TransportMode = "webrtc" | "websocket" | "auto";

export function getTransportMode(): TransportMode {
  try {
    const fromQuery = normalize(new URLSearchParams(window.location.search).get("transport"));
    if (fromQuery) return fromQuery;
  } catch {
    /* window.location is unavailable */
  }
  try {
    const fromStore = normalize(localStorage.getItem(STORAGE_KEY));
    if (fromStore) return fromStore;
  } catch {
    /* localStorage is unavailable */
  }
  // Server default injected through WACALLS_DEFAULT_TRANSPORT. Query and localStorage values
  // take precedence over this per-instance setting.
  try {
    const fromServer = normalize((window as unknown as { __WACALLS_DEFAULT_TRANSPORT?: string }).__WACALLS_DEFAULT_TRANSPORT ?? null);
    if (fromServer) return fromServer;
  } catch {
    /* ignore invalid server defaults */
  }
  return "auto";
}

/** Return the selected transport, preferring the query parameter over localStorage. */
export function getTransport(): Transport {
  try {
    const fromQuery = normalize(new URLSearchParams(window.location.search).get("transport"));
    if (fromQuery) return fromQuery;
  } catch {
    /* window.location is unavailable */
  }
  try {
    const fromStore = normalize(localStorage.getItem(STORAGE_KEY));
    if (fromStore) return fromStore;
  } catch {
    /* localStorage is unavailable */
  }
  return "webrtc";
}

/** Persist the transport for future calls. */
export function setTransport(t: Transport): void {
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    /* ignore */
  }
}

/** Remove the persisted preference and return to WebRTC. */
export function clearTransport(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
