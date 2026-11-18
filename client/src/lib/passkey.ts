// Bridge between the panel and the AstraCalls Passkey Connector extension.
//
// Passkey-protected accounts require WebAuthn proof from web.whatsapp.com. The extension runs
// that assertion and this panel sends the resulting signature to POST /pair-passkey.

const PANEL = "astracalls-panel";
const EXT = "astracalls-ext";

export type WebAuthnPublicKey = {
  challenge: string;
  timeout?: number;
  rpId: string;
  allowCredentials?: Array<{ id: string; type?: string; transports?: string[] }>;
  userVerification?: string;
  extensions?: Record<string, unknown>;
};

export type WebAuthnAssertion = {
  id: string;
  rawId: string;
  type: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
};

let extReady = false;

// The extension announces its presence with a READY message when it loads.
if (typeof window !== "undefined") {
  window.addEventListener("message", (e) => {
    if (e.source === window && (e.data?.source === EXT) && e.data?.type === "READY") {
      extReady = true;
    }
  });
}

function rid(): string {
  return "pk_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Ping the extension and wait briefly for PONG.
export function isExtensionInstalled(timeoutMs = 600): Promise<boolean> {
  if (extReady) return Promise.resolve(true);
  return new Promise((resolve) => {
    const requestId = rid();
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMsg);
      resolve(false);
    }, timeoutMs);
    function onMsg(e: MessageEvent) {
      if (e.source !== window) return;
      const d = e.data;
      if (d?.source === EXT && d?.type === "PONG" && d?.requestId === requestId) {
        clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        extReady = true;
        resolve(true);
      }
    }
    window.addEventListener("message", onMsg);
    window.postMessage({ source: PANEL, type: "PING", requestId }, window.location.origin);
  });
}

// Ask the extension for a WebAuthn assertion and resolve with the signature or reject with its error.
export function runPasskeyAssertion(publicKey: WebAuthnPublicKey): Promise<WebAuthnAssertion> {
  return new Promise((resolve, reject) => {
    const requestId = rid();
    function onMsg(e: MessageEvent) {
      if (e.source !== window) return;
      const d = e.data;
      if (d?.source === EXT && d?.type === "PASSKEY_ASSERTION_RESULT" && d?.requestId === requestId) {
        window.removeEventListener("message", onMsg);
        if (d.ok && d.assertion) resolve(d.assertion as WebAuthnAssertion);
        else reject(new Error(d.error || "passkey assertion failed"));
      }
    }
    window.addEventListener("message", onMsg);
    window.postMessage({ source: PANEL, type: "RUN_PASSKEY_ASSERTION", requestId, publicKey }, window.location.origin);
  });
}

// Extension archive served by the backend on the same origin.
export const EXTENSION_DOWNLOAD_URL = "/astracalls-passkey.zip";
