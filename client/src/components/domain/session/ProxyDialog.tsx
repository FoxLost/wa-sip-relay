import { useEffect, useState } from "react";
import { Globe, Loader2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { getProxy, setProxy } from "@/services/sessions";

type Fields = { scheme: string; host: string; port: string; user: string; pass: string };
const empty: Fields = { scheme: "socks5", host: "", port: "", user: "", pass: "" };

// Split a proxy URL into scheme://[user[:pass]@]host[:port] fields.
const parseProxy = (raw: string): Fields => {
  const m = raw.match(/^(\w+):\/\/(?:([^:@/]+)(?::([^@/]*))?@)?([^:/]+)(?::(\d+))?/);
  if (!m) return { ...empty };
  return {
    scheme: m[1] || "socks5",
    user: m[2] ? decodeURIComponent(m[2]) : "",
    pass: m[3] ? decodeURIComponent(m[3]) : "",
    host: m[4] || "",
    port: m[5] || "",
  };
};

// Build the URL from the fields. An empty host disables the proxy.
const buildProxy = (f: Fields): string => {
  const host = f.host.trim();
  if (!host) return "";
  let auth = "";
  if (f.user.trim()) {
    auth = encodeURIComponent(f.user.trim());
    if (f.pass) auth += ":" + encodeURIComponent(f.pass);
    auth += "@";
  }
  const port = f.port.trim() ? ":" + f.port.trim() : "";
  return `${f.scheme}://${auth}${host}${port}`;
};

const selectClass = cn(
  "h-9 rounded-full border border-input bg-card px-3 text-sm shadow-sm",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

export const ProxyDialog = ({ sid }: { sid: string }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [f, setF] = useState<Fields>({ ...empty });

  useEffect(() => {
    if (!open) return;
    getProxy(sid)
      .then((r) => {
        setEnabled(r.enabled);
        setF(r.proxy ? parseProxy(r.proxy) : { ...empty });
      })
      .catch(() => {});
  }, [open, sid]);

  const set = (k: keyof Fields) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));

  const save = async (value: string) => {
    setBusy(true);
    try {
      await setProxy(sid, value);
      setEnabled(value !== "");
      toast.success(value ? "Proxy saved — reconnecting the session" : "Proxy removed — reconnecting");
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={enabled ? "default" : "outline"} size="sm" title="Connection proxy">
          <Globe className="h-4 w-4" />
          <span className="hidden sm:inline">Proxy</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connection proxy</DialogTitle>
          <DialogDescription>
            This account's WhatsApp websocket and media traffic use this proxy. Saving reconnects the
            session automatically. Leave the host empty for a direct connection.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-[7rem_1fr_6rem] gap-2">
            <div className="space-y-1">
              <Label>Type</Label>
              <select
                value={f.scheme}
                onChange={(e) => set("scheme")(e.target.value)}
                className={cn(selectClass, "w-full")}
              >
                <option value="socks5">SOCKS5</option>
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Host</Label>
              <Input value={f.host} onChange={(e) => set("host")(e.target.value)} placeholder="proxy.example.com" />
            </div>
            <div className="space-y-1">
              <Label>Port</Label>
              <Input
                value={f.port}
                onChange={(e) => set("port")(e.target.value)}
                inputMode="numeric"
                placeholder="1080"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Username (optional)</Label>
              <Input
                value={f.user}
                onChange={(e) => set("user")(e.target.value)}
                autoComplete="off"
                placeholder="username"
              />
            </div>
            <div className="space-y-1">
              <Label>Password (optional)</Label>
              <Input
                value={f.pass}
                onChange={(e) => set("pass")(e.target.value)}
                type="password"
                autoComplete="new-password"
                placeholder="password"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {enabled ? (
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => void save("")}>
              Remove
            </Button>
          ) : (
            <span />
          )}
          <Button disabled={busy} onClick={() => void save(buildProxy(f))}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
