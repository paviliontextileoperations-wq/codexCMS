import { Cloud, CloudOff, RefreshCw } from "lucide-react";
import { useCloudSyncStatus } from "@/lib/cloudSync";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

function labelFor(language: string, phase: string, enabled: boolean) {
  if (!enabled) {
    if (language === "zh") return "本地";
    if (language === "es") return "Local";
    return "Local";
  }

  if (phase === "connecting") {
    if (language === "zh") return "连接中";
    if (language === "es") return "Conectando";
    return "Connecting";
  }

  if (phase === "syncing") {
    if (language === "zh") return "同步中";
    if (language === "es") return "Sincronizando";
    return "Syncing";
  }

  if (phase === "offline") {
    if (language === "zh") return "离线";
    if (language === "es") return "Sin conexión";
    return "Offline";
  }

  if (language === "zh") return "云端";
  if (language === "es") return "Nube";
  return "Cloud";
}

function lastSyncText(language: string, value?: number) {
  if (!value) return "";
  const time = new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (language === "zh") return `最后同步 ${time}`;
  if (language === "es") return `Ultima sync ${time}`;
  return `Last sync ${time}`;
}

export function CloudSyncStatus() {
  const { language } = useI18n();
  const status = useCloudSyncStatus();
  const active = status.enabled && status.phase !== "offline";
  const syncing = status.phase === "syncing" || status.phase === "connecting";
  const label = labelFor(language, status.phase, status.enabled);
  const lastSync = lastSyncText(language, status.lastSyncAt);
  const Icon = !status.enabled || status.phase === "offline" ? CloudOff : syncing ? RefreshCw : Cloud;
  const title = status.message ? `${label} - ${status.message}` : lastSync || label;

  return (
    <button
      type="button"
      onClick={() => void status.syncNow()}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 border px-2 text-[10px] uppercase tracking-[0.16em] transition-colors",
        active
          ? "border-foreground/20 text-foreground hover:border-foreground"
          : "border-bauhaus-red/40 text-bauhaus-red hover:border-bauhaus-red hover:text-bauhaus-red",
      )}
      title={title}
    >
      <Icon className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
      <span className="hidden md:inline">{label}</span>
      {lastSync && active ? (
        <span className="hidden text-muted-foreground xl:inline">
          {new Date(status.lastSyncAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </span>
      ) : null}
    </button>
  );
}
