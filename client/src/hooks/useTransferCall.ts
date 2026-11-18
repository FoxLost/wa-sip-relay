import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { transferCall } from "@/services/calls";

// Blind transfer: place the call on hold with music and offer it to another operator.
// An optional target is the operator client ID; without one, use the account queue.
export const useTransferCall = () =>
  useMutation({
    mutationFn: async (vars: { sid: string; callId: string; to?: string }) => {
      await transferCall(vars.sid, vars.callId, vars.to);
    },
    onSuccess: () => toast.success("Call transferred"),
    onError: (e: Error) => toast.error(e.message),
  });
