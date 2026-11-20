import { apiPost, apiDelete } from "@/lib/api";
import { getClientId } from "@/lib/client-id";
import { apiUrl, getAuthSecret } from "@/lib/auth";

export const startCall = (sid: string, phone: string, record: boolean, video: boolean) =>
  apiPost<{ call: { callId: string } }>(`/api/sessions/${sid}/calls`, {
    phone,
    duration_ms: 300_000,
    record,
    video,
  });

export const acceptCall = (sid: string, callId: string) =>
  apiPost<{ call: { callId: string } }>(`/api/sessions/${sid}/calls/${callId}/accept`, {});

export const rejectCall = async (sid: string, callId: string): Promise<void> => {
  const r = await fetch(apiUrl(`/api/sessions/${sid}/calls/${callId}/reject`), {
    method: "POST",
    headers: { "X-Client-Id": getClientId(), "X-API-Key": getAuthSecret(), "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) throw new Error(`reject ${r.status}`);
};

export const endCall = (sid: string, callId: string) =>
  apiDelete(`/api/sessions/${sid}/calls/${callId}`);

// Hold keeps the call leg alive and optionally plays music to the remote party.
export const holdCall = (sid: string, callId: string, moh = true) =>
  apiPost(`/api/sessions/${sid}/calls/${callId}/hold`, { moh });

export const resumeCall = (sid: string, callId: string) =>
  apiPost(`/api/sessions/${sid}/calls/${callId}/resume`, {});

// Blind transfer to an optional operator client ID, or to every account operator when omitted.
// pickupCall takes ownership without accepting the WhatsApp call again.
export const transferCall = (sid: string, callId: string, to?: string) =>
  apiPost(`/api/sessions/${sid}/calls/${callId}/transfer`, to ? { to } : {});

export const pickupCall = (sid: string, callId: string) =>
  apiPost<{ call: { callId: string } }>(`/api/sessions/${sid}/calls/${callId}/pickup`, {});

export type VideoAction = "request" | "accept" | "reject" | "stop";

// Request, accept, reject, or stop mid-call video.
export const callVideo = (sid: string, callId: string, action: VideoAction) =>
  apiPost(`/api/sessions/${sid}/calls/${callId}/video/${action}`, {});
