import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LanguageSelector } from "@/components/shared/LanguageSelector";
import { useLanguage } from "@/lib/i18n";
import { setAuth } from "@/lib/auth";

export const LoginScreen = ({ onSuccess }: { onSuccess: () => void }) => {
  const { t } = useLanguage();
  const [url, setUrl] = useState(window.location.origin);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setBusy(true);
    setErr("");
    const base = url.replace(/\/+$/, "");
    try {
      const r = await fetch(`${base}/api/config`, { headers: { "X-API-Key": key } });
      if (!r.ok) {
        setErr(r.status === 401 ? t("Invalid API key") : t("Error {{status}}", { status: r.status }));
        return;
      }
      setAuth(base, key);
      onSuccess();
    } catch {
      setErr(t("Could not connect to the provided URL"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border bg-card p-7 shadow-soft">
        <div className="flex justify-end">
          <LanguageSelector />
        </div>
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">WA SIP Relay</h1>
          <p className="text-sm text-muted-foreground">{t("Sign in with the server URL and API key.")}</p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://relay.example.com" />
          </div>
          <div className="space-y-1">
            <Label>{t("API key")}</Label>
            <Input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder={t("your API key")}
            />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <Button className="w-full" disabled={busy || !key.trim()} onClick={submit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("Sign in")}
          </Button>
        </div>
      </div>
    </div>
  );
};
