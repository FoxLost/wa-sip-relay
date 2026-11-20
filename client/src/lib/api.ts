import { getClientId } from "./client-id";
import { apiUrl, getAuthSecret, clearAuth } from "./auth";

const baseHeaders = (): HeadersInit => ({
  "X-Client-Id": getClientId(),
  "X-API-Key": getAuthSecret(),
  "Content-Type": "application/json",
});

// Clear expired or invalid authentication and return to the login screen after a 401.
const guard = (status: number) => {
  if (status === 401) {
    clearAuth();
    location.reload();
  }
};

const responseError = async (response: Response, fallback: string): Promise<Error> => {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error) return new Error(parsed.error);
  } catch {
    // Keep the raw response as diagnostic context when it is not JSON.
  }
  return new Error(text ? `${fallback}: ${text}` : fallback);
};

export const apiGet = async <T>(path: string): Promise<T> => {
  const r = await fetch(apiUrl(path), { headers: baseHeaders() });
  if (!r.ok) {
    guard(r.status);
    throw new Error(`${path} ${r.status}`);
  }
  return r.json() as Promise<T>;
};

export const apiPost = async <T>(path: string, body: unknown): Promise<T> => {
  const r = await fetch(apiUrl(path), { method: "POST", headers: baseHeaders(), body: JSON.stringify(body) });
  if (!r.ok) {
    guard(r.status);
    throw await responseError(r, `${path} ${r.status}`);
  }
  return r.json() as Promise<T>;
};

export const apiPut = async <T>(path: string, body: unknown): Promise<T> => {
  const r = await fetch(apiUrl(path), { method: "PUT", headers: baseHeaders(), body: JSON.stringify(body) });
  if (!r.ok) {
    guard(r.status);
    throw await responseError(r, `${path} ${r.status}`);
  }
  return r.json() as Promise<T>;
};

export const apiDelete = async (path: string): Promise<void> => {
  const r = await fetch(apiUrl(path), { method: "DELETE", headers: baseHeaders() });
  if (!r.ok) {
    guard(r.status);
    throw new Error(`${path} ${r.status}`);
  }
};
