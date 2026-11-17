import { useEffect, useState } from "react";
import { Loader2, LogOut, PlusCircle, RefreshCw, Trash2 } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SessionPairing } from "@/components/domain/session/SessionPairing";
import { RelayDashboard } from "@/pages/RelayDashboard";
import { createSession, deleteSession, logoutSession, pairSession } from "@/services/sessions";
import { ensureSessionsWired, useSessions } from "@/stores/sessions";
import { useTheme } from "@/stores/theme";
import { phoneFromJid } from "@/utils/format";

export const App = () => {
  const sessions = useSessions((state) => state.sessions);
  const theme = useTheme((state) => state.theme);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ensureSessionsWired();
  }, []);

  const session = sessions[0] ?? null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen bg-background text-foreground">
        <header className="border-b">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
            <div>
              <h1 className="text-xl font-semibold">WA SIP Relay</h1>
              <p className="text-sm text-muted-foreground">WhatsApp voice calls bridged to SIP.</p>
            </div>
            {session && (
              <div className="flex items-center gap-2">
                <Badge variant={session.paired ? "success" : "secondary"}>
                  {session.paired ? "WhatsApp connected" : "Pairing required"}
                </Badge>
                {session.paired ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run(() => logoutSession(session.id))}
                  >
                    <LogOut className="h-4 w-4" /> Unlink
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run(() => pairSession(session.id))}
                  >
                    <RefreshCw className="h-4 w-4" /> Pair
                  </Button>
                )}
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
          {!session ? (
            <div className="mx-auto flex max-w-lg flex-col items-center gap-4 rounded-xl border p-8 text-center">
              <PlusCircle className="h-8 w-8 text-muted-foreground" />
              <div>
                <h2 className="font-medium">Create the WhatsApp relay account</h2>
                <p className="text-sm text-muted-foreground">One linked WhatsApp account is supported.</p>
              </div>
              <Button disabled={busy} onClick={() => void run(() => createSession("WhatsApp Relay"))}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
                Create account
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                <div>
                  <div className="font-medium">{session.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {phoneFromJid(session.jid || session.lastJid) || "No linked number"}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Delete the relay account and its stored WhatsApp device?")) {
                      void run(() => deleteSession(session.id));
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" /> Reset account
                </Button>
              </div>
              {session.paired ? <RelayDashboard session={session} /> : <SessionPairing session={session} />}
            </>
          )}
        </main>
      </div>
      <Toaster theme={theme} position="top-right" richColors closeButton />
    </TooltipProvider>
  );
};
