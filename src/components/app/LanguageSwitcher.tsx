import { LANGUAGES, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { language, setLanguage, t } = useI18n();

  return (
    <div
      data-i18n-skip="true"
      className={cn("inline-flex border border-foreground/30 bg-background text-[10px] uppercase tracking-[0.16em]", className)}
      aria-label={t("Change language")}
    >
      {LANGUAGES.map((item) => {
        const active = item.code === language;
        return (
          <button
            key={item.code}
            type="button"
            onClick={() => setLanguage(item.code)}
            className={cn(
              "h-8 min-w-10 px-2 transition-colors",
              active
                ? "bg-foreground text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
            aria-pressed={active}
            title={item.label}
          >
            {item.shortLabel}
          </button>
        );
      })}
    </div>
  );
}
