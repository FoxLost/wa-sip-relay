import { apiPost } from "./api";
import { setupVideoChannel } from "./call/video-channel";
import { videoSupported } from "./call/video-codec";
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "../constants/video";
import { getTransportMode } from "./transport";
import { openWSCall } from "./ws-audio";

export type OpenCallOptions = {
  video?: boolean;
  camDeviceId?: string | null;
};

export type OpenCall = {
  pc: RTCPeerConnection;
  micStream: MediaStream;
  remoteStream: MediaStream | null;
  localVideoStream: MediaStream | null;
  remoteVideoStream: MediaStream | null;
  // Enable or disable the camera during a call. Resolve true when video is active.
  setLocalVideo: (on: boolean, camDeviceId?: string | null) => Promise<boolean>;
  close: () => void;
};

const cameraConstraints = (camDeviceId?: string | null): MediaTrackConstraints => ({
  deviceId: camDeviceId ? { exact: camDeviceId } : undefined,
  width: { ideal: VIDEO_WIDTH },
  height: { ideal: VIDEO_HEIGHT },
  frameRate: { ideal: VIDEO_FPS },
});

export const openCall = async (
  sid: string,
  callId: string,
  micDeviceId: string | null,
  opts: OpenCallOptions = {},
): Promise<OpenCall> => {
  const wantVideo = !!opts.video && videoSupported();
  if (opts.video && !wantVideo) {
    console.warn("video requested but WebCodecs/insertable-streams unsupported; audio only");
  }

  const localStream = await navigator.mediaDevices.getUserMedia({
    audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
    video: wantVideo ? cameraConstraints(opts.camDeviceId) : false,
  });
  const pc = new RTCPeerConnection({ iceServers: [] });

  // Add only the Opus audio track to the peer connection. Video uses the WebCodecs channel.
  localStream.getAudioTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.addTransceiver("audio", { direction: "recvonly" });
  const remoteHolder: { stream: MediaStream | null } = { stream: null };
  pc.ontrack = (ev) => {
    if (ev.streams[0]) remoteHolder.stream = ev.streams[0];
  };

  // Keep the H264 data channel open for audio-only calls so video can be upgraded without SDP renegotiation.
  const video = setupVideoChannel(pc);

  // The local camera starts only when the call was created with video.
  let camTrack: MediaStreamTrack | null = wantVideo ? localStream.getVideoTracks()[0] ?? null : null;
  const local: { stream: MediaStream | null } = { stream: null };
  if (camTrack) {
    local.stream = new MediaStream([camTrack]);
    video.startSender(camTrack);
  }

  const setLocalVideo = async (on: boolean, camDeviceId?: string | null): Promise<boolean> => {
    if (on) {
      if (camTrack) return true; // already enabled
      if (!videoSupported()) return false;
      const cam = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(camDeviceId) });
      camTrack = cam.getVideoTracks()[0] ?? null;
      if (!camTrack) return false;
      local.stream = new MediaStream([camTrack]);
      video.startSender(camTrack);
      return true;
    }
    video.stopSender();
    if (camTrack) {
      try {
        camTrack.stop();
      } catch {}
    }
    camTrack = null;
    local.stream = null;
    return false;
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") resolve();
    else
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState === "complete") resolve();
      });
  });
  const { sdp_answer } = await apiPost<{ sdp_answer: string }>(
    `/api/sessions/${sid}/calls/${callId}/webrtc`,
    { sdp_offer: pc.localDescription!.sdp },
  );
  await pc.setRemoteDescription({ type: "answer", sdp: sdp_answer });
  return {
    pc,
    micStream: localStream,
    get remoteStream() {
      return remoteHolder.stream;
    },
    get localVideoStream() {
      return local.stream;
    },
    remoteVideoStream: video.remoteVideoStream,
    setLocalVideo,
    close: () => {
      video.close();
      try {
        localStream.getTracks().forEach((t) => t.stop());
      } catch {}
      try {
        if (camTrack) camTrack.stop();
      } catch {}
      try {
        pc.close();
      } catch {}
    },
  } as OpenCall;
};

// =============================================================================
// Adaptive media transport
// =============================================================================

// Wait this long for WebRTC ICE before falling back to WebSocket in auto mode.
const ICE_FALLBACK_MS = 6000;

// Resolve true when ICE connects, or false when it fails, closes, or times out.
const waitIceConnected = (pc: RTCPeerConnection, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener("iceconnectionstatechange", onChange);
      resolve(v);
    };
    const onChange = () => {
      const s = pc.iceConnectionState;
      if (s === "connected" || s === "completed") finish(true);
      else if (s === "failed" || s === "closed") finish(false);
      // disconnected/checking may be transient, so wait for the timeout
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    pc.addEventListener("iceconnectionstatechange", onChange);
    onChange(); // Handle a connection established before the listener was attached.
  });

// Adapt a WebSocket call to the OpenCall interface with no video fields.
const wsAdapter = async (
  sid: string,
  callId: string,
  micDeviceId: string | null,
): Promise<OpenCall> => {
  const wsConn = await openWSCall(sid, callId, micDeviceId);
  return {
    pc: null as unknown as RTCPeerConnection, // not used outside this module
    micStream: wsConn.micStream,
    get remoteStream() {
      return wsConn.remoteStream;
    },
    localVideoStream: null,
    remoteVideoStream: null,
    setLocalVideo: wsConn.setLocalVideo,
    close: wsConn.close,
  };
};

/**
 * Open a call using the selected media transport:
 *  - "webrtc": WebRTC audio and video with no fallback.
 *  - "websocket": audio-only WebSocket.
 *  - "auto": WebRTC first, then WebSocket if ICE does not connect before the timeout.
 *
 * Every branch returns the OpenCall interface.
 */
export const openAdaptiveCall = async (
  sid: string,
  callId: string,
  micDeviceId: string | null,
  opts: OpenCallOptions = {},
): Promise<OpenCall> => {
  const mode = getTransportMode();

  if (mode === "websocket") {
    if (opts.video) {
      console.warn("[transport] video is unavailable in WebSocket mode; continuing audio-only");
    }
    return wsAdapter(sid, callId, micDeviceId);
  }

  if (mode === "webrtc") {
    return openCall(sid, callId, micDeviceId, opts);
  }

  // Auto mode falls back without ending the WhatsApp call because the server replaces the bridge.
  try {
    const call = await openCall(sid, callId, micDeviceId, opts);
    if (await waitIceConnected(call.pc, ICE_FALLBACK_MS)) {
      return call;
    }
    console.warn(
      `[transport] WebRTC ICE did not connect within ${ICE_FALLBACK_MS}ms; using audio-only WebSocket`,
    );
    try {
      call.close();
    } catch {
      /* ignore */
    }
  } catch (err) {
    console.warn("[transport] WebRTC setup failed; using audio-only WebSocket", err);
  }
  return wsAdapter(sid, callId, micDeviceId);
};
