import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { openAdaptiveCall as openCall } from "@/lib/webrtc";
import { pickupCall, resumeCall } from "@/services/calls";
import { registerOwnConnection, clearTransferOffer } from "@/stores/calls";

// Take ownership of a transferred call, open a replacement WebRTC bridge, and resume it.
// Unlike acceptance, this does not accept the WhatsApp call again.
export const usePickupCall = (micId: string | null) =>
  useMutation({
    mutationFn: async (vars: { sid: string; callId: string }) => {
      const res = await pickupCall(vars.sid, vars.callId);
      const id = res.call.callId;
      const conn = await openCall(vars.sid, id, micId, { video: false });
      registerOwnConnection(id, conn);
      await resumeCall(vars.sid, id); // Resume only after the new bridge owns the call.
      clearTransferOffer();
      return id;
    },
    onError: (e: Error) => {
      clearTransferOffer();
      toast.error(e.message);
    },
  });
