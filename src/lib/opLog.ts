import { useEffect, useState } from "react";
import { getSession } from "./auth";

type ArrayUndoPatch = {
  kind: "array-by-id";
  key: string;
  addedIds: string[];
  removedItems: Record<string, unknown>[];
  updatedItems: Record<string, unknown>[];
};

type ValueUndoPatch = {
  kind: "value";
  key: string;
  previous: unknown;
};

type UndoPatch = ArrayUndoPatch | ValueUndoPatch;

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
  summary?: string[];
  undoPatch?: UndoPatch;
};

const LOG_KEY = "form.opLog.v1";
const EVT = "form-oplog";
const OMITTED = "[snapshot omitted]";
const MAX_ENTRIES = 500;
const MAX_ENTRY_JSON_CHARS = 120_000;
const MAX_LOG_JSON_CHARS = 1_000_000;
const MAX_UNDO_PATCH_CHARS = 90_000;
const MAX_UNDO_ITEMS = 100;

function labelFor(key: string): string {
  switch (key) {
    case "form.products.v1":
      return "产品";
    case "form.customers.v1":
      return "客户";
    case "form.sales.v1":
      return "订单/发票";
    case "form.invoiceCounter.v1":
      return "发票序号";
    case "form.accounts.v1":
      return "账号";
    case "form.session.v1":
      return "登录状态";
    case "form.approvals.v1":
      return "审批";
    case "form.inventory.v1":
    case "form.inventoryMovements.v1":
      return "库存流水";
    case "form.inventoryLocations.v1":
      return "库存位置";
    case "form.imageGallery.v1":
      return "图片";
    case "form.productMaintenance.v1":
      return "产品维护";
    default:
      return key;
  }
}

function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    name: "名称",
    businessName: "公司名",
    phone: "电话",
    email: "邮箱",
    vatNumber: "VAT/税号",
    clientType: "客户类型",
    invoicePreference: "发票类型",
    address: "地址",
    fiscalAddress: "财务地址",
    deliveryAddress: "送货地址",
    sku: "SKU",
    otherSku: "其他 SKU",
    barcode: "型号",
    category: "分类",
    fineCategory: "细分类",
    color: "颜色",
    size: "尺码",
    price: "B2B 价格",
    b2cPrice: "B2C 价格",
    b2cMarkup: "B2C 加价",
    stock: "库存",
    lowStockThreshold: "低库存阈值",
    quantity: "数量",
    quantityChange: "库存变化",
    previousQty: "原库存",
    newQty: "新库存",
    movementType: "操作类型",
    reason: "原因",
    warehouse: "仓库",
    location: "库位",
    invoiceNumber: "单号",
    paymentStatus: "付款状态",
    deliveryStatus: "配送状态",
    documentType: "单据类型",
    documentStatus: "单据状态",
    subtotal: "小计",
    tax: "税额",
    total: "总计",
    amountPaid: "已付",
    amountDue: "待付",
    updatedAt: "更新时间",
  };
  return labels[key] ?? key;
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
  let next = list.slice(0, MAX_ENTRIES);
  let payload = JSON.stringify(next);
  while (payload.length > MAX_LOG_JSON_CHARS && next.length > 50) {
    next = next.slice(0, next.length - 50);
    payload = JSON.stringify(next);
  }
  if (payload.length > MAX_LOG_JSON_CHARS) {
    next = next.map((entry, index) => (
      index < 30
        ? entry
        : { ...entry, prev: OMITTED, next: OMITTED, undoPatch: undefined }
    ));
    payload = JSON.stringify(next);
  }
  while (payload.length > MAX_LOG_JSON_CHARS && next.length > 20) {
    next = next.slice(0, next.length - 10);
    payload = JSON.stringify(next);
  }
  localStorage.setItem(LOG_KEY, payload);
  window.dispatchEvent(new CustomEvent(EVT));
}

function rid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

const TRACKED = new Set([
  "form.products.v1",
  "form.customers.v1",
  "form.sales.v1",
  "form.invoiceCounter.v1",
  "form.accounts.v1",
  "form.approvals.v1",
  "form.inventory.v1",
  "form.inventoryMovements.v1",
  "form.inventoryLocations.v1",
  "form.imageGallery.v1",
  "form.productMaintenance.v1",
]);

function stripLargeMedia(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripLargeMedia);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    if ((key === "image" || key === "mainImage") && typeof item === "string" && item.startsWith("data:")) {
      out[key] = "[image omitted]";
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
    return OMITTED;
  } catch {
    return "[unserializable snapshot omitted]";
  }
}

