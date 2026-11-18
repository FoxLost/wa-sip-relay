import { apiGet, apiPost, apiDelete } from "@/lib/api";

export type McpKey = {
  id: string;
  name: string;
  /** Prefix used to recognize a key; the full key is returned only at creation. */
  prefix: string;
  readOnly: boolean;
  createdAt: string;
  lastUsedAt?: string;
};

export type McpKeyCreated = {
  key: McpKey;
  /** Full key, returned once. */
  secret: string;
  /** MCP endpoint used with Authorization: Bearer <secret>. */
  endpoint: string;
  /** Complete URL for clients that accept only a URL. */
  url: string;
};

export const listMcpKeys = (sid: string) =>
  apiGet<{ keys: McpKey[]; max: number; endpoint: string }>(`/api/sessions/${sid}/mcp-keys`);

export const createMcpKey = (sid: string, body: { name: string; readOnly: boolean }) =>
  apiPost<McpKeyCreated>(`/api/sessions/${sid}/mcp-keys`, body);

export const deleteMcpKey = (sid: string, id: string) => apiDelete(`/api/sessions/${sid}/mcp-keys/${id}`);
