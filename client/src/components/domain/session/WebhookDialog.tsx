import { useCallback, useEffect, useState } from "react";
import { Webhook, Loader2, Plus, Pencil, Trash2, Send, ArrowLeft, RotateCcw } from "lucide-react";
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
import {
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  reenableWebhook,
  type WebhookInput,
  type WebhookItem,
} from "@/services/webhook";

// Session webhook event types. Selecting none delivers every event.
const EVENTS: { id: string; label: string }[] = [
  { id: "message", label: "Messages" },
  { id: "receipt", label: "Delivery/read receipts" },
  { id: "reaction", label: "Reactions" },
  { id: "deleted", label: "Deleted messages" },
  { id: "poll_vote", label: "Poll votes" },
  { id: "event_response", label: "Event responses" },
  { id: "form_response", label: "Forms" },
  { id: "group_participants", label: "Group participants" },
  { id: "view_once", label: "View once" },
  { id: "session_status", label: "Session status" },
  { id: "broadcast", label: "Broadcasts" },
  { id: "recording", label: "Recordings" },
  { id: "restriction", label: "Restrictions" },
  { id: "call_peer_mute", label: "Call peer muted" },
  { id: "call_hand_raise", label: "Hand raised" },
];

const eventLabel = (id: string) => EVENTS.find((e) => e.id === id)?.label ?? id;

type Draft = { name: string; url: string; secret: string; events: string[]; ignoreGroups: boolean };
const emptyDraft: Draft = { name: "", url: "", secret: "", events: [], ignoreGroups: false };

