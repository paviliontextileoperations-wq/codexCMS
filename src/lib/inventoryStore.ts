import { nanoid } from "nanoid";
import type { InventoryLocation, InventoryMovement } from "@/types";
import { recordWrite } from "./opLog";

const KEY = "form.inventoryMovements.v1";
const LOCATIONS_KEY = "form.inventoryLocations.v1";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  let previous: unknown = undefined;
  try {
    const raw = localStorage.getItem(key);
    previous = raw ? JSON.parse(raw) : undefined;
  } catch {
    previous = undefined;
  }
  try {
    recordWrite(key, previous, value);
  } catch {
    // Inventory writes should never fail because the audit log is full or unavailable.
  }
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("form-storage", { detail: { key } }));
}

function readMovements(): InventoryMovement[] {
  return readJson<InventoryMovement[]>(KEY, []);
}

function writeMovements(list: InventoryMovement[]) {
  writeJson(KEY, list);
}

export const inventoryStore = {
  all(): InventoryMovement[] {
    return readMovements();
  },
  byDocument(documentId: string): InventoryMovement[] {
    return readMovements().filter((m) => m.documentId === documentId);
  },
  log(m: Omit<InventoryMovement, "id" | "createdAt">): InventoryMovement {
    const now = Date.now();
    const entry: InventoryMovement = { ...m, id: nanoid(10), createdAt: now, updatedAt: now };
    const list = readMovements();
    list.unshift(entry);
    writeMovements(list);
    return entry;
  },
};

export const inventoryLocationStore = {
  all(): InventoryLocation[] {
    return readJson<InventoryLocation[]>(LOCATIONS_KEY, []);
  },
  byProduct(productId: string): InventoryLocation | undefined {
    return this.all().find((item) => item.productId === productId);
  },
  set(productId: string, warehouse: string, location: string): InventoryLocation {
    const list = this.all();
    const existing = list.findIndex((item) => item.productId === productId);
    const entry: InventoryLocation = {
      productId,
      warehouse,
      location,
      updatedAt: Date.now(),
    };
    if (existing >= 0) {
      list[existing] = entry;
    } else {
      list.unshift(entry);
    }
    writeJson(LOCATIONS_KEY, list);
    return entry;
  },
};
