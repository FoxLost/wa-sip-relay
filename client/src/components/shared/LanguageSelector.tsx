import { Languages } from "lucide-react";
import { useLanguage, type Language } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const LanguageSelector = ({ className }: { className?: string }) => {
  const { language, setLanguage, t } = useLanguage();

  return (
    <label className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <Languages className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">{t("Language")}</span>
      <select
        value={language}
        onChange={(event) => setLanguage(event.target.value as Language)}
        aria-label={t("Language")}
        className="rounded-md border bg-background px-2 py-1 text-sm text-foreground"
      >
        <option value="en">{t("English")}</option>
        <option value="id">{t("Indonesian")}</option>
      </select>
    </label>
  );
};
