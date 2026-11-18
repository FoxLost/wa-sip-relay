import { Phone, PhoneForwarded, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCalls, clearTransferOffer } from "@/stores/calls";
import { useDevices } from "@/stores/devices";
import { usePickupCall } from "@/hooks/usePickupCall";

// Shown to the target operator when a call is transferred. The remote party hears hold music
// until the target accepts and takes ownership of the call.
export const TransferOfferModal = () => {
  const offer = useCalls((s) => s.transferOffer);
  const micId = useDevices((s) => s.micId);
  const pickup = usePickupCall(micId);

  return (
    <Dialog open={!!offer}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="sm:max-w-sm"
      >
        <DialogHeader className="items-center text-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <PhoneForwarded className="h-7 w-7" />
          </div>
          <DialogTitle>Transferred call</DialogTitle>
          <DialogDescription className="truncate">{offer?.peer}</DialogDescription>
        </DialogHeader>
        <div className="mt-2 flex items-center justify-center gap-6">
          <Button
            variant="outline"
            size="icon"
            className="h-14 w-14 rounded-full"
            disabled={pickup.isPending}
            onClick={() => clearTransferOffer()}
            aria-label="Dismiss"
          >
            <X className="h-6 w-6" />
          </Button>
          <Button
            size="icon"
            className="h-14 w-14 rounded-full"
            disabled={pickup.isPending}
            onClick={() => offer && pickup.mutate({ sid: offer.sessionId, callId: offer.callId })}
            aria-label="Answer"
          >
            <Phone className="h-6 w-6" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
