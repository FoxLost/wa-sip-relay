import { useCallback, useEffect, useState } from "react";
import { Bot, Loader2, Plus, Trash2, ArrowLeft, Copy, Check, KeyRound } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { listMcpKeys, createMcpKey, deleteMcpKey, type McpKey, type McpKeyCreated } from "@/services/mcp";
import { copyText } from "@/lib/clipboard";

const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" }) : "never";

// Read-only field with a copy button.
const CopyField = ({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await copyText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };
  return (
    <div className="min-w-0 space-y-1">
      <Label>{label}</Label>
      <div className="flex min-w-0 items-start gap-2">
        {multiline ? (
          <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-md border bg-muted/50 p-2 text-xs">{value}</pre>
        ) : (
          <Input readOnly value={value} className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.target.select()} />
        )}
        <Button type="button" size="icon" variant="outline" className="shrink-0" title="Copy" onClick={() => void copy()}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
};

type View = "list" | "new" | "created";

export const McpDialog = ({ sid }: { sid: string }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [keys, setKeys] = useState<McpKey[]>([]);
  const [max, setMax] = useState(20);
  const [view, setView] = useState<View>("list");
  const [name, setName] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [created, setCreated] = useState<McpKeyCreated | null>(null);

  const load = useCallback(
    () =>
      listMcpKeys(sid)
        .then((r) => {
          setKeys(r.keys ?? []);
          setMax(r.max || 20);
        })
        .catch(() => {}),
    [sid],
  );

  useEffect(() => {
    load();
  }, [load, open]);

  useEffect(() => {
    if (!open) {
      setView("list");
      setCreated(null);
    }
  }, [open]);

  const startNew = () => {
    setName("");
    setReadOnly(false);
    setView("new");
  };

  const create = async () => {
    setBusy(true);
    try {
      const r = await createMcpKey(sid, { name: name.trim(), readOnly });
      setCreated(r);
      setView("created");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (k: McpKey) => {
    if (!window.confirm(`Revoke ${k.name || k.prefix}? Anyone using this key will immediately lose access.`)) return;
    setBusy(true);
    try {
      await deleteMcpKey(sid, k.id);
      toast.success("Key revoked");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const list = (
    <div className="space-y-3">
      {keys.length === 0 && (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          No MCP keys for this session. Create one to connect an AI agent to this number.
        </p>
      )}
      {keys.map((k) => (
        <div key={k.id} className="flex items-start justify-between gap-2 rounded-lg border p-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{k.name || "MCP key"}</span>
              <Badge variant={k.readOnly ? "muted" : "secondary"}>{k.readOnly ? "Read only" : "Full access"}</Badge>
            </div>
            <p className="font-mono text-xs text-muted-foreground">{k.prefix}…</p>
            <p className="text-xs text-muted-foreground">
              Created {fmtDate(k.createdAt)} · last used {fmtDate(k.lastUsedAt)}
            </p>
          </div>
          <Button size="icon" variant="ghost" disabled={busy} title="Revoke" onClick={() => remove(k)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );

  const form = (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="For example Sales Claude or n8n" />
      </div>
      <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-3">
        <span className="space-y-0.5">
          <span className="block text-sm font-medium">Read only</span>
          <span className="block text-xs text-muted-foreground">
            The agent can read conversations, search messages, and inspect contacts and groups, but cannot send or change anything.
          </span>
        </span>
        <Switch checked={readOnly} onCheckedChange={setReadOnly} aria-label="Read only" />
      </label>
      <p className="text-xs text-muted-foreground">
        This key grants access only to this number. It cannot pair or disconnect accounts or change webhooks, Chatwoot, or SIP.
      </p>
    </div>
  );

  const createdView = created && (
    <div className="min-w-0 space-y-4">
      <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
        Copy this key now. It will not be shown again. Revoke it and create another if it is lost.
      </p>
      <CopyField label="Complete URL (for clients that only request a URL)" value={created.url} />
      <CopyField label="MCP endpoint" value={created.endpoint} />
      <CopyField label="Key (Authorization: Bearer)" value={created.secret} />
      <CopyField
        label="Claude Code"
        multiline
        value={`claude mcp add --transport http wa-sip-relay ${created.endpoint} --header "Authorization: Bearer ${created.secret}"`}
      />
      <CopyField
        label="Claude Desktop, Cursor, VS Code (mcpServers)"
        multiline
        value={JSON.stringify(
          {
            mcpServers: {
              waSipRelay: {
                type: "http",
                url: created.endpoint,
                headers: { Authorization: `Bearer ${created.secret}` },
              },
            },
          },
          null,
          2,
        )}
      />
      <p className="text-xs text-muted-foreground">
        In n8n, use the AI agent's <strong>MCP Client</strong> tool with the endpoint above and Bearer authentication.
      </p>
    </div>
  );

  const title = view === "list" ? "MCP — AI agents" : view === "new" ? "New MCP key" : "Key created";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={keys.length ? "default" : "outline"} size="sm" title="MCP (AI agents)">
          <Bot className="h-4 w-4" />
          <span className="hidden sm:inline">MCP{keys.length > 1 ? ` (${keys.length})` : ""}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Connect Claude, ChatGPT, Cursor, n8n, and other AI agents to this number through MCP. They can send messages,
            read conversations, make calls, and manage groups.
          </DialogDescription>
        </DialogHeader>

        {view === "list" ? list : view === "new" ? form : createdView}

        <DialogFooter className="gap-2 sm:justify-between">
          {view === "list" ? (
            <>
              <span className="self-center text-xs text-muted-foreground">
                {keys.length}/{max}
              </span>
              <Button disabled={busy || keys.length >= max} onClick={startNew}>
                <Plus className="h-4 w-4" />
                New key
              </Button>
            </>
          ) : view === "new" ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setView("list")}>
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button disabled={busy} onClick={create}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Create key
              </Button>
            </>
          ) : (
            <Button className="sm:ml-auto" onClick={() => setView("list")}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
