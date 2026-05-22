import { nanoid } from "nanoid";
import { useEffect, useState, useCallback } from "react";

export type MaintenanceReason =
  | "cannot_find_product"
  | "missing_physical_barcode"
  | "wrong_price"
  | "other";

export type MaintenanceItem = {
  id: string;
  reason: MaintenanceReason;
  reasonOther?: string;
  associatedSku?: string;
  note?: string;
  photo?: string; // data URL
  resolved: boolean;
  resolvedAt?: number;
  createdAt: number;
  createdBy?: string;
  diagnostics?: string;
};

const KEY = "form.productMaintenance.v1";

function read(): MaintenanceItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as MaintenanceItem[]) : [];
  } catch {
    return [];
  }
}

function write(list: MaintenanceItem[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("form-storage", { detail: { key: KEY } }));
}

export const maintenanceStore = {
  all(): MaintenanceItem[] {
    return read().sort((a, b) => b.createdAt - a.createdAt);
  },
  add(item: Omit<MaintenanceItem, "id" | "createdAt" | "resolved">): MaintenanceItem {
    const created: MaintenanceItem = {
      ...item,
      id: nanoid(10),
      createdAt: Date.now(),
      resolved: false,
    };
    write([created, ...read()]);
    return created;
  },
  update(id: string, patch: Partial<MaintenanceItem>) {
    write(read().map((x) => (x.id === id ? { ...x, ...patch } : x)));
  },
  resolve(id: string) {
    write(
      read().map((x) =>
        x.id === id ? { ...x, resolved: true, resolvedAt: Date.now() } : x,
      ),
    );
  },
  remove(id: string) {
    write(read().filter((x) => x.id !== id));
  },
};

export function useMaintenance(): MaintenanceItem[] {
  const [data, setData] = useState<MaintenanceItem[]>(() => maintenanceStore.all());
  const refresh = useCallback(() => setData(maintenanceStore.all()), []);
  useEffect(() => {
    const h = () => refresh();
    window.addEventListener("form-storage", h);
    window.addEventListener("storage", h);
    return () => {
      window.removeEventListener("form-storage", h);
      window.removeEventListener("storage", h);
    };
  }, [refresh]);
  return data;
}

export const REASON_LABELS: Record<MaintenanceReason, string> = {
  cannot_find_product: "Cannot find the product",
  missing_physical_barcode: "Missing physical barcode",
  wrong_price: "Wrong price",
  other: "Other",
};