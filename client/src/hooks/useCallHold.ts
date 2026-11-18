import { useMutation } from "@tanstack/react-query";
import { holdCall, resumeCall } from "@/services/calls";

// Put a call on hold or resume it. The backend keeps the leg alive and plays hold music
// to the remote party while held is true.
export const useCallHold = () =>
  useMutation({
    mutationFn: async (vars: { sid: string; callId: string; hold: boolean }) => {
      try {
        if (vars.hold) await holdCall(vars.sid, vars.callId);
        else await resumeCall(vars.sid, vars.callId);
      } catch {}
    },
  });
