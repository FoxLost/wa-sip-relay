import { useState } from "react";
import { History } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/shared/EmptyState";
import { useHistory } from "@/hooks/useHistory";
import { useLanguage } from "@/lib/i18n";

export const HistoryDrawer = ({ sid }: { sid: string }) => {
  const { language, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const { data: rows = [] } = useHistory(sid, open);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <History className="h-4 w-4" />
          {t("Call history")}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full p-0 sm:max-w-md">
        <SheetHeader className="p-6 pb-4">
          <SheetTitle>{t("Call history")}</SheetTitle>
        </SheetHeader>
        <Separator />
        <ScrollArea className="h-[calc(100vh-5.5rem)] px-6 py-4">
          {rows.length === 0 ? (
            <EmptyState title={t("No previous calls")} description={t("Completed incoming and outgoing calls appear here.")} />
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.callId} className="rounded-lg border p-3">
                  <p className="font-medium">{r.peer}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(r.direction === "incoming" ? "Incoming" : r.direction === "outgoing" ? "Outgoing" : r.direction)}
                    {" · "}
                    {new Date(r.startedAt).toLocaleString(language === "id" ? "id-ID" : "en-US")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
