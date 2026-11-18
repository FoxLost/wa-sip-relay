import { useCallback, useEffect, useState } from "react";
import { Check, ClipboardList, Copy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listNativeForms, type NativeFormInfo } from "@/services/sessions";
import { copyText } from "@/lib/clipboard";

// Display labels for the app's standard form-template fields.
const FIELD_LABELS: Record<string, string> = {
  full_name: "Name",
  first_name: "First name",
  last_name: "Last name",
  phone_number: "Phone",
  email: "Email",
  address: "Address",
  city: "City",
  zip_code: "Postal code",
};

const typeLabel = (t?: string) =>
  t === "template" ? "Template" : t?.startsWith("ai_form") ? "AI generated" : t || "Form";

// Form fields come from enabled template fields, AI-form custom fields, or response field names.
const fieldsOf = (f: NativeFormInfo): string[] => {
  const d = f.data ?? {};
  const custom = Array.isArray(d.custom_fields)
    ? (d.custom_fields as { label?: string }[]).map((c) => c.label ?? "").filter(Boolean)
    : [];
  if (custom.length) return custom;
  const visible = Object.entries(d)
    .filter(([k, v]) => k.endsWith("_visible") && v === true)
    .map(([k]) => FIELD_LABELS[k.replace(/_visible$/, "")] ?? k.replace(/_visible$/, ""));
  if (visible.length) return visible;
  return (f.fields ?? []).map((n) => FIELD_LABELS[n] ?? n);
};

const fmtDate = (ms?: number) =>
  ms ? new Date(ms).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" }) : "—";

// Request body ready for POST /api/sessions/{sid}/messages/native-form.
const sendExample = (f: NativeFormInfo) =>
  JSON.stringify(
    {
      to: "5561999999999",
      flowId: f.flowId,
      ...(f.formType && f.formType !== "template" ? { formType: f.formType } : {}),
      body: f.body || "Share your details.",
      cta: f.cta || "Complete form",
      ...(f.screen ? { screen: f.screen } : {}),
      ...(f.data ? { data: f.data } : {}),
    },
    null,
    2,
  );

const CopyButton = ({ text, label, title }: { text: string; label: string; title: string }) => {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await copyText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };
  return (
    <Button variant="outline" size="sm" onClick={() => void copy()} title={title}>
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
};

export const FormsDialog = ({ sid }: { sid: string }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [forms, setForms] = useState<NativeFormInfo[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const r = await listNativeForms(sid);
        setForms(r.forms ?? []);
        setError("");
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [sid],
  );

  // Load immediately and refresh every 10 seconds so forms sent by the phone appear while the dialog is open.
  useEffect(() => {
    if (!open) return;
    void load();
    const t = setInterval(() => void load(true), 10000);
    return () => clearInterval(t);
  }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" title="Native WhatsApp Business forms">
          <ClipboardList className="h-4 w-4" />
          <span className="hidden sm:inline">Forms</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>WhatsApp Business forms</DialogTitle>
          <DialogDescription>
            Forms created in the app that this account has already sent. Copy the ID and use it with{" "}
            <code className="font-mono">POST /messages/native-form</code>. A new form appears after it is sent
            once from the phone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">Could not load forms: {error}</p>}

        {forms === null && loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : forms && forms.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No forms yet. Create a form in Business tools → Forms on this account's phone and send it to any
            contact. It will appear here within a few seconds.
          </div>
        ) : (
          <div className="space-y-3">
            {(forms ?? []).map((f) => {
              const fields = fieldsOf(f);
              return (
                <div key={f.flowId} className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{f.body || f.flowName || "Form"}</div>
                      <div className="text-xs text-muted-foreground">
                        Button: {f.cta || "Complete form"}
                        {f.flowName ? ` · ${f.flowName}` : ""}
                      </div>
                    </div>
                    <Badge variant="secondary">{typeLabel(f.formType)}</Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">ID:</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">{f.flowId}</code>
                    <CopyButton text={f.flowId} label="Copy ID" title="Copy the flowId" />
                    <CopyButton
                      text={sendExample(f)}
                      label="Copy request"
                      title="Copy the request body for POST /messages/native-form"
                    />
                  </div>

                  {fields.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {fields.map((name) => (
                        <Badge key={name} variant="muted">
                          {name}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground">
                    Sent {f.sentCount}× · last {fmtDate(f.lastSentAt)} · {f.responseCount}{" "}
                    {f.responseCount === 1 ? "response" : "responses"}
                    {f.lastResponseAt ? ` · latest ${fmtDate(f.lastResponseAt)}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
