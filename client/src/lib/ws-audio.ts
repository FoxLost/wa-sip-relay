/**
 * Audio media transport over WebSocket.
 *
 * Replaces RTCPeerConnection behind reverse proxies that block UDP. WSS traffic passes through
 * ordinary HTTP proxies.
 *
 * Protocol:
 *   - Uplink: binary PCM Int16 LE frames, 16 kHz mono
 *   - Downlink: the same encoding
 */

import { getApiBase, getApiKey } from "./auth";

const SAMPLE_RATE = 16_000; // Must match the Go server.
// ScriptProcessorNode buffer size must be a power of two. At 16 kHz, 512 samples is about 32 ms.
const FRAME_SAMPLES = 512;
// Initial playback jitter cushion in seconds.
const JITTER_CUSHION = 0.06; // 60 ms

export type WSAudioEvents = {
  onState?: (state: "connecting" | "connected" | "disconnected") => void;
  onError?: (err: Error) => void;
};

export class WSAudioBridge {
  /** Microphone stream available after connect(), including for the VU meter. */
  micStream: MediaStream | null = null;

  /** Remote audio stream available after connect(), including for the VU meter. */
  remoteStream: MediaStream | null = null;

  private ws: WebSocket | null = null;
  private audioCtx: AudioContext | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private playbackCtx: AudioContext | null = null;

  // Next free playback time in the AudioContext timeline.
  private playCursor = 0;

  // Synthetic MediaStream used by the peer VU meter.
  private remoteDestination: MediaStreamAudioDestinationNode | null = null;

  private events: WSAudioEvents;
  private micDeviceId: string | null;

  constructor(
    private sid: string,
    private callId: string,
    micDeviceId: string | null = null,
    events: WSAudioEvents = {},
  ) {
    this.micDeviceId = micDeviceId;
    this.events = events;
  }

  async connect(): Promise<void> {
    this.events.onState?.("connecting");

    // Request microphone access.
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: this.micDeviceId
        ? { deviceId: { exact: this.micDeviceId }, sampleRate: SAMPLE_RATE, channelCount: 1,
            echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        : { sampleRate: SAMPLE_RATE, channelCount: 1,
            echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    // Convert the API URL to a WebSocket URL.
    const base = getApiBase();
    const wsBase = base
      .replace(/^https:\/\//, "wss://")
      .replace(/^http:\/\//, "ws://");
    const apiKey = getApiKey();
    const url =
      `${wsBase}/api/sessions/${this.sid}/calls/${this.callId}/ws` +
      (apiKey ? `?apiKey=${encodeURIComponent(apiKey)}` : "");

    this.ws = new WebSocket(url, ["pcm16"]);
    this.ws.binaryType = "arraybuffer";

    await new Promise<void>((resolve, reject) => {
      const ws = this.ws!;
      ws.onopen = () => {
        this.events.onState?.("connected");
        resolve();
      };
      ws.onerror = () => {
        this.events.onError?.(new Error("WebSocket connection failed"));
        reject(new Error("WebSocket connection failed"));
      };
      ws.onclose = () => {
        this.events.onState?.("disconnected");
        this.stopCapture();
      };
      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          this.playPCM(ev.data);
        }
        // Text control messages are ignored by the audio bridge.
      };
    });

    this.startCapture();
  }

  private startCapture(): void {
    if (!this.micStream || !this.ws) return;

    // A 16 kHz AudioContext reduces server-side resampling.
    this.audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.sourceNode = this.audioCtx.createMediaStreamSource(this.micStream);

    // ScriptProcessorNode is deprecated but broadly supported. AudioWorklet requires a separate worker.
    this.processorNode = this.audioCtx.createScriptProcessor(FRAME_SAMPLES, 1, 1);
    this.processorNode.onaudioprocess = (ev) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      const float32 = ev.inputBuffer.getChannelData(0);
      this.ws.send(float32ToInt16LE(float32).buffer);
    };

    this.sourceNode.connect(this.processorNode);
    // ScriptProcessorNode must connect to a destination to receive callbacks.
    this.processorNode.connect(this.audioCtx.destination);
  }

  private stopCapture(): void {
    this.processorNode?.disconnect();
    this.sourceNode?.disconnect();
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.processorNode = null;
    this.sourceNode = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
  }

  private playPCM(buffer: ArrayBuffer): void {
    // Create the playback AudioContext and a destination stream for the remote VU meter.
    if (!this.playbackCtx) {
      this.playbackCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      this.remoteDestination = this.playbackCtx.createMediaStreamDestination();
      this.remoteStream = this.remoteDestination.stream;
    }
    const ctx = this.playbackCtx;

    // Convert PCM Int16 LE to Float32.
    const int16 = new Int16Array(buffer);
    if (int16.length === 0) return;
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
    audioBuffer.copyToChannel(float32, 0);

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    if (this.remoteDestination) {
      src.connect(this.remoteDestination);
    }

    // Schedule chunks on a continuous jitter-buffer timeline. Re-anchor with a small cushion
    // after network stalls; otherwise append without gaps or overlap.
    const now = ctx.currentTime;
    if (this.playCursor < now + 0.005) {
      this.playCursor = now + JITTER_CUSHION;
    }
    src.start(this.playCursor);
    this.playCursor += audioBuffer.duration;
  }

  /** Mute or resume the microphone while held. */
  setMicEnabled(enabled: boolean): void {
    this.micStream?.getAudioTracks().forEach((t) => {
      t.enabled = enabled;
    });
  }

  disconnect(): void {
    this.stopCapture();
    this.playbackCtx?.close().catch(() => {});
    this.playbackCtx = null;
    this.playCursor = 0;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, "call ended");
    }
    this.ws = null;
  }
}

/** Convert Float32 [-1, 1] to Int16 LE [-32768, 32767]. */
function float32ToInt16LE(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}

/**
 * Open a WebSocket call using the same shape as openCall(), with null video fields.
 */
export type OpenWSCall = {
  micStream: MediaStream;
  remoteStream: MediaStream | null;
  localVideoStream: null;
  remoteVideoStream: null;
  setLocalVideo: () => Promise<boolean>;
  setMicEnabled: (on: boolean) => void;
  close: () => void;
};

export const openWSCall = async (
  sid: string,
  callId: string,
  micDeviceId: string | null,
): Promise<OpenWSCall> => {
  const bridge = new WSAudioBridge(sid, callId, micDeviceId);
  await bridge.connect();

  return {
    get micStream() {
      return bridge.micStream!;
    },
    get remoteStream() {
      return bridge.remoteStream;
    },
    localVideoStream: null,
    remoteVideoStream: null,
    setLocalVideo: async () => false,
    setMicEnabled: (on: boolean) => bridge.setMicEnabled(on),
    close: () => bridge.disconnect(),
  };
};
