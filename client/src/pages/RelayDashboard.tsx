import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Network, PhoneCall, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HistoryDrawer } from "@/components/domain/history/HistoryDrawer";
import { SIPDialog } from "@/components/domain/session/SIPDialog";
import { apiGet } from "@/lib/api";
import type { SessionInfo } from "@/types/session";

type SIPRegistration = {
  sip_user: string;
  session_id: string;
  contact: string;
};

type SIPStatus = {
  enabled: boolean;
  registrations?: SIPRegistration[];
  active_calls?: unknown[];
};

type PhonebookFeeds = {
  grandstreamXmlUrl: string;
  vcardUrl: string;
  jsonUrl: string;
};

const copy = async (value: string): Promise<void> => {
  await navigator.clipboard.writeText(value);
  toast.success("Copied");
};

export const RelayDashboard = ({ session }: { session: SessionInfo }) => {
  const [status, setStatus] = useState<SIPStatus | null>(null);
  const [feeds, setFeeds] = useState<PhonebookFeeds | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const [nextStatus, nextFeeds] = await Promise.all([
        apiGet<SIPStatus>("/api/sip/status"),
        apiGet<PhonebookFeeds>(`/api/sessions/${session.id}/phonebook`),
      ]);
      setStatus(nextStatus);
      setFeeds(nextFeeds);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load relay status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void apiGet<SIPStatus>("/api/sip/status").then(setStatus).catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
  }, [session.id]);

  const registrations = status?.registrations?.filter((item) => item.session_id === session.id) ?? [];
  const activeCalls = status?.active_calls?.length ?? 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Network className="h-5 w-5" /> SIP relay
              </CardTitle>
              <CardDescription>Direct registrar or external PBX registration.</CardDescription>
            </div>
            <Button size="icon" variant="ghost" onClick={() => void refresh()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant={status?.enabled ? "success" : "destructive"}>
              {status?.enabled ? "SIP listener ready" : "SIP listener unavailable"}
            </Badge>
            <Badge variant={registrations.length ? "success" : "secondary"}>
              {registrations.length ? `${registrations.length} registered endpoint` : "No registered endpoint"}
            </Badge>
            <Badge variant={activeCalls ? "success" : "muted"}>{activeCalls} active call</Badge>
          </div>
          {registrations.map((registration) => (
            <div key={registration.contact} className="rounded-lg border p-3 text-sm">
              <div className="font-medium">{registration.sip_user}</div>
              <div className="break-all text-muted-foreground">{registration.contact}</div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <SIPDialog session={session} />
            <HistoryDrawer sid={session.id} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> Remote phonebook
          </CardTitle>
          <CardDescription>WhatsApp contacts with resolved telephone numbers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {feeds ? (
            <>
              <Feed label="Grandstream XML" value={feeds.grandstreamXmlUrl} />
              <Feed label="vCard" value={feeds.vcardUrl} />
              <Feed label="JSON" value={feeds.jsonUrl} />
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading phonebook URLs
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PhoneCall className="h-5 w-5" /> Routing behavior
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <div className="rounded-lg border p-3">
            <div className="font-medium">WhatsApp to SIP</div>
            <div className="text-muted-foreground">The WhatsApp call is accepted only after the SIP endpoint answers.</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="font-medium">SIP to WhatsApp</div>
            <div className="text-muted-foreground">Dial an international number without the plus sign, for example 628123456789.</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const Feed = ({ label, value }: { label: string; value: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1 rounded-lg border p-3">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{value}</code>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            void copy(value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
};
