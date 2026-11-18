import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck, KeyRound, QrCode, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSessions, setPairingCode } from "@/stores/sessions";
import { submitPasskeyAssertion, pairSessionCode } from "@/services/sessions";
import {
  isExtensionInstalled,
  runPasskeyAssertion,
  EXTENSION_DOWNLOAD_URL,
} from "@/lib/passkey";
import { useLanguage } from "@/lib/i18n";
import type { SessionInfo } from "@/types/session";

const PasskeyStep = ({ session }: { session: SessionInfo }) => {
  const { t } = useLanguage();
  const publicKey = useSessions((s) => s.passkeys[session.id]);
  const [hasExt, setHasExt] = useState<boolean | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");
  const [error, setError] = useState("");
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    void isExtensionInstalled().then(setHasExt);
  }, []);

  const authorize = async () => {
    if (!publicKey) return;
    setStatus("running");
    setError("");
    try {
      const assertion = await runPasskeyAssertion(publicKey);
      await submitPasskeyAssertion(session.id, assertion);
      // Completion arrives through auth-state with state="open".
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setStatus("idle");
  };

  // Start once automatically when the extension and challenge are available.
  useEffect(() => {
    if (hasExt && publicKey && startedFor.current !== session.id && status === "idle") {
      startedFor.current = session.id;
      void authorize();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasExt, publicKey, session.id]);

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
        <KeyRound className="h-7 w-7" />
      </div>
      <div>
        <p className="font-semibold">{t("This account uses a passkey")}</p>
        <p className="text-sm text-muted-foreground">
          {t("WhatsApp requires the account owner to approve this linked device.")}
        </p>
      </div>

      {hasExt === false ? (
        <div className="space-y-3">
          <Badge variant="destructive">{t("WA SIP Relay passkey extension not found")}</Badge>
          <p className="text-sm text-muted-foreground">
            {t("Install the extension in the account owner's browser to approve the connection:")}
          </p>
          <ol className="mx-auto max-w-xs space-y-1 text-left text-sm text-muted-foreground">
            <li>{t("1. Download and extract the file below.")}</li>
            <li>{t("2. Open chrome://extensions and enable Developer mode.")}</li>
            <li>{t("3. Select Load unpacked and choose the extracted folder.")}</li>
            <li>{t("4. Return here and restart pairing.")}</li>
          </ol>
          <Button asChild>
            <a href={EXTENSION_DOWNLOAD_URL} download>
              {t("Download extension (.zip)")}
            </a>
          </Button>
        </div>
      ) : status === "running" ? (
        <Badge variant="muted" className="gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> {t("Waiting for approval in the WhatsApp tab…")}
        </Badge>
      ) : status === "error" ? (
        <div className="space-y-3">
          <Badge variant="destructive">{t("Failed: {{error}}", { error })}</Badge>
          <Button onClick={() => void authorize()} className="gap-1.5">
            <ShieldCheck className="h-4 w-4" /> {t("Try again")}
          </Button>
        </div>
      ) : (
        <Button onClick={() => void authorize()} className="gap-1.5">
          <ShieldCheck className="h-4 w-4" /> {t("Approve with passkey")}
        </Button>
      )}
    </div>
  );
};

const CodeStep = ({ session }: { session: SessionInfo }) => {
  const { t } = useLanguage();
  const code = useSessions((s) => s.codes[session.id]);
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  const digits = phone.replace(/\D/g, "");
  const canSubmit = digits.length >= 10 && status !== "loading";

  const generate = async () => {
    if (!canSubmit) return;
    setStatus("loading");
    setError("");
    try {
      const { code: c } = await pairSessionCode(session.id, digits);
      setPairingCode(session.id, c);
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const pretty = code ? (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code) : "";

  return (
    <div className="flex w-full flex-col items-center gap-4 text-center">
      {code ? (
        <>
          <p className="text-sm text-muted-foreground">
            {t("On the phone, open WhatsApp → Linked devices → Link a device → Link with phone number instead, then enter:")}
          </p>
          <div className="rounded-xl border bg-muted/50 px-6 py-4">
            <span className="font-mono text-3xl font-bold tracking-[0.25em]">{pretty}</span>
          </div>
          <Badge variant="muted" className="gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> {t("Waiting for confirmation on the phone…")}
          </Badge>
          <Button variant="ghost" size="sm" onClick={() => void generate()} disabled={status === "loading"}>
            {t("Generate a new code")}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t("Enter the number with country code, for example 15551234567, to generate a linking code.")}
          </p>
          <Input
            type="tel"
            inputMode="numeric"
            placeholder="5511999999999"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void generate();
            }}
            className="text-center"
          />
          {status === "error" && <Badge variant="destructive">{t("Failed: {{error}}", { error })}</Badge>}
          <Button onClick={() => void generate()} disabled={!canSubmit} className="w-full gap-1.5">
            {status === "loading" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {t("Generating…")}
              </>
            ) : (
              <>
                <Smartphone className="h-4 w-4" /> {t("Generate code")}
              </>
            )}
          </Button>
        </>
      )}
    </div>
  );
};

export const SessionPairing = ({ session }: { session: SessionInfo }) => {
  const { t } = useLanguage();
  const qr = useSessions((s) => s.qrs[session.id]);
  const hasCode = useSessions((s) => !!s.codes[session.id]);
  const isPasskey = session.state === "passkey_request";
  const [mode, setMode] = useState<"qr" | "code">(
    session.state === "pairing_code" || hasCode ? "code" : "qr",
  );

  return (
    <div className="flex min-h-[55vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <CardTitle>{t("Connect {{name}}", { name: session.name })}</CardTitle>
          {!isPasskey && mode === "qr" && (
            <CardDescription>
              {t("Open WhatsApp → Linked devices → Link a device, then scan this code.")}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {isPasskey ? (
            <PasskeyStep session={session} />
          ) : (
            <>
              {/* Pair with a QR code or a phone-number code. */}
              <div className="flex w-full rounded-lg border p-1">
                <button
                  type="button"
                  onClick={() => setMode("qr")}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition ${
                    mode === "qr" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <QrCode className="h-4 w-4" /> {t("QR Code")}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("code")}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition ${
                    mode === "code" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Smartphone className="h-4 w-4" /> {t("Phone code")}
                </button>
              </div>

              {mode === "code" ? (
                <CodeStep session={session} />
              ) : qr ? (
                <div className="rounded-lg border bg-white p-3">
                  <QRCodeSVG value={qr} size={232} marginSize={1} />
                </div>
              ) : session.state === "logged_out" ? (
                <Badge variant="destructive">{t("Disconnected — select Pair above to generate a new QR code")}</Badge>
              ) : (
                <>
                  <Skeleton className="h-[258px] w-[258px] rounded-lg" />
                  <Badge variant="muted" className="gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" /> {t("Waiting for a QR code…")}
                  </Badge>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
