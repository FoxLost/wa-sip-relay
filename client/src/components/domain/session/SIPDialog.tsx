import { useEffect, useState, type ReactNode } from "react";
import { Phone, Copy, Check, Eye, EyeOff, Loader2, Server, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getSIPExt, setSIPExt, type SIPExtConfig } from "@/services/sessions";
import type { SessionInfo } from "@/types/session";

const SIP_PORT = 5060;

type Field = "user" | "pass" | "server" | "domain";
type Tab = "server" | "external";

const emptyExt: SIPExtConfig = {
  enabled: false,
  host: "",
  port: SIP_PORT,
  user: "",
  authUser: "",
  pass: "",
  dest: "",
  proxy: "",
  inboundMode: "originate",
  agentAutoAnswer: false,
};


const StatusBadge = ({ status, error }: { status?: string; error?: string }) => {
  if (!status) return null;
  const map: Record<string, { label: string; cls: string }> = {
    registered: { label: "Registered", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
    registering: { label: "Registering…", cls: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
    failed: { label: "Failed", cls: "bg-red-500/15 text-red-600 border-red-500/30" },
  };
  const s = map[status] ?? { label: status, cls: "" };
  return (
    <Badge variant="outline" className={cn("font-normal", s.cls)} title={error || undefined}>
      {s.label}
    </Badge>
  );
};

export const SIPDialog = ({ session }: { session: SessionInfo }) => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("server");
  const [showPass, setShowPass] = useState(false);
  const [copied, setCopied] = useState<Field | null>(null);

  // Direct mode: the phone or customer PBX registers with this relay.
  const sipUser = session.sip_user || "";
  const sipPass = session.sip_pass || "";
  const server =
    session.sip_url && session.sip_url !== "127.0.0.1:5060"
      ? session.sip_url
      : `${window.location.hostname}:${SIP_PORT}`;
  const domain = server.split(":")[0];

  // External mode: this relay registers with the customer's PBX.
  const [ext, setExt] = useState<SIPExtConfig>({ ...emptyExt });
  const [busy, setBusy] = useState(false);
  const [showExtPass, setShowExtPass] = useState(false);

  useEffect(() => {
    if (!open) return;
    getSIPExt(session.id)
      .then((r) => setExt({ ...emptyExt, ...r, port: r.port || SIP_PORT }))
      .catch(() => {});
  }, [open, session.id]);

  const copy = (field: Field, value: string) => {
    navigator.clipboard?.writeText(value);
    setCopied(field);
    setTimeout(() => setCopied(null), 1500);
  };

  const setE = <K extends keyof SIPExtConfig>(k: K, v: SIPExtConfig[K]) =>
    setExt((prev) => ({ ...prev, [k]: v }));

  const saveExt = async () => {
    if (ext.enabled && (!ext.host.trim() || !ext.user.trim())) {
      toast.error("Enter the PBX host and username");
      return;
    }
    setBusy(true);
    try {
      await setSIPExt(session.id, {
        enabled: ext.enabled,
        host: ext.host.trim(),
        port: Number(ext.port) || SIP_PORT,
        user: ext.user.trim(),
        authUser: (ext.authUser ?? "").trim(),
        pass: ext.pass,
        dest: ext.dest.trim(),
        proxy: (ext.proxy ?? "").trim(),
        inboundMode: ext.inboundMode ?? "originate",
        agentAutoAnswer: !!ext.agentAutoAnswer,
        agentRingTimeoutSeconds: ext.agentRingTimeoutSeconds,
      });
      toast.success(ext.enabled ? "PBX registration saved — connecting…" : "PBX registration disabled");
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ label, field, value }: { label: string; field: Field; value: string }) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button type="button" variant="outline" size="icon" onClick={() => copy(field, value)} aria-label={`Copy ${label}`}>
          {copied === field ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );

  const TabButton = ({ id, icon, children }: { id: Tab; icon: ReactNode; children: ReactNode }) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
        tab === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={session.sip_ext_status === "registered" ? "default" : "outline"} size="sm">
          <Phone className="h-4 w-4" />
          SIP
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>SIP / PBX integration</DialogTitle>
          <DialogDescription>
            Choose whether phones register with this relay or the relay registers with an external PBX.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-full bg-muted p-1">
          <TabButton id="server" icon={<Server className="h-3.5 w-3.5" />}>
            PBX registers here
          </TabButton>
          <TabButton id="external" icon={<ArrowUpRight className="h-3.5 w-3.5" />}>
            Register with PBX
          </TabButton>
        </div>

        {tab === "server" ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              The phone, softphone, or PBX <b>registers with this relay</b> using the credentials below.
              Numbers dialed through this account are sent to WhatsApp.
            </p>
            <Row label="SIP server (host:port)" field="server" value={server} />
            <Row label="Domain / realm" field="domain" value={domain} />
            <Row label="SIP username" field="user" value={sipUser} />

            <div className="space-y-1">
              <Label>SIP password</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  type={showPass ? "text" : "password"}
                  value={sipPass}
                  className="font-mono text-xs"
                  onFocus={(e) => e.target.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? "Hide password" : "Show password"}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => copy("pass", sipPass)}
                  aria-label="Copy password"
                >
                  {copied === "pass" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Phone or PBX setup</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>Transport: <b>UDP</b> on port {SIP_PORT}; codec: <b>G.711 PCMU or PCMA</b>.</li>
                <li>On FreePBX, create a <b>PJSIP trunk</b> with the SIP username and server shown above.</li>
                <li>Dial international numbers without a plus sign, for example 15551234567.</li>
                <li>Keep these credentials private; they authorize calls through this WhatsApp account.</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">Register with an external PBX</p>
                <p className="text-xs text-muted-foreground">
                  WA SIP Relay becomes a <b>registered extension</b> on Asterisk, FreePBX, 3CX, or another SIP PBX.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={ext.status} error={ext.error} />
                <Switch checked={ext.enabled} onCheckedChange={(v) => setE("enabled", v)} />
              </div>
            </div>

            {ext.error && ext.status === "failed" ? (
              <p className="text-xs text-red-600">{ext.error}</p>
            ) : null}

            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <div className="space-y-1">
                <Label>PBX host</Label>
                <Input
                  value={ext.host}
                  onChange={(e) => setE("host", e.target.value)}
                  placeholder="pbx.example.com"
                  disabled={!ext.enabled}
                />
              </div>
              <div className="space-y-1">
                <Label>Port</Label>
                <Input
                  value={String(ext.port)}
                  onChange={(e) => setE("port", Number(e.target.value.replace(/\D/g, "")) || 0)}
                  inputMode="numeric"
                  placeholder="5060"
                  disabled={!ext.enabled}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Outbound proxy — optional</Label>
              <Input
                value={ext.proxy ?? ""}
                onChange={(e) => setE("proxy", e.target.value)}
                placeholder="For example sip.provider.com:5060; blank uses the PBX host"
                disabled={!ext.enabled}
              />
              <p className="text-[0.7rem] text-muted-foreground">
                Set this when SIP messages must be sent to a server other than the PBX domain. This is
                common with hosted trunks and some FreePBX deployments.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Username / extension</Label>
                <Input
                  value={ext.user}
                  onChange={(e) => setE("user", e.target.value)}
                  autoComplete="off"
                  placeholder="1001"
                  disabled={!ext.enabled}
                />
              </div>
              <div className="space-y-1">
                <Label>Password</Label>
                <div className="flex gap-2">
                  <Input
                    value={ext.pass}
                    onChange={(e) => setE("pass", e.target.value)}
                    type={showExtPass ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Extension password"
                    disabled={!ext.enabled}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowExtPass((v) => !v)}
                    aria-label={showExtPass ? "Hide password" : "Show password"}
                  >
                    {showExtPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Authentication username (Auth ID) — optional</Label>
              <Input
                value={ext.authUser ?? ""}
                onChange={(e) => setE("authUser", e.target.value)}
                autoComplete="off"
                placeholder="Leave blank to use the extension"
                disabled={!ext.enabled}
              />
              <p className="text-[0.7rem] text-muted-foreground">
                Use this when the PBX authenticates with an ID different from the extension. On <b>3CX</b>,
                enter the extension's <b>Authentication ID</b> here.
              </p>
            </div>

            <div className="space-y-1">
              <Label>Destination for incoming WhatsApp calls — optional</Label>
              <Input
                value={ext.dest}
                onChange={(e) => setE("dest", e.target.value)}
                placeholder="For example 600 for a queue or extension"
                disabled={!ext.enabled}
              />
            </div>


            <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">How it works</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>Create an <b>extension</b> on the PBX and enter its credentials here.</li>
                <li>
                  <b>PBX → WhatsApp:</b> route the call to this extension with the destination in
                  international format, for example 15551234567.
                </li>
                <li>
                  <b>WhatsApp → PBX:</b> incoming calls ring the destination configured above.
                </li>
                <li>Codec: <b>G.711 PCMU or PCMA</b>; transport: UDP.</li>
              </ul>
            </div>
          </div>
        )}

        {tab === "external" ? (
          <DialogFooter>
            <Button disabled={busy} onClick={() => void saveExt()}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