function getId(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const id = (item as Record<string, unknown>).id;
  return typeof id === "string" && id ? id : null;
}

function safeJsonLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Infinity;
  }
}

function buildUndoPatch(key: string, prev: unknown, next: unknown): UndoPatch | undefined {
  if (Array.isArray(prev) || Array.isArray(next)) {
    const before = (Array.isArray(prev) ? prev : []).filter((item) => getId(item)) as Record<string, unknown>[];
    const after = (Array.isArray(next) ? next : []).filter((item) => getId(item)) as Record<string, unknown>[];
    const beforeMap = new Map(before.map((item) => [getId(item) as string, item]));
    const afterMap = new Map(after.map((item) => [getId(item) as string, item]));

    const addedIds: string[] = [];
    const removedItems: Record<string, unknown>[] = [];
    const updatedItems: Record<string, unknown>[] = [];

    for (const [id] of afterMap) {
      if (!beforeMap.has(id)) addedIds.push(id);
    }
    for (const [id, item] of beforeMap) {
      if (!afterMap.has(id)) removedItems.push(item);
    }
    for (const [id, item] of beforeMap) {
      const afterItem = afterMap.get(id);
      if (!afterItem) continue;
      if (safeJsonLength(item) !== safeJsonLength(afterItem) || JSON.stringify(item) !== JSON.stringify(afterItem)) {
        updatedItems.push(item);
      }
    }

    const changeCount = addedIds.length + removedItems.length + updatedItems.length;
    if (changeCount === 0 || changeCount > MAX_UNDO_ITEMS) return undefined;
    const patch: ArrayUndoPatch = { kind: "array-by-id", key, addedIds, removedItems, updatedItems };
    return safeJsonLength(patch) <= MAX_UNDO_PATCH_CHARS ? patch : undefined;
  }

  const patch: ValueUndoPatch = { kind: "value", key, previous: prev };
  return safeJsonLength(patch) <= MAX_UNDO_PATCH_CHARS ? patch : undefined;
}

function applyUndoPatch(patch: UndoPatch) {
  if (patch.kind === "value") {
    if (patch.previous === undefined || patch.previous === null) localStorage.removeItem(patch.key);
    else localStorage.setItem(patch.key, JSON.stringify(patch.previous));
    return;
  }

  const raw = localStorage.getItem(patch.key);
  const current = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(current)) throw new Error("Current value is not a list");

  const addedIds = new Set(patch.addedIds);
  const restoreMap = new Map<string, Record<string, unknown>>();
  [...patch.removedItems, ...patch.updatedItems].forEach((item) => {
    const id = getId(item);
    if (id) restoreMap.set(id, item);
  });

  const next = current
    .filter((item) => {
      const id = getId(item);
      return !id || !addedIds.has(id);
    })
    .map((item) => {
      const id = getId(item);
      return id && restoreMap.has(id) ? restoreMap.get(id) : item;
    });

  for (const item of patch.removedItems) {
    const id = getId(item);
    if (!id) continue;
    if (!next.some((candidate) => getId(candidate) === id)) next.unshift(item);
  }

  localStorage.setItem(patch.key, JSON.stringify(next));
}

function summarizePatch(key: string, patch: UndoPatch, nextValue: unknown): string[] {
  if (patch.kind === "value") return [`${labelFor(key)} 已修改`];

  const label = labelFor(key);
  const after = (Array.isArray(nextValue) ? nextValue : []).filter((item) => getId(item)) as Record<string, unknown>[];
  const afterMap = new Map(after.map((item) => [getId(item) as string, item]));
  const lines: string[] = [];

  patch.addedIds.slice(0, 8).forEach((id) => {
    lines.push(`新增${label}: ${itemLabel(afterMap.get(id) ?? { id })}`);
  });
  patch.removedItems.slice(0, 8).forEach((item) => {
    lines.push(`删除${label}: ${itemLabel(item)}`);
  });
  patch.updatedItems.slice(0, 8).forEach((before) => {
    const id = getId(before);
    const afterItem = id ? afterMap.get(id) : undefined;
    const diffs = afterItem ? diffObject(before, afterItem).slice(0, 3) : [];
    if (diffs.length) lines.push(`修改${label} ${itemLabel(afterItem)}: ${diffs.join("; ")}`);
    else lines.push(`修改${label}: ${itemLabel(before)}`);
  });

  const total = patch.addedIds.length + patch.removedItems.length + patch.updatedItems.length;
  if (total > lines.length) lines.push(`还有 ${total - lines.length} 项变动`);
  return lines;
}

