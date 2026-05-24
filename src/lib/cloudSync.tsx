import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { scheduleInvoicePdfBackfill } from "./invoiceBackfill";

const CLIENT_ID_KEY = "app.cloud.clientId";
const CLOUD_READY_KEY = "app.cloud.ready";
const PUSH_DEBOUNCE_MS = 1200;
const PULL_INTERVAL_MS = 15_000;
const INITIAL_TIMEOUT_MS = 5000;

export const CLOUD_SYNC_KEYS = [
  "form.products.v1",
  "form.customers.v1",
  "form.sales.v1",
  "form.inventoryMovements.v1",
  "form.inventoryLocations.v1",
  "form.productMaintenance.v1",
  "form.imageGallery.v1",
  "form.products.wiped.v1",
  "app.company.name",
  "app.company.vat",
  "app.company.address",
  "app.company.beneficiary",
  "app.company.bank",
  "app.company.swift",
  "app.tax.b2bDefault",
  "app.tax.b2cDefault",
  "app.products.defaultB2cMarkupPercent",
  "app.transport.defaultFee",
  "app.serial.invoice.prefix",
  "app.serial.invoice.counter",
  "app.serial.receipt.prefix",
  "app.serial.receipt.counter",
  "app.serial.note.prefix",
  "app.serial.note.counter",
  "app.serial.proforma.prefix",
  "app.serial.proforma.counter",
  "app.brand.ribbonTitle",
  "app.colours",
  "form.accounts.v1",
  "form.approvals.v1",
  "form.opLog.v1",
] as const;

type CloudSyncPhase = "local" | "connecting" | "online" | "syncing" | "offline";

type CloudSyncStatus = {
  ready: boolean;
  enabled: boolean;
  phase: CloudSyncPhase;
  message?: string;
  lastSyncAt?: number;
  pendingCount?: number;
};

type CloudRecord = {
  key: string;
  raw: string | null;
  updatedAt?: string;
  clientId?: string | null;
};

type CloudSyncContextValue = CloudSyncStatus & {
  syncNow: () => Promise<void>;
};

const CloudSyncContext = createContext<CloudSyncContextValue | null>(null);
const syncKeySet = new Set<string>(CLOUD_SYNC_KEYS);
const mergeableArrayKeys = new Set<string>([
  "form.products.v1",
  "form.customers.v1",
  "form.sales.v1",
  "form.inventoryMovements.v1",
  "form.inventoryLocations.v1",
  "form.productMaintenance.v1",
  "form.imageGallery.v1",
  "form.approvals.v1",
  "form.opLog.v1",
]);
const refreshEvents = ["form-storage", "form-auth", "form-approvals", "form-oplog", "app:brand-changed", "app:company-changed"];

