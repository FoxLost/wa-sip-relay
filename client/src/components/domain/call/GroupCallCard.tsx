import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, PhoneCall, PhoneOff, Loader2, Video, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiGet } from "@/lib/api";
import { WSAudioBridge } from "@/lib/ws-audio";
import { GroupVideoBridge } from "@/lib/call/group-video";
import { listGroups, startGroupCall, endGroupCall, getGroupRoster, type RosterEntry } from "@/services/groupCalls";

// VideoTile binds a MediaStream to a video element because srcObject is not a React property.
// RTP orientation is applied automatically, with a manual 90-degree adjustment on top.
const VideoTile = ({
  stream,
  label,
  muted,
  orientation = 0,
}: {
  stream: MediaStream;
  label: string;
  muted?: boolean;
  orientation?: number; // clockwise quarter turns (0..3)
}) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [manual, setManual] = useState(0);
  const [landscape, setLandscape] = useState(false);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  // Auto-rotate only landscape frames when the phone reports portrait orientation.
  const onSize = () => {
    const el = ref.current;
    if (el && el.videoWidth && el.videoHeight) setLandscape(el.videoWidth > el.videoHeight);
  };
  const auto = orientation % 2 === 1 && landscape ? orientation * 90 : 0;
  const rot = (auto + manual) % 360;
  const setRot = (fn: (r: number) => number) => setManual((m) => fn(m) % 360);
  // Scale sideways video so it fills the tile without excessive cropping.
  const sideways = rot === 90 || rot === 270;
  return (
    <div className="relative h-32 overflow-hidden rounded-md bg-black">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        onLoadedMetadata={onSize}
        onResize={onSize}
        style={{ transform: `rotate(${rot}deg) scale(${sideways ? 1.34 : 1})` }}
        className="h-full w-full object-cover transition-transform"
      />
      <button
        type="button"
        onClick={() => setRot((r) => (r + 90) % 360)}
        title="Rotate camera"
        className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white hover:bg-black/80"
      >
        <RotateCw className="h-3.5 w-3.5" />
      </button>
      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[0.6rem] text-white">
        {label}
      </span>
    </div>
  );
};

// Experimental group calls: select a group, call its members, and bridge two-way audio with
// optional camera and participant video. Shown only when group calls are enabled.
export const GroupCallCard = ({ sid }: { sid: string }) => {
  const { data: config } = useQuery({
    queryKey: ["config-groupcalls"],
    queryFn: () => apiGet<{ groupCalls?: boolean }>("/api/config"),
    staleTime: Infinity,
    retry: false,
  });

  const { data: groups } = useQuery({
    queryKey: ["groups", sid],
    queryFn: () => listGroups(sid),
    enabled: !!config?.groupCalls,
    staleTime: 60_000,
    retry: false,
  });

  const [jid, setJid] = useState("");
  const [status, setStatus] = useState<"idle" | "calling" | "in-call">("idle");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<Array<{ pid: string; stream: MediaStream; orientation: number }>>([]);
  const [roster, setRoster] = useState<Record<string, RosterEntry>>({});
  const bridgeRef = useRef<WSAudioBridge | null>(null);
  const videoRef = useRef<GroupVideoBridge | null>(null);

  if (!config?.groupCalls) return null;

  const start = async (withVideo: boolean) => {
    const target = jid || groups?.[0]?.jid;
    if (!target) {
      toast.error("Select a group");
      return;
    }
    if (withVideo && !GroupVideoBridge.supported()) {
      toast.error("This browser does not support video through WebCodecs");
      return;
    }
    setStatus("calling");
    try {
      await startGroupCall(sid, target, withVideo);
      getGroupRoster(sid).then(setRoster).catch(() => {});
      const bridge = new WSAudioBridge(sid, "group", null, {
        onState: (s) => setStatus(s === "connected" ? "in-call" : s === "disconnected" ? "idle" : "calling"),
        onError: (e) => toast.error(e.message),
      });
      bridgeRef.current = bridge;
      await bridge.connect();
      setStatus("in-call");
      if (withVideo) {
        const vb = new GroupVideoBridge(sid);
        vb.onParticipantStream = (pid, stream) =>
          setPeers((prev) =>
            prev.some((p) => p.pid === pid) ? prev : [...prev, { pid, stream, orientation: vb.orientationOf(pid) }],
          );
        vb.onParticipantGone = (pid) => setPeers((prev) => prev.filter((p) => p.pid !== pid));
        vb.onParticipantOrientation = (pid, orientation) =>
          setPeers((prev) => prev.map((p) => (p.pid === pid ? { ...p, orientation } : p)));
        videoRef.current = vb;
        await vb.connect();
        setLocalStream(vb.localStream);
      }
      toast.success(withVideo ? "Group video call started" : "Group call started");
    } catch (e) {
      await cleanup();
      setStatus("idle");
      toast.error((e as Error).message || "Could not start the group call");
    }
  };

  const cleanup = async () => {
    videoRef.current?.close();
    videoRef.current = null;
    bridgeRef.current?.disconnect();
    bridgeRef.current = null;
    setLocalStream(null);
    setPeers([]);
    setRoster({});
  };

  // Resolve a participant LID to the roster's phone number and name.
  const labelFor = (pid: string) => {
    const lidNum = pid.split(/[:@]/)[0];
    const e = roster[lidNum];
    if (!e) return pid.slice(-4);
    const phone = e.phone ? `+${e.phone}` : "";
    if (e.name && phone) return `${e.name} · ${phone}`;
    return e.name || phone || pid.slice(-4);
  };

  const end = async () => {
    await cleanup();
    try {
      await endGroupCall(sid);
    } catch {
      /* ignore */
    }
    setStatus("idle");
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Users className="h-4 w-4" /> Group call
        <span className="rounded bg-muted px-1.5 py-0.5 text-[0.6rem] uppercase text-muted-foreground">
          experimental
        </span>
      </div>

      {status === "idle" ? (
        <div className="flex flex-col gap-2">
          <select
            value={jid}
            onChange={(e) => setJid(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">Select a group…</option>
            {(groups ?? []).map((g) => (
              <option key={g.jid} value={g.jid}>
                {g.name} ({g.participants?.length ?? 0})
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Button onClick={() => start(false)} className="flex-1">
              <PhoneCall className="h-4 w-4" /> Call with audio
            </Button>
            <Button onClick={() => start(true)} variant="secondary" className="flex-1">
              <Video className="h-4 w-4" /> Call with video
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              {status === "calling" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Connecting…
                </>
              ) : (
                <>
                  <span className="h-2.5 w-2.5 rounded-full bg-primary" /> Group call active
                </>
              )}
            </span>
            <Button variant="destructive" onClick={end}>
              <PhoneOff className="h-4 w-4" /> End
            </Button>
          </div>
          {(localStream || peers.length > 0) && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {localStream && <VideoTile stream={localStream} label="You" muted />}
              {peers.map((p) => (
                <VideoTile key={p.pid} stream={p.stream} label={labelFor(p.pid)} orientation={p.orientation} />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};
