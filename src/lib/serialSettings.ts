import type { SaleDocumentType } from "@/types";

export const SERIAL_KEYS = {
  INVOICE: { prefix: "app.serial.invoice.prefix", counter: "app.serial.invoice.counter" },
  RECEIPT: { prefix: "app.serial.receipt.prefix", counter: "app.serial.receipt.counter" },
  DELIVERY_NOTE: { prefix: "app.serial.note.prefix", counter: "app.serial.note.counter" },
  PROFORMA: { prefix: "app.serial.proforma.prefix", counter: "app.serial.proforma.counter" },
} as const;

export const DEFAULT_SERIAL: Record<SaleDocumentType, { prefix: string; counter: number }> = {
  INVOICE: { prefix: "INV", counter: 1 },
  RECEIPT: { prefix: "INVC", counter: 1 },
  DELIVERY_NOTE: { prefix: "A", counter: 1 },
  PROFORMA: { prefix: "PRO", counter: 1 },
};

export const SERIAL_PAD = 3;

function readStr(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = localStorage.getItem(key);
  return v == null ? fallback : v;
}

function readNum(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const v = localStorage.getItem(key);
  if (v == null) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function getSerialConfig(doc: SaleDocumentType) {
  const k = SERIAL_KEYS[doc];
  const d = DEFAULT_SERIAL[doc];
  return {
    prefix: readStr(k.prefix, d.prefix),
    counter: readNum(k.counter, d.counter),
  };
}

export function setSerialConfig(doc: SaleDocumentType, prefix: string, counter: number) {
  const k = SERIAL_KEYS[doc];
  localStorage.setItem(k.prefix, prefix);
  localStorage.setItem(k.counter, String(counter));
  window.dispatchEvent(new CustomEvent("form-storage", { detail: { key: k.counter } }));
}

export function formatSerial(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(SERIAL_PAD, "0")}`;
}

/** Consume next serial for a doc type and increment the stored counter. */
export function consumeNextSerial(doc: SaleDocumentType): string {
  const { prefix, counter } = getSerialConfig(doc);
  const next = counter + 1;
  localStorage.setItem(SERIAL_KEYS[doc].counter, String(next));
  window.dispatchEvent(new CustomEvent("form-storage", { detail: { key: SERIAL_KEYS[doc].counter } }));
  return formatSerial(prefix, counter);
}
