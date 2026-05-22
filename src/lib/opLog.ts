import { useEffect, useState } from "react";
import { getSession } from "./auth";

export type OpLogEntry = {
  id: string;
  key: string;
  label: string;
  prev: unknown;
  next: unknown;
  user?: string;
  role?: string;
  timestamp: number;
  undone?: boolean;
};

const LOG_KEY = "form.opLog.v1";
const EVT = "form-oplog";
const MAX_ENTRIES = 500;
const MAX_ENTRY_JSON_CHARS = 120_000;
const MAX_LOG_JSON_CHARS = 1_000_000;

/** Human-readable label for a storage key. */
function labelFor(key: string): string {
  switch (key) {
    case "form.products.v1":
      return "Products";
    case "form.customers.v1":
      return "Customers";
    case "form.sales.v1":
      return "Sales / Orders";
    case "form.invoiceCounter.v1":
      return "Invoice counter";
    case "form.accounts.v1":
      return "Accounts";
    case "form.session.v1":
      return "Session";
    case "form.approvals.v1":
      return "Approvals";
    case "form.inventory.v1":
      return "Inventory log";
    default:
      return key;
  }
}

function readLog(): OpLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as OpLogEntry[];
  } catch {
    return [];
  }
}

function writeLog(list: OpLogEntry[]) {
  let next = list;
  let payload = JSON.stringify(next);
  while (payload.length > MAX_LOG_JSON_CHARS && next.length > 20) {
    next = next.slice(0, Math.max(20, Math.floor(next.length / 2)));
    payload = JSON.stringify(next);
  }
  if (payload.length > MAX_LOG_JSON_CHARS) {
    next = next.map((entry) => ({
      ...entry,
      prev: "[large snapshot omitted from log]",
      next: "[large snapshot omitted from log]",
    }));
    payload = JSON.stringify(next);
  }
  localStorage.setItem(LOG_KEY, payload);
  window.dispatchEvent(new CustomEvent(EVT));
}

/** Random short id (avoids importing nanoid in a tight loop). */
function rid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Keys we want to record in the operational log. */
const TRACKED = new Set([
  "form.products.v1",
  "form.customers.v1",
  "form.sales.v1",
  "form.invoiceCounter.v1",
  "form.accounts.v1",
  "form.approvals.v1",
  "form.inventory.v1",
]);

function stripLargeMedia(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripLargeMedia);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    if ((key === "image" || key === "mainImage") && typeof item === "string" && item.startsWith("data:")) {
      out[key] = "[image omitted from log]";
      return;
    }
    out[key] = stripLargeMedia(item);
  });
  return out;
}

function compactSnapshot(value: unknown): unknown {
  try {
    if (JSON.stringify(value).length <= MAX_ENTRY_JSON_CHARS) return value;
    const compacted = stripLargeMedia(value);
    if (JSON.stringify(compacted).length <= MAX_ENTRY_JSON_CHARS) return compacted;
    return "[large snapshot omitted from log]";
  } catch {
    return "[unserializable snapshot omitted from log]";
  }
}

/**
 * Append a log entry capturing the previous and next value of a tracked key.
 * Called from storage `write()` before persisting the new value.
 */
export function recordWrite(key: string, prev: unknown, next: unknown) {
  if (!TRACKED.has(key)) return;
  // Skip pure no-ops.
  try {
    if (JSON.stringify(prev) === JSON.stringify(next)) return;
  } catch {
    /* ignore */
  }
  const safePrev = compactSnapshot(prev);
  const safeNext = compactSnapshot(next);
  const session = getSession();
  const entry: OpLogEntry = {
    id: rid(),
    key,
    label: labelFor(key),
    prev: safePrev,
    next: safeNext,
    user: session?.username,
    role: session?.role,
    timestamp: Date.now(),
  };
  const list = readLog();
  list.unshift(entry);
  if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
  writeLog(list);
}

