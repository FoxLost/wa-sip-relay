import { H264_CHANNEL_LABEL } from "@/constants/video";
import { VideoReceiver, VideoSender, videoSupported } from "./video-codec";

export type VideoChannel = {
  // Available with WebCodecs support and used to render peer video.
  remoteVideoStream: MediaStream | null;
  // Enable or disable camera sending for mid-call upgrades and downgrades.
  startSender: (track: MediaStreamTrack) => void;
  stopSender: () => void;
  close: () => void;
};

const noVideoChannel: VideoChannel = {
  remoteVideoStream: null,
  startSender: () => {},
  stopSender: () => {},
  close: () => {},
};

// Open the H264 data channel and receiver even for audio-only calls so mid-call video upgrades
// do not require SDP renegotiation. Camera sending starts lazily. WebCodecs failures must never
// drop audio, so unsupported or failed setup falls back to this no-op channel.
export const setupVideoChannel = (pc: RTCPeerConnection): VideoChannel => {
  if (!videoSupported()) return noVideoChannel;
  try {
    return buildVideoChannel(pc);
  } catch (e) {
    console.warn("video channel setup failed; audio-only call", e);
    return noVideoChannel;
  }
};

const buildVideoChannel = (pc: RTCPeerConnection): VideoChannel => {
  const receiver = new VideoReceiver();
  const videoDc = pc.createDataChannel(H264_CHANNEL_LABEL, {
    ordered: false,
    maxRetransmits: 0,
  });
  videoDc.binaryType = "arraybuffer";
  videoDc.onmessage = (e: MessageEvent<ArrayBuffer>) => receiver.decode(e.data);

  let sender: VideoSender | null = null;
  let pending: MediaStreamTrack | null = null;
  let open = false;

  const startNow = (track: MediaStreamTrack) => {
    sender?.close();
    sender = new VideoSender(track, (au) => {
      if (videoDc.readyState === "open") videoDc.send(au);
    });
  };

  videoDc.onopen = () => {
    open = true;
    if (pending) {
      startNow(pending);
      pending = null;
    }
  };

  return {
    remoteVideoStream: receiver.stream,
    startSender: (track) => {
      if (open) startNow(track);
      else pending = track; // Send as soon as the channel opens.
    },
    stopSender: () => {
      try {
        sender?.close();
      } catch {}
      sender = null;
      pending = null;
    },
    close: () => {
      try {
        sender?.close();
      } catch {}
      try {
        receiver.close();
      } catch {}
    },
  };
};
