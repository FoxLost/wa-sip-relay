import { create } from "zustand";
import { eventStream, type BrokerEvent } from "@/lib/event-stream";
import { getClientId } from "@/lib/client-id";
import { queryClient, queryKeys } from "@/lib/query";
import type { OpenCall } from "@/lib/webrtc";
import type { CallSummary, IncomingPayload, TransferOfferPayload } from "@/types/call";

// Per-call video negotiation state. Peer state comes from backend SSE events while localVideo
// reflects the browser camera, which the backend cannot observe directly.
export type CallVideoState = {
  peerVideo: boolean;
  localVideo: boolean;
  upgradeIncoming: boolean;
  upgradeOutgoing: boolean;
  /** Peer camera orientation from RTP in clockwise quarter turns. */
  peerOrientation: number;
};

const emptyVideo = (): CallVideoState => ({
  peerVideo: false,
  localVideo: false,
  upgradeIncoming: false,
  upgradeOutgoing: false,
  peerOrientation: 0,
});

type State = {
  calls: CallSummary[];
  ownConnections: Map<string, OpenCall>;
  videoStates: Map<string, CallVideoState>;
  incoming: IncomingPayload | null;
  transferOffer: TransferOfferPayload | null;
};

export const useCalls = create<State>(() => ({
  calls: [],
  ownConnections: new Map(),
  videoStates: new Map(),
  incoming: null,
  transferOffer: null,
}));

const patchVideo = (id: string, patch: Partial<CallVideoState>): void => {
  useCalls.setState((s) => {
    const next = new Map(s.videoStates);
    next.set(id, { ...(next.get(id) ?? emptyVideo()), ...patch });
    return { videoStates: next };
  });
};

let wired = false;
export const ensureCallsWired = (): void => {
  if (wired) return;
  wired = true;
  eventStream.on((ev: BrokerEvent) => {
    if (ev.type === "call-list") {
      useCalls.setState({ calls: ev.calls });
    } else if (ev.type === "call-status") {
      useCalls.setState((s) => ({
        calls: s.calls.map((c) =>
          c.callId === ev.id
            ? { ...c, sessionId: ev.sessionId, status: ev.status, peer: ev.peer, startedAt: ev.startedAt, held: ev.held ?? false }
            : c,
        ),
      }));
    } else if (ev.type === "call-ended") {
      useCalls.setState((s) => {
        const conn = s.ownConnections.get(ev.id);
        if (conn) conn.close();
        const next = new Map(s.ownConnections);
        next.delete(ev.id);
        const nextVideo = new Map(s.videoStates);
        nextVideo.delete(ev.id);
        return {
          calls: s.calls.filter((c) => c.callId !== ev.id),
          ownConnections: next,
          videoStates: nextVideo,
          incoming: s.incoming?.callId === ev.id ? null : s.incoming,
          transferOffer: s.transferOffer?.callId === ev.id ? null : s.transferOffer,
        };
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.history });
    } else if (ev.type === "incoming") {
      useCalls.setState({ incoming: { sessionId: ev.sessionId, callId: ev.id, peer: ev.peer, video: ev.video, offeredAt: ev.offeredAt } });
    } else if (ev.type === "incoming-claimed") {
      useCalls.setState((s) => (s.incoming?.callId === ev.id ? { incoming: null } : s));
    } else if (ev.type === "call-transfer-offer") {
      // Do not show a transfer offer to the operator who initiated it.
      if (ev.from !== getClientId()) {
        useCalls.setState({
          transferOffer: { sessionId: ev.sessionId, callId: ev.id, peer: ev.peer, from: ev.from, offeredAt: ev.offeredAt },
        });
      }
    } else if (ev.type === "call-transfer-claimed") {
      useCalls.setState((s) => (s.transferOffer?.callId === ev.id ? { transferOffer: null } : s));
    } else if (ev.type === "video-state") {
      // localVideo is client-owned and must not be overwritten with backend state.
      patchVideo(ev.id, {
        peerVideo: ev.peerVideo,
        upgradeIncoming: ev.upgradeIncoming,
        upgradeOutgoing: ev.upgradeOutgoing,
        peerOrientation: ev.peerOrientation ?? 0,
      });
    }
  });
};

export const isMine = (call: CallSummary): boolean => call.owner === getClientId();

export const registerOwnConnection = (id: string, conn: OpenCall, initialVideo = false): void => {
  useCalls.setState((s) => {
    const next = new Map(s.ownConnections);
    next.set(id, conn);
    return { ownConnections: next };
  });
  if (initialVideo) patchVideo(id, { localVideo: true });
};

// Reflect whether the operator camera is active.
export const setLocalVideoState = (id: string, on: boolean): void => patchVideo(id, { localVideo: on });

export const clearIncoming = (): void => useCalls.setState({ incoming: null });

export const clearTransferOffer = (): void => useCalls.setState({ transferOffer: null });