/** Restore an entry's previous value. Marks the entry as undone. */
export function undoEntry(id: string): boolean {
  const list = readLog();
  const entry = list.find((e) => e.id === id);
  if (!entry || entry.undone) return false;
  try {
    if (entry.prev === undefined || entry.prev === null) {
      localStorage.removeItem(entry.key);
    } else {
      localStorage.setItem(entry.key, JSON.stringify(entry.prev));
    }
    // Notify the regular storage listeners so views refresh.
    window.dispatchEvent(new CustomEvent("form-storage", { detail: { key: entry.key } }));
  } catch {
    return false;
  }
  const next = list.map((e) => (e.id === id ? { ...e, undone: true } : e));
  writeLog(next);
  return true;
}

export function clearLog() {
  writeLog([]);
}

export function useOpLog(): OpLogEntry[] {
  const [list, setList] = useState<OpLogEntry[]>(() => readLog());
  useEffect(() => {
    const handler = () => setList(readLog());
    window.addEventListener(EVT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);
  return list;
}

/** Best-effort short summary describing the change for the table view. */
export function describeEntry(entry: OpLogEntry): string {
  const details = diffEntry(entry);
  if (!details.length) return "Updated";
  const head = details[0];
  const more = details.length - 1;
  return more > 0 ? `${head} (+${more} more)` : head;
}

/** Pick a human-friendly identifier from an item. */
function itemLabel(item: unknown): string {
  if (!item || typeof item !== "object") return String(item ?? "");
  const o = item as Record<string, unknown>;
  const name = (o.name as string) || (o.businessName as string) || "";
  const code = (o.sku as string) || (o.barcode as string) || (o.invoiceNumber as string) || "";
  if (name && code) return `${name} [${code}]`;
  if (name) return name;
  if (code) return code;
  if (typeof o.id === "string") return `#${o.id.slice(0, 6)}`;
  return "item";
}

function fmtVal(v: unknown): string {
  if (v === undefined || v === null || v === "") return "∅";
  if (typeof v === "object") {
    try {
      const s = JSON.stringify(v);
      return s.length > 60 ? s.slice(0, 57) + "…" : s;
    } catch {
      return "[object]";
    }
  }
  const s = String(v);
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

/** Compare two records and return field-level diff lines. */
function diffObject(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys) {
    if (k === "id" || k === "createdAt") continue;
    const av = a?.[k];
    const bv = b?.[k];
    let same = false;
    try {
      same = JSON.stringify(av) === JSON.stringify(bv);
    } catch {
      same = av === bv;
    }
    if (same) continue;
    lines.push(`${k}: ${fmtVal(av)} → ${fmtVal(bv)}`);
  }
  return lines;
}

/** Build a detailed diff for an op-log entry. */
export function diffEntry(entry: OpLogEntry): string[] {
  const prev = entry.prev;
  const next = entry.next;
  // Numeric (e.g. invoice counter)
  if (typeof prev === "number" || typeof next === "number") {
    return [`${fmtVal(prev)} → ${fmtVal(next)}`];
  }
  // Arrays of objects with ids – do per-item diffs.
  if (Array.isArray(prev) || Array.isArray(next)) {
    const a = (Array.isArray(prev) ? prev : []) as Record<string, unknown>[];
    const b = (Array.isArray(next) ? next : []) as Record<string, unknown>[];
    const aMap = new Map(a.map((x) => [x?.id as string, x]));
    const bMap = new Map(b.map((x) => [x?.id as string, x]));
    const lines: string[] = [];
    // Added
    for (const [id, item] of bMap) {
      if (!aMap.has(id)) lines.push(`Added "${itemLabel(item)}"`);
    }
    // Removed
    for (const [id, item] of aMap) {
      if (!bMap.has(id)) lines.push(`Removed "${itemLabel(item)}"`);
    }
    // Modified
    for (const [id, ai] of aMap) {
      const bi = bMap.get(id);
      if (!bi) continue;
      const fieldDiffs = diffObject(ai, bi);
      if (fieldDiffs.length) {
        const label = itemLabel(bi);
        for (const fd of fieldDiffs) lines.push(`${label}: ${fd}`);
      }
    }
    return lines;
  }
  // Plain objects
  if (prev && next && typeof prev === "object" && typeof next === "object") {
    return diffObject(prev as Record<string, unknown>, next as Record<string, unknown>);
  }
  return [`${fmtVal(prev)} → ${fmtVal(next)}`];
}