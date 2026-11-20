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
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setBusy(true);
    setErr("");
    const base = url.replace(/\/+$/, "");
    try {
      const r = await fetch(`${base}/api/config`, { headers: { "X-API-Key": password } });
      if (!r.ok) {
        setErr(r.status === 401 ? t("Invalid password") : t("Error {{status}}", { status: r.status }));
        return;
      }
      setAuth(base, password);
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
          <p className="text-sm text-muted-foreground">{t("Sign in with the administration password.")}</p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://relay.example.com" />
          </div>
          <div className="space-y-1">
            <Label>{t("Administration password")}</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              autoComplete="current-password"
              placeholder={t("Enter your password")}
            />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <Button className="w-full" disabled={busy || !password} onClick={submit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("Sign in")}
          </Button>
        </div>
      </div>
    </div>
  );
};
