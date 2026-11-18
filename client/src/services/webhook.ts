import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";

export type WebhookState = {
  state: "closed" | "open" | "disabled";
  consecutiveFailures: number;
  disabledReason?: string;
};

export type WebhookItem = {
  id: string;
  name: string;
  url: string;
  /** Whether a secret is configured; the value is never returned. */
  hasSecret: boolean;
  /** Event filter; empty means all events. */
  events: string[];
  /** Do not deliver group events. */
  ignoreGroups: boolean;
  status: WebhookState;
};

export type WebhookInput = {
  name: string;
  url: string;
  /** Omitted keeps the current secret; an empty string removes it. */
  secret?: string;
  events: string[];
  ignoreGroups: boolean;
};

export const listWebhooks = (sid: string) =>
  apiGet<{ webhooks: WebhookItem[]; max: number }>(`/api/sessions/${sid}/webhooks`);

export const createWebhook = (sid: string, body: WebhookInput) =>
  apiPost<WebhookItem>(`/api/sessions/${sid}/webhooks`, body);

export const updateWebhook = (sid: string, id: string, body: WebhookInput) =>
  apiPut<WebhookItem>(`/api/sessions/${sid}/webhooks/${id}`, body);

export const deleteWebhook = (sid: string, id: string) => apiDelete(`/api/sessions/${sid}/webhooks/${id}`);

export const testWebhook = (sid: string, id: string) =>
  apiPost<{ ok: boolean; status: number; error?: string }>(`/api/sessions/${sid}/webhooks/${id}/test`, {});

export const reenableWebhook = (sid: string, id: string) =>
  apiPost(`/api/sessions/${sid}/webhooks/reenable?webhookId=${encodeURIComponent(id)}`, {});
