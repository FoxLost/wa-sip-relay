import { apiGet, apiPost } from "@/lib/api";

export type GroupInfo = {
  jid: string;
  name: string;
  participants?: unknown[];
};

// List groups available to this session.
export const listGroups = (sid: string) =>
  apiGet<{ groups?: GroupInfo[] } | GroupInfo[]>(`/api/sessions/${sid}/groups`).then((r) =>
    Array.isArray(r) ? r : (r.groups ?? []),
  );

// Start a group call and ring group members.
export const startGroupCall = (sid: string, groupJid: string, video = false) =>
  apiPost<{ callId: string; targets: number }>(`/api/sessions/${sid}/calls/group`, { groupJid, video });

// End the active group call.
export const endGroupCall = (sid: string) =>
  apiPost<unknown>(`/api/sessions/${sid}/calls/group/end`, {});

export type RosterEntry = { phone: string; name: string };

// Resolve active group-call participant LIDs to phone numbers and names for video labels.
export const getGroupRoster = (sid: string) =>
  apiGet<{ roster: Record<string, RosterEntry> }>(`/api/sessions/${sid}/calls/group/roster`).then(
    (r) => r.roster ?? {},
  );
