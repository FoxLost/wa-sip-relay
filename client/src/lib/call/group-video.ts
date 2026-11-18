import { getApiBase, getApiKey } from "@/lib/auth";
import { VideoSender, VideoReceiver, videoSupported } from "./video-codec";

// GroupVideoBridge carries H264 video for group calls between the browser and the gateway
// through /calls/group/video-ws. It sends the operator camera through VideoSender and exposes
// one VideoReceiver MediaStream per participant.
//
// Binary protocol, matching handleGroupVideoWS:
//   gateway -> browser: [1-byte pid length][ASCII pid][H264 Annex B access unit]
//   browser -> gateway: raw H264 Annex B camera access unit
export class GroupVideoBridge {
  private ws: WebSocket | null = null;
  private sender: VideoSender | null = null;
  private receivers = new Map<string, VideoReceiver>();
  private closed = false;
  private lastPli = new Map<string, number>();
  private orientations = new Map<string, number>();
  private lastFrameAt = new Map<string, number>();
  private staleTimer: ReturnType<typeof setInterval> | null = null;

  /** Local camera preview, available after connect(). */
  localStream: MediaStream | null = null;

  /** Called when a participant video stream appears. */
  onParticipantStream: ((pid: string, stream: MediaStream) => void) | null = null;
  /** Called when a participant stream closes or leaves the call. */
  onParticipantGone: ((pid: string) => void) | null = null;
  /** Called when participant camera orientation changes in clockwise quarter turns. */
  onParticipantOrientation: ((pid: string, orientation: number) => void) | null = null;

  /** Last known participant orientation, or zero when unknown. */
  orientationOf(pid: string): number {
    return this.orientations.get(pid) ?? 0;
  }

  constructor(private sid: string) {}

  static supported(): boolean {
    return videoSupported();
  }

  async connect(): Promise<void> {
    // Operator camera.
    this.localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } },
      audio: false,
    });

    const base = getApiBase();
    const wsBase = base.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
    const apiKey = getApiKey();
    const url =
      `${wsBase}/api/sessions/${this.sid}/calls/group/video-ws` +
      (apiKey ? `?apiKey=${encodeURIComponent(apiKey)}` : "");

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, ["h264-group"]);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("could not connect group video"));
      ws.onclose = () => {
        if (!this.closed) this.close();
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") this.onControl(ev.data);
        else this.onMessage(ev.data as ArrayBuffer);
      };
    });

    // Drop a participant tile after eight seconds without frames instead of leaving a frozen frame.
    this.staleTimer = setInterval(() => {
      const now = Date.now();
      for (const [pid, at] of this.lastFrameAt) {
        if (now - at > 8000) this.dropParticipant(pid);
      }
    }, 2000);

    // Encode and send the operator camera as binary Annex B access units.
    const track = this.localStream.getVideoTracks()[0];
    if (track) {
      this.sender = new VideoSender(track, (au) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(au);
        }
      });
    }
  }

  /**
   * Gateway JSON control messages:
   *   keyframe_request - a participant requested an IDR from our camera.
   *   video_state      - a participant enabled or disabled their camera.
   */
  private onControl(raw: string): void {
    let msg: { type?: string; pid?: string; state?: number; orientation?: number };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "keyframe_request") {
      this.sender?.forceKeyframe();
    } else if (msg.type === "orientation" && msg.pid && typeof msg.orientation === "number") {
      this.orientations.set(msg.pid, msg.orientation);
      this.onParticipantOrientation?.(msg.pid, msg.orientation);
    } else if (
      (msg.type === "video_state" && msg.pid && (msg.state === 0 || msg.state === 6)) ||
      (msg.type === "participant_left" && msg.pid)
    ) {
      this.dropParticipant(msg.pid!);
    }
  }

  /** Close a participant decoder and remove its tile when video stops or the participant leaves. */
  private dropParticipant(pid: string): void {
    const rx = this.receivers.get(pid);
    if (rx) {
      try {
        rx.close();
      } catch {}
      this.receivers.delete(pid);
      this.onParticipantGone?.(pid);
    }
    this.orientations.delete(pid);
    this.lastPli.delete(pid);
    this.lastFrameAt.delete(pid);
  }

  /** Request a participant keyframe through the gateway, limited to once per second per participant. */
  private requestPli(pid: string): void {
    const now = Date.now();
    if (now - (this.lastPli.get(pid) ?? 0) < 1000) return;
    this.lastPli.set(pid, now);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "pli", pid }));
    }
  }

  private onMessage(data: ArrayBuffer): void {
    if (!data || data.byteLength < 2) return;
    const bytes = new Uint8Array(data);
    const pidLen = bytes[0];
    if (data.byteLength < 1 + pidLen) return;
    const pid = new TextDecoder().decode(bytes.subarray(1, 1 + pidLen));
    const au = bytes.subarray(1 + pidLen);

    this.lastFrameAt.set(pid, Date.now());
    let rx = this.receivers.get(pid);
    if (!rx) {
      rx = new VideoReceiver();
      rx.onNeedKeyframe = () => this.requestPli(pid);
      this.receivers.set(pid, rx);
      this.onParticipantStream?.(pid, rx.stream);
    }
    rx.decode(au.buffer.slice(au.byteOffset, au.byteOffset + au.byteLength));
  }

  close(): void {
    this.closed = true;
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    try {
      this.sender?.close();
    } catch {}
    this.sender = null;
    for (const [pid, rx] of this.receivers) {
      try {
        rx.close();
      } catch {}
      this.onParticipantGone?.(pid);
    }
    this.receivers.clear();
    try {
      this.localStream?.getTracks().forEach((t) => t.stop());
    } catch {}
    this.localStream = null;
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
  }
}
