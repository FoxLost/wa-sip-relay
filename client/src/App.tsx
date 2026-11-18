import { useEffect, useState, type FormEvent } from "react";
import { Loader2, LogOut, PlusCircle, RefreshCw, Trash2 } from "lucide-react";
import { toast, Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LanguageSelector } from "@/components/shared/LanguageSelector";
import { SessionPairing } from "@/components/domain/session/SessionPairing";
import { RelayDashboard } from "@/pages/RelayDashboard";
import { createSession, deleteSession, logoutSession, pairSession } from "@/services/sessions";
import {
  ensureSessionsWired,
  refreshSessions,
  setActiveSession,
  useSessions,
} from "@/stores/sessions";
import { useTheme } from "@/stores/theme";
import { phoneFromJid } from "@/utils/format";
import { apiGet } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

type RelayConfig = {
  maxAccounts: number;
};

export const App = () => {
  const { t } = useLanguage();
  const sessions = useSessions((state) => state.sessions);
  const activeId = useSessions((state) => state.activeId);
  const theme = useTheme((state) => state.theme);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [maxAccounts, setMaxAccounts] = useState(5);

  useEffect(() => {
    ensureSessionsWired();
    void apiGet<RelayConfig>("/api/config")
      .then((config) => setMaxAccounts(config.maxAccounts))
      .catch(() => {});
  }, []);

  const session = sessions.find((item) => item.id === activeId) ?? sessions[0] ?? null;
  const atLimit = maxAccounts > 0 && sessions.length >= maxAccounts;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Operation failed"));
    } finally {
      setBusy(false);
    }
  };

  const createAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = accountName.trim() || `WhatsApp ${sessions.length + 1}`;
    await run(async () => {
      const created = await createSession(name);
      await refreshSessions();
      setActiveSession(created.id);
      setAccountName("");
      setCreateOpen(false);
      toast.success(t("{{name}} created", { name }));
    });
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen bg-background text-foreground">
        <header className="border-b">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4">
            <div>
              <h1 className="text-xl font-semibold">WA SIP Relay</h1>
              <p className="text-sm text-muted-foreground">{t("WhatsApp voice accounts bridged to SIP.")}</p>
            </div>
            <div className="flex items-center gap-2">
              <LanguageSelector />
              <Button
                size="sm"
                disabled={busy || atLimit}
                onClick={() => setCreateOpen(true)}
                title={atLimit ? t("Account limit reached ({{count}})", { count: maxAccounts }) : undefined}
              >
                <PlusCircle className="h-4 w-4" /> {t("Add account")}
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6">
          {!sessions.length ? (
            <div className="mx-auto flex max-w-lg flex-col items-center gap-4 rounded-xl border p-8 text-center">
              <PlusCircle className="h-8 w-8 text-muted-foreground" />
              <div>
                <h2 className="font-medium">{t("Create a WhatsApp relay account")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("Each linked account receives independent SIP credentials and routing.")}
                </p>
              </div>
              <Button disabled={busy || atLimit} onClick={() => setCreateOpen(true)}>
                <PlusCircle className="h-4 w-4" /> {t("Create account")}
              </Button>
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
              <aside className="h-fit space-y-3 rounded-xl border p-3">
                <div className="flex items-center justify-between px-1">
                  <div className="text-sm font-medium">{t("WhatsApp accounts")}</div>
                  <div className="text-xs text-muted-foreground">
                    {sessions.length}{maxAccounts > 0 ? ` / ${maxAccounts}` : ""}
                  </div>
                </div>
                <div className="space-y-1">
                  {sessions.map((item) => {
                    const selected = item.id === session?.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setActiveSession(item.id)}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                          selected ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"
                        }`}
                      >
                        <div className="truncate text-sm font-medium">{item.name}</div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-muted-foreground">
                            {phoneFromJid(item.jid || item.lastJid) || t("Not linked")}
                          </span>
                          <Badge variant={item.paired ? "success" : "secondary"}>
                            {item.paired ? t("Online") : t("Pair")}
                          </Badge>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </aside>

              {session ? (
                <section className="min-w-0 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="font-medium">{session.name}</div>
                        <Badge variant={session.paired ? "success" : "secondary"}>
                          {session.paired ? t("WhatsApp connected") : t("Pairing required")}
                        </Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {phoneFromJid(session.jid || session.lastJid) || t("No linked number")}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {session.paired ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void run(() => logoutSession(session.id))}
                        >
                          <LogOut className="h-4 w-4" /> {t("Unlink")}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void run(() => pairSession(session.id))}
                        >
                          <RefreshCw className="h-4 w-4" /> {t("Pair")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(t("Delete {{name}} and its stored WhatsApp device?", { name: session.name }))) {
                            void run(() => deleteSession(session.id));
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" /> {t("Delete")}
                      </Button>
                    </div>
                  </div>
                  {session.paired ? <RelayDashboard session={session} /> : <SessionPairing session={session} />}
                </section>
              ) : (
                <div className="flex min-h-64 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form className="space-y-4" onSubmit={(event) => void createAccount(event)}>
            <DialogHeader>
              <DialogTitle>{t("Add WhatsApp account")}</DialogTitle>
              <DialogDescription>
                {t("A separate QR code and SIP identity will be generated for this account.")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="account-name">{t("Account name")}</Label>
              <Input
                id="account-name"
                value={accountName}
                maxLength={64}
                autoFocus
                placeholder={`WhatsApp ${sessions.length + 1}`}
                onChange={(event) => setAccountName(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setCreateOpen(false)}>
                {t("Cancel")}
              </Button>
              <Button type="submit" disabled={busy || atLimit}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
                {t("Create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Toaster theme={theme} position="top-right" richColors closeButton />
    </TooltipProvider>
  );
};
