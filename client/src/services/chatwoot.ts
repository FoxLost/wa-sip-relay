import { apiGet, apiPost, apiDelete } from "@/lib/api";

export type ChatwootConfig = {
  url: string;
  account_id: number;
  account_token?: string;
  inbox_id: number;
  inbox_identifier: string;
  /** Mirror API-sent messages to Chatwoot as private notes. */
  mirror_api?: boolean;
  /** Import conversation history from HistorySync when the account connects. */
  import_history?: boolean;
  /** History window in days; zero uses the default. */
  import_history_days?: number;
};

export const getChatwoot = (sid: string) =>
  apiGet<{ enabled: boolean; chatwoot: ChatwootConfig }>(`/api/sessions/${sid}/chatwoot`);

export const setChatwoot = (sid: string, cfg: ChatwootConfig) =>
  apiPost(`/api/sessions/${sid}/chatwoot`, cfg);

export const deleteChatwoot = (sid: string) => apiDelete(`/api/sessions/${sid}/chatwoot`);