function randomClientId() {
  const cryptoId = window.crypto?.randomUUID?.();
  return cryptoId ?? `desktop-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getClientId(originalSetItem: typeof localStorage.setItem) {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  const next = randomClientId();
  originalSetItem.call(localStorage, CLIENT_ID_KEY, next);
  return next;
}

function isSyncKey(key: string | null | undefined) {
  return Boolean(key && syncKeySet.has(key));
}

function dispatchRefresh(key: string) {
  window.dispatchEvent(new CustomEvent("form-storage", { detail: { key } }));
  for (const eventName of refreshEvents) {
    window.dispatchEvent(new CustomEvent(eventName));
  }
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

function collectRecords(): CloudRecord[] {
  return CLOUD_SYNC_KEYS.flatMap((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? [] : [{ key, raw }];
  });
}

function parseArray(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function itemKey(item: unknown, index: number) {
  if (!item || typeof item !== "object") return `index:${index}`;
  const record = item as Record<string, unknown>;
  return String(record.id ?? record.productId ?? record.fileName ?? record.invoiceNumber ?? `index:${index}`);
}

function itemTs(item: unknown) {
  if (!item || typeof item !== "object") return 0;
  const record = item as Record<string, unknown>;
  const raw = record.updatedAt ?? record.deletedAt ?? record.resolvedAt ?? record.createdAt ?? 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeArrayRaw(localRaw: string | null, remoteRaw: string | null) {
  const local = parseArray(localRaw);
  const remote = parseArray(remoteRaw);
  if (!local || !remote) return remoteRaw;
  const map = new Map<string, unknown>();
  const put = (item: unknown, index: number) => {
    const key = itemKey(item, index);
    const current = map.get(key);
    if (!current || itemTs(item) >= itemTs(current)) map.set(key, item);
  };
  remote.forEach(put);
  local.forEach(put);
  const localKeys = local.map((item, index) => itemKey(item, index));
  const remoteKeys = remote.map((item, index) => itemKey(item, index));
  const order = [...localKeys, ...remoteKeys.filter((key) => !localKeys.includes(key))];
  return JSON.stringify(order.map((key) => map.get(key)).filter(Boolean));
}

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const desktopApp = window.desktopApp;
  const enabled = Boolean(desktopApp?.cloudPull && desktopApp?.cloudPush);
  const originalSetItemRef = useRef(Storage.prototype.setItem);
  const originalRemoveItemRef = useRef(Storage.prototype.removeItem);
  const applyingRemoteRef = useRef(false);
  const dirtyRef = useRef(false);
  const pushTimerRef = useRef<number | undefined>(undefined);
  const syncingRef = useRef(false);
  const [status, setStatus] = useState<CloudSyncStatus>(() => ({
    ready: !enabled,
    enabled,
    phase: enabled ? "connecting" : "local",
  }));

  const applyRemoteRecords = useCallback((records: CloudRecord[]) => {
    applyingRemoteRef.current = true;
    try {
      for (const record of records) {
        if (!isSyncKey(record.key)) continue;
        const current = localStorage.getItem(record.key);
        if (record.raw === null) {
          if (current !== null) {
            originalRemoveItemRef.current.call(localStorage, record.key);
            dispatchRefresh(record.key);
          }
          continue;
        }
        const nextRaw =
          record.clientId !== "normalized-hydration" && mergeableArrayKeys.has(record.key) && current
            ? mergeArrayRaw(current, record.raw)
            : record.raw;
        if (current !== nextRaw) {
          originalSetItemRef.current.call(localStorage, record.key, nextRaw);
          dispatchRefresh(record.key);
        }
      }
      originalSetItemRef.current.call(localStorage, CLOUD_READY_KEY, "1");
    } finally {
      applyingRemoteRef.current = false;
    }
  }, []);

  const pullNow = useCallback(async () => {
    if (!enabled || !desktopApp?.cloudPull) return;
    const result = await desktopApp.cloudPull({ keys: [...CLOUD_SYNC_KEYS] });
    applyRemoteRecords(result.records);
    void desktopApp.reconcileInventory?.({ actor: "cloud-sync" }).catch(() => undefined);
    scheduleInvoicePdfBackfill();
    setStatus({
      ready: true,
      enabled: true,
      phase: "online",
      lastSyncAt: Date.now(),
      pendingCount: dirtyRef.current ? collectRecords().length : 0,
    });
  }, [applyRemoteRecords, desktopApp, enabled]);

  const pushNow = useCallback(async () => {
    if (!enabled || !desktopApp?.cloudPush || syncingRef.current) return;
    const records = collectRecords();
    if (records.length === 0) return;
    syncingRef.current = true;
    setStatus((current) => ({ ...current, ready: true, phase: "syncing" }));
    try {
      await desktopApp.cloudPush({ clientId: getClientId(originalSetItemRef.current), records });
      dirtyRef.current = false;
      setStatus({
        ready: true,
        enabled: true,
        phase: "online",
        lastSyncAt: Date.now(),
        pendingCount: 0,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloud sync failed";
      setStatus((current) => ({
        ...current,
        ready: true,
        phase: "offline",
        message,
        pendingCount: records.length,
      }));
    } finally {
      syncingRef.current = false;
    }
  }, [desktopApp, enabled]);

  const schedulePush = useCallback(() => {
    if (!enabled) return;
    dirtyRef.current = true;
    setStatus((current) => ({
      ...current,
      ready: true,
      pendingCount: collectRecords().length,
    }));
    window.clearTimeout(pushTimerRef.current);
    pushTimerRef.current = window.setTimeout(() => {
      void pushNow();
    }, PUSH_DEBOUNCE_MS);
  }, [enabled, pushNow]);

  const syncNow = useCallback(async () => {
    if (!enabled) return;
    if (dirtyRef.current) {
      await pushNow();
    }
    await pullNow();
  }, [enabled, pullNow, pushNow]);

  useEffect(() => {
    if (!enabled) return;

    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    originalSetItemRef.current = originalSetItem;
    originalRemoveItemRef.current = originalRemoveItem;

    Storage.prototype.setItem = function patchedSetItem(key: string, value: string) {
      originalSetItem.call(this, key, value);
      if (!applyingRemoteRef.current && this === localStorage && isSyncKey(key)) {
        schedulePush();
      }
    };

    Storage.prototype.removeItem = function patchedRemoveItem(key: string) {
      originalRemoveItem.call(this, key);
      if (!applyingRemoteRef.current && this === localStorage && isSyncKey(key)) {
        schedulePush();
      }
    };

    const initialTimer = window.setTimeout(() => {
      setStatus((current) => (current.ready ? current : { ...current, ready: true, phase: "offline", message: "Cloud connection timeout" }));
    }, INITIAL_TIMEOUT_MS);

    void pullNow()
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Cloud sync failed";
        setStatus({
          ready: true,
          enabled: true,
          phase: "offline",
          message,
          pendingCount: collectRecords().length,
        });
      })
      .finally(() => window.clearTimeout(initialTimer));

    const interval = window.setInterval(() => {
      void syncNow().catch((error) => {
        const message = error instanceof Error ? error.message : "Cloud sync failed";
        setStatus((current) => ({
          ...current,
          ready: true,
          phase: "offline",
          message,
          pendingCount: collectRecords().length,
        }));
      });
    }, PULL_INTERVAL_MS);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearTimeout(pushTimerRef.current);
      window.clearInterval(interval);
      Storage.prototype.setItem = originalSetItem;
      Storage.prototype.removeItem = originalRemoveItem;
    };
  }, [enabled, pullNow, schedulePush, syncNow]);

  const value = useMemo<CloudSyncContextValue>(
    () => ({
      ...status,
      enabled,
      syncNow,
    }),
    [enabled, status, syncNow],
  );

  if (!status.ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="text-center">
          <div className="mx-auto mb-5 h-8 w-8 animate-spin border-2 border-foreground border-r-transparent" />
          <div className="font-display text-lg uppercase tracking-[0.25em]">Pavilion Textile CMS</div>
          <div className="mt-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">Connecting cloud data</div>
        </div>
      </div>
    );
  }

  return <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>;
}

export function useCloudSyncStatus() {
  const value = useContext(CloudSyncContext);
  if (!value) {
    return {
      ready: true,
      enabled: false,
      phase: "local" as CloudSyncPhase,
      message: undefined,
      lastSyncAt: undefined,
      pendingCount: 0,
      syncNow: async () => undefined,
    };
  }
  return value;
}
