const URL_KEY = "wacalls.apiUrl";
const SECRET_KEY = "wacalls.webPassword";
const LEGACY_KEY = "wacalls.apiKey";

export const getApiBase = (): string => (localStorage.getItem(URL_KEY) || "").replace(/\/+$/, "");
export const getAuthSecret = (): string => localStorage.getItem(SECRET_KEY) || "";
export const isAuthed = (): boolean => getAuthSecret() !== "";

export const setAuth = (url: string, secret: string): void => {
  localStorage.setItem(URL_KEY, url.replace(/\/+$/, ""));
  localStorage.setItem(SECRET_KEY, secret);
  localStorage.removeItem(LEGACY_KEY);
};

export const clearAuth = (): void => {
  localStorage.removeItem(SECRET_KEY);
  localStorage.removeItem(LEGACY_KEY);
};

export const apiUrl = (path: string): string => getApiBase() + path;

// Verify that the backend accepts the stored administration credential.
export const checkAuth = async (): Promise<boolean> => {
  try {
    const r = await fetch(apiUrl("/api/config"), { headers: { "X-API-Key": getAuthSecret() } });
    return r.ok;
  } catch {
    return false;
  }
};