export const WebhookDialog = ({ sid }: { sid: string }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hooks, setHooks] = useState<WebhookItem[]>([]);
  const [max, setMax] = useState(10);
  // null = list, "new" = create, otherwise the webhook ID being edited
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ ...emptyDraft });

  const load = useCallback(
    () =>
      listWebhooks(sid)
        .then((r) => {
          setHooks(r.webhooks ?? []);
          setMax(r.max || 10);
        })
        .catch(() => {}),
    [sid],
  );

  // Load on mount so the trigger reflects whether any webhook is configured.
  useEffect(() => {
    load();
  }, [load, open]);

  useEffect(() => {
    if (!open) setEditing(null);
  }, [open]);

  const current = hooks.find((h) => h.id === editing);

  const startNew = () => {
    setDraft({ ...emptyDraft });
    setEditing("new");
  };

  const startEdit = (h: WebhookItem) => {
    setDraft({ name: h.name, url: h.url, secret: "", events: h.events ?? [], ignoreGroups: h.ignoreGroups });
    setEditing(h.id);
  };

  const toggleEvent = (id: string) =>
    setDraft((d) => ({
      ...d,
      events: d.events.includes(id) ? d.events.filter((e) => e !== id) : [...d.events, id],
    }));

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      await load();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const url = draft.url.trim();
    if (!/^https?:\/\//i.test(url)) {
      toast.error("Enter a valid HTTP(S) URL");
      return;
    }
    const body: WebhookInput = { name: draft.name.trim(), url, events: draft.events, ignoreGroups: draft.ignoreGroups };
    if (draft.secret.trim()) body.secret = draft.secret.trim();
    const done = await run(
      () => (editing === "new" ? createWebhook(sid, body) : updateWebhook(sid, editing!, body)),
      "Webhook saved",
    );
    if (done) setEditing(null);
  };

  const remove = (h: WebhookItem) => {
    if (!window.confirm(`Remove webhook ${h.name || h.url}?`)) return;
    run(() => deleteWebhook(sid, h.id), "Webhook removed").then((ok) => ok && setEditing(null));
  };

  const clearSecret = (h: WebhookItem) =>
    run(
      () =>
        updateWebhook(sid, h.id, {
          name: draft.name.trim(),
          url: draft.url.trim(),
          secret: "",
          events: draft.events,
          ignoreGroups: draft.ignoreGroups,
        }),
      "Secret removed",
    );

  const test = async (h: WebhookItem) => {
    setBusy(true);
    try {
      const r = await testWebhook(sid, h.id);
      if (r.ok) toast.success(`Test delivered (HTTP ${r.status})`);
      else toast.error(r.error ? `Failed: ${r.error}` : `Failed: HTTP ${r.status}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stateBadge = (h: WebhookItem) => {
    const st = h.status?.state ?? "closed";
    if (st === "closed") return <Badge variant="success">Active</Badge>;
    return (
      <Badge variant="destructive" title={h.status?.disabledReason}>
        {st === "open" ? "Paused after failures" : "Disabled after failures"}
      </Badge>
    );
  };

  const list = (
    <div className="space-y-3">
      {hooks.length === 0 && (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          No webhooks for this session.
        </p>
      )}
      {hooks.map((h) => (
        <div key={h.id} className="space-y-2 rounded-lg border p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{h.name || (h.id === "default" ? "Primary" : "Webhook")}</span>
                {stateBadge(h)}
              </div>
              <p className="break-all text-xs text-muted-foreground">{h.url}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="icon" variant="ghost" disabled={busy} title="Send test" onClick={() => test(h)}>
                <Send className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" disabled={busy} title="Edit" onClick={() => startEdit(h)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" disabled={busy} title="Remove" onClick={() => remove(h)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            <Badge variant="muted">
              {h.events?.length ? h.events.map(eventLabel).join(", ") : "All events"}
            </Badge>
            {h.ignoreGroups && <Badge variant="muted">Groups ignored</Badge>}
            {h.hasSecret && <Badge variant="muted">Signed</Badge>}
          </div>
          {h.status && h.status.state !== "closed" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => run(() => reenableWebhook(sid, h.id), "Webhook re-enabled")}
            >
              <RotateCcw className="h-4 w-4" />
              Re-enable
            </Button>
          )}
        </div>
      ))}
    </div>
  );

  const form = (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Name (optional)</Label>
        <Input
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="For example n8n or CRM"
        />
      </div>
      <div className="space-y-1">
        <Label>URL</Label>
        <Input
          value={draft.url}
          onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
          placeholder="https://your-system.example/webhook/wa-sip-relay"
        />
      </div>
      <div className="space-y-1">
        <Label>Secret (optional)</Label>
        <div className="flex gap-2">
          <Input
            value={draft.secret}
            onChange={(e) => setDraft((d) => ({ ...d, secret: e.target.value }))}
            type="password"
            placeholder={current?.hasSecret ? "configured — leave blank to keep it" : "signs with X-Webhook-Signature"}
          />
          {current?.hasSecret && (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => clearSecret(current)}>
              Remove
            </Button>
          )}
        </div>
      </div>

      <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-3">
        <span className="space-y-0.5">
          <span className="block text-sm font-medium">Ignore groups</span>
          <span className="block text-xs text-muted-foreground">
            Do not send group events such as messages, receipts, reactions, or participant changes.
            Only individual conversations are delivered.
          </span>
        </span>
        <Switch
          checked={draft.ignoreGroups}
          onCheckedChange={(v) => setDraft((d) => ({ ...d, ignoreGroups: v }))}
          aria-label="Ignore groups"
        />
      </label>

      <div className="space-y-2">
        <Label>Events</Label>
        <p className="text-xs text-muted-foreground">
          {draft.events.length === 0 ? "None selected means all events." : `${draft.events.length} selected.`}
        </p>
        <div className="flex flex-wrap gap-2">
          {EVENTS.map((e) => {
            const on = draft.events.includes(e.id);
            return (
              <Button
                key={e.id}
                type="button"
                size="sm"
                variant={on ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                title={e.id}
                aria-pressed={on}
                onClick={() => toggleEvent(e.id)}
              >
                {e.label}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={hooks.length ? "default" : "outline"} size="sm" title="Webhooks">
          <Webhook className="h-4 w-4" />
          <span className="hidden sm:inline">Webhook{hooks.length > 1 ? `s (${hooks.length})` : ""}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing === null ? "Session webhooks" : editing === "new" ? "New webhook" : "Edit webhook"}
          </DialogTitle>
          <DialogDescription>
            Each webhook receives this account's events as JSON POST requests in the format{" "}
            <code>{"{ session, event, timestamp, data }"}</code>, with independent filters.
          </DialogDescription>
        </DialogHeader>

        {editing === null ? list : form}

        <DialogFooter className="gap-2 sm:justify-between">
          {editing === null ? (
            <>
              <span className="self-center text-xs text-muted-foreground">
                {hooks.length}/{max}
              </span>
              <Button disabled={busy || hooks.length >= max} onClick={startNew}>
                <Plus className="h-4 w-4" />
                Add webhook
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setEditing(null)}>
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button disabled={busy} onClick={save}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