function summarizeChange(key: string, prev: unknown, next: unknown, patch?: UndoPatch): string[] {
  if (patch) {
    const lines = summarizePatch(key, patch, next);
    if (lines.length) return lines;
  }
  return diffValues(prev, next).slice(0, 20);
}

export function recordWrite(key: string, prev: unknown, next: unknown) {
  if (!TRACKED.has(key)) return;
  try {
    if (JSON.stringify(prev) === JSON.stringify(next)) return;
  } catch {
    /* ignore */
  }

  const undoPatch = buildUndoPatch(key, prev, next);
  const summary = summarizeChange(key, prev, next, undoPatch);
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
    summary,
    undoPatch,
  };
  const list = readLog();
  list.unshift(entry);
  if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
  writeLog(list);
}

export function canUndoEntry(entry: OpLogEntry): boolean {
  return Boolean(!entry.undone && entry.undoPatch);
}

export function undoEntry(id: string): boolean {
  const list = readLog();
  const entry = list.find((e) => e.id === id);
  if (!entry || entry.undone || !entry.undoPatch) return false;
  try {
    applyUndoPatch(entry.undoPatch);
    window.dispatchEvent(new CustomEvent("form-storage", { detail: { key: entry.key } }));
  } catch (error) {
    console.warn("Failed to undo log entry", error);
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

export function describeEntry(entry: OpLogEntry): string {
  const details = diffEntry(entry);
  if (!details.length) return "已更新";
  const head = details[0];
  const more = details.length - 1;
  return more > 0 ? `${head}，另有 ${more} 项` : head;
}

function itemLabel(item: unknown): string {
  if (!item || typeof item !== "object") return String(item ?? "");
  const o = item as Record<string, unknown>;
  const name = (o.name as string) || (o.businessName as string) || (o.customerName as string) || "";
  const code =
    (o.sku as string) ||
    (o.otherSku as string) ||
    (o.barcode as string) ||
    (o.invoiceNumber as string) ||
    (o.skuCode as string) ||
    "";
  if (name && code) return `${name} [${code}]`;
  if (name) return name;
  if (code) return code;
  if (typeof o.id === "string") return `#${o.id.slice(0, 8)}`;
  return "项目";
}

function fmtVal(v: unknown): string {
  if (v === undefined || v === null || v === "") return "-";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "object") {
    try {
      const s = JSON.stringify(v);
      return s.length > 70 ? `${s.slice(0, 67)}...` : s;
    } catch {
      return "[object]";
    }
  }
  const s = String(v);
  return s.length > 70 ? `${s.slice(0, 67)}...` : s;
}

function diffObject(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys) {
    if (k === "id" || k === "createdAt" || k === "updatedAt") continue;
    const av = a?.[k];
    const bv = b?.[k];
    let same = false;
    try {
      same = JSON.stringify(av) === JSON.stringify(bv);
    } catch {
      same = av === bv;
    }
    if (same) continue;
    lines.push(`${fieldLabel(k)}: ${fmtVal(av)} -> ${fmtVal(bv)}`);
  }
  return lines;
}

function diffValues(prev: unknown, next: unknown): string[] {
  if (prev === OMITTED || next === OMITTED) {
    return ["此日志只保留了压缩快照，不能显示具体变动。"];
  }
  if (typeof prev === "number" || typeof next === "number") {
    return [`${fmtVal(prev)} -> ${fmtVal(next)}`];
  }
  if (Array.isArray(prev) || Array.isArray(next)) {
    const a = (Array.isArray(prev) ? prev : []) as Record<string, unknown>[];
    const b = (Array.isArray(next) ? next : []) as Record<string, unknown>[];
    const aMap = new Map(a.map((x) => [getId(x), x]).filter(([id]) => id));
    const bMap = new Map(b.map((x) => [getId(x), x]).filter(([id]) => id));
    const lines: string[] = [];
    for (const [id, item] of bMap) {
      if (!aMap.has(id)) lines.push(`新增: ${itemLabel(item)}`);
    }
    for (const [id, item] of aMap) {
      if (!bMap.has(id)) lines.push(`删除: ${itemLabel(item)}`);
    }
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
  if (prev && next && typeof prev === "object" && typeof next === "object") {
    return diffObject(prev as Record<string, unknown>, next as Record<string, unknown>);
  }
  return [`${fmtVal(prev)} -> ${fmtVal(next)}`];
}

export function diffEntry(entry: OpLogEntry): string[] {
  if (entry.summary?.length) return entry.summary;
  if (!entry.undoPatch && (entry.prev === OMITTED || entry.next === OMITTED)) {
    return ["旧日志内容过大，已压缩；后续新日志会显示具体变动。"];
  }
  return diffValues(entry.prev, entry.next);
}
