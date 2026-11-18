import { useState } from "react";
import { toast } from "sonner";
import { callVideo } from "@/services/calls";
import { setLocalVideoState, useCalls, type CallVideoState } from "@/stores/calls";
import type { CallSummary } from "@/types/call";

const empty: CallVideoState = {
  peerVideo: false,
  localVideo: false,
  upgradeIncoming: false,
  upgradeOutgoing: false,
  peerOrientation: 0,
};

// Handle mid-call video actions: request an upgrade, downgrade to audio, and accept or reject
// peer upgrades. The browser camera is controlled through OpenCall while the backend receives
// signaling through callVideo.
export const useCallVideo = (call: CallSummary) => {
  const conn = useCalls((s) => s.ownConnections.get(call.callId));
  const state = useCalls((s) => s.videoStates.get(call.callId)) ?? empty;
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message || "Video negotiation failed");
    } finally {
      setBusy(false);
    }
  };

  // Enable the camera and request an upgrade from the remote party.
  const enable = () =>
    run(async () => {
      if (!conn) return;
      const ok = await conn.setLocalVideo(true);
      if (!ok) {
        toast.error("This browser does not support camera video");
        return;
      }
      setLocalVideoState(call.callId, true);
      await callVideo(call.sessionId, call.callId, "request");
    });

  // Disable the camera and downgrade to audio.
  const disable = () =>
    run(async () => {
      await callVideo(call.sessionId, call.callId, "stop").catch(() => {});
      if (conn) await conn.setLocalVideo(false);
      setLocalVideoState(call.callId, false);
    });

  // Accept a peer upgrade request and enable the camera.
  const accept = () =>
    run(async () => {
      await callVideo(call.sessionId, call.callId, "accept");
      if (conn) {
        const ok = await conn.setLocalVideo(true);
        setLocalVideoState(call.callId, ok);
      }
    });

  // Reject a peer upgrade request.
  const reject = () =>
    run(async () => {
      await callVideo(call.sessionId, call.callId, "reject");
    });

  return { state, busy, enable, disable, accept, reject };
};
