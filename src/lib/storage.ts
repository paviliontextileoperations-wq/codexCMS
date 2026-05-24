import { nanoid } from "nanoid";
import type {
  Customer,
  DeliveryStatus,
  DocumentStatus,
  PaymentEntry,
  PaymentMethod,
  Product,
  ReturnEntry,
  Sale,
  SaleLine,
} from "@/types";
import { consumeNextSerial } from "./serialSettings";
import { getColours } from "./colourSettings";
import { DEMO_CUSTOMERS, DEMO_PRODUCTS } from "./demoSeeds";
import { inventoryStore } from "./inventoryStore";
import { recordWrite } from "./opLog";
import { findProductByCode } from "./productCodes";

const KEYS = {
  products: "form.products.v1",
  customers: "form.customers.v1",
  sales: "form.sales.v1",
  counter: "form.invoiceCounter.v1",
} as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

type SyncDeleted = {
  id: string;
  __deleted: true;
  deletedAt: number;
  updatedAt: number;
};

function isDeletedRecord(value: unknown): value is SyncDeleted {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      (("__deleted" in value && Boolean((value as { __deleted?: boolean }).__deleted)) ||
        "deletedAt" in value),
  );
}

function readList<T>(key: string): T[] {
  return read<unknown[]>(key, []).filter((item) => !isDeletedRecord(item)) as T[];
}

function writeList<T extends { id?: string }>(key: string, value: T[]) {
  const tombstones = read<unknown[]>(key, []).filter(isDeletedRecord);
  write(key, [...value, ...tombstones]);
}

function markDeleted(key: string, id: string) {
  const now = Date.now();
  const raw = read<unknown[]>(key, []);
  const next = raw.filter((item) => {
    if (!item || typeof item !== "object" || !("id" in item)) return true;
    return (item as { id?: string }).id !== id;
  });
  next.push({ id, __deleted: true, deletedAt: now, updatedAt: now });
  write(key, next);
}

function write<T>(key: string, value: T) {
  let prev: unknown = undefined;
  try {
    const raw = localStorage.getItem(key);
    prev = raw ? JSON.parse(raw) : undefined;
  } catch {
    prev = undefined;
  }
  try {
    recordWrite(key, prev, value);
  } catch (err) {
    console.warn("Skipping operation log write", err);
  }
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("form-storage", { detail: { key } }));
}

/* ---------- Products ---------- */
export const productsStore = {
  all(): Product[] {
    return readList<Product>(KEYS.products);
  },
  save(list: Product[]) {
    writeList(KEYS.products, list);
  },
  upsert(p: Omit<Product, "id" | "createdAt"> & { id?: string }): Product {
    const list = this.all();
    const now = Date.now();
    if (p.id) {
      const idx = list.findIndex((x) => x.id === p.id);
      if (idx >= 0) {
        const updated = { ...list[idx], ...p, updatedAt: now } as Product;
        list[idx] = updated;
        this.save(list);
        return updated;
      }
    }
    const created: Product = {
      ...p,
      id: nanoid(10),
      createdAt: now,
      updatedAt: now,
    } as Product;
    list.unshift(created);
    this.save(list);
    return created;
  },
  remove(id: string) {
    markDeleted(KEYS.products, id);
  },
  byBarcode(code: string): Product | undefined {
    const t = code.trim();
    if (!t) return undefined;
    return findProductByCode(t, this.all());
  },
  decrementStock(productId: string, qty: number) {
    this.adjustStock(productId, -qty);
  },
  adjustStock(productId: string, quantityChange: number): { previousQty: number; nextQty: number } | undefined {
    const list = this.all();
    const idx = list.findIndex((p) => p.id === productId);
    if (idx >= 0) {
      const previousQty = list[idx].stock;
      const nextQty = Math.max(0, previousQty + quantityChange);
      list[idx] = { ...list[idx], stock: nextQty, updatedAt: Date.now() };
      this.save(list);
      return { previousQty, nextQty };
    }
  },
};

/* ---------- Customers ---------- */
export const customersStore = {
  all(): Customer[] {
    return readList<Customer>(KEYS.customers);
  },
  save(list: Customer[]) {
    writeList(KEYS.customers, list);
  },
  upsert(c: Omit<Customer, "id" | "createdAt"> & { id?: string }): Customer {
    const list = this.all();
    const now = Date.now();
    if (c.id) {
      const idx = list.findIndex((x) => x.id === c.id);
      if (idx >= 0) {
        const updated = { ...list[idx], ...c, updatedAt: now } as Customer;
        list[idx] = updated;
        this.save(list);
        return updated;
      }
    }
    const created: Customer = {
      ...c,
      id: nanoid(10),
      createdAt: now,
      updatedAt: now,
    } as Customer;
    list.unshift(created);
    this.save(list);
    return created;
  },
  remove(id: string) {
    markDeleted(KEYS.customers, id);
  },
  search(q: string): Customer[] {
    const t = q.trim().toLowerCase();
    if (!t) return this.all();
    return this.all().filter(
      (c) =>
        c.id.toLowerCase().includes(t) ||
        c.name.toLowerCase().includes(t) ||
        c.phone.toLowerCase().includes(t) ||
        (c.vatNumber ?? "").toLowerCase().includes(t) ||
        (c.email ?? "").toLowerCase().includes(t),
    );
  },
};

/* ---------- Sales ---------- */
export const salesStore = {
  all(): Sale[] {
    return readList<Sale>(KEYS.sales);
  },
  save(list: Sale[]) {
    writeList(KEYS.sales, list);
  },
  create(sale: Omit<Sale, "id" | "invoiceNumber" | "createdAt"> & { invoiceNumber?: string }): Sale {
    const id = nanoid(12);
    const now = Date.now();
    const isPaid = sale.paymentStatus === "PAID";
    const docType = sale.documentType ?? "INVOICE";
    const assignSerialNow = isPaid || docType === "PROFORMA";
    const created: Sale = {
      ...sale,
      id,
      // Proformas receive their own serial immediately. Other open / partial
      // documents stay as drafts until paid, so invoice numbers are not consumed early.
      invoiceNumber: sale.invoiceNumber
        ? sale.invoiceNumber
        : assignSerialNow
        ? consumeNextSerial(sale.documentType ?? "INVOICE")
        : `DRAFT-${id.slice(0, 6).toUpperCase()}`,
      documentStatus: sale.documentStatus ?? "open",
      deliveryStatus:
        sale.deliveryStatus ??
        (docType === "DELIVERY_NOTE" ? "not_prepared" : "open"),
      salesChannel: sale.salesChannel ?? "physical_store",
      stockMovementCreated: true,
      returns: sale.returns ?? [],
      createdAt: now,
      updatedAt: now,
    };
    const list = this.all();
    list.unshift(created);
    this.save(list);
    // decrement stock + log inventory movements
    created.lines.forEach((l) => {
      const stock = productsStore.adjustStock(l.productId, -l.quantity);
      inventoryStore.log({
        movementType: "sale",
        documentId: created.id,
        productId: l.productId,
        sku: l.barcode,
        previousQty: stock?.previousQty,
        quantityChange: -l.quantity,
        newQty: stock?.nextQty,
      });
    });
    return created;
  },
  byCustomer(customerId: string): Sale[] {
    return this.all().filter((s) => s.customerId === customerId);
  },
  recordPayment(saleId: string, amount: number, method: PaymentMethod, note?: string): Sale | undefined {
    const list = this.all();
    const idx = list.findIndex((s) => s.id === saleId);
    if (idx < 0) return;
    const s = list[idx];
    const entry: PaymentEntry = {
      id: nanoid(8),
      amount,
      method,
      note,
      paymentDate: Date.now(),
      createdAt: Date.now(),
    };
    const payments = [...(s.payments ?? []), entry];
    const amountPaid = Math.min(s.total, (s.amountPaid ?? 0) + amount);
    const amountDue = Math.max(0, s.total - amountPaid);
    const paymentStatus: Sale["paymentStatus"] = amountDue <= 0.0001 ? "PAID" : amountPaid > 0 ? "PARTIAL" : "OPEN";
    // Promote a draft placeholder to a real serial only on full payment.
    const invoiceNumber =
      paymentStatus === "PAID" && s.invoiceNumber.startsWith("DRAFT-")
        ? consumeNextSerial(s.documentType ?? "INVOICE")
        : s.invoiceNumber;
    const updated: Sale = { ...s, payments, amountPaid, amountDue, paymentStatus, invoiceNumber, updatedAt: Date.now() };
    list[idx] = updated;
    this.save(list);
    return updated;
  },
  /** Add a payment with optional explicit date / reference. */
  recordPaymentDetailed(
    saleId: string,
    payload: { amount: number; method: PaymentMethod; reference?: string; note?: string; paymentDate?: number; invoiceNumber?: string },
  ): Sale | undefined {
    const list = this.all();
    const idx = list.findIndex((s) => s.id === saleId);
    if (idx < 0) return;
    const s = list[idx];
    const entry: PaymentEntry = {
      id: nanoid(8),
      amount: payload.amount,
      method: payload.method,
      note: payload.note,
      reference: payload.reference,
      paymentDate: payload.paymentDate ?? Date.now(),
      createdAt: Date.now(),
    };
    const payments = [...(s.payments ?? []), entry];
    const amountPaid = Math.min(s.total, (s.amountPaid ?? 0) + payload.amount);
    const amountDue = Math.max(0, s.total - amountPaid);
    const paymentStatus: Sale["paymentStatus"] =
      amountDue <= 0.0001 ? "PAID" : amountPaid > 0 ? "PARTIAL" : "OPEN";
    const invoiceNumber =
      paymentStatus === "PAID" && s.invoiceNumber.startsWith("DRAFT-")
        ? payload.invoiceNumber ?? consumeNextSerial(s.documentType ?? "INVOICE")
        : s.invoiceNumber;
    const updated: Sale = { ...s, payments, amountPaid, amountDue, paymentStatus, invoiceNumber, updatedAt: Date.now() };
    list[idx] = updated;
    this.save(list);
    return updated;
  },
  /** Cancel a confirmed sale: mark cancelled, restore stock once. */
  cancel(saleId: string, reason: string, by: string): Sale | undefined {
    const list = this.all();
    const idx = list.findIndex((s) => s.id === saleId);
    if (idx < 0) return;
    const s = list[idx];
    if (s.documentStatus === "cancelled") return s;
    if (s.stockMovementCreated) {
      // restore stock
      const products = productsStore.all();
      s.lines.forEach((l) => {
        const i = products.findIndex((p) => p.id === l.productId);
        const previousQty = i >= 0 ? products[i].stock : undefined;
        if (i >= 0) products[i] = { ...products[i], stock: products[i].stock + l.quantity, updatedAt: Date.now() };
        inventoryStore.log({
          movementType: "cancel_restore",
          documentId: s.id,
          productId: l.productId,
          sku: l.barcode,
          previousQty,
          quantityChange: l.quantity,
          newQty: previousQty === undefined ? undefined : previousQty + l.quantity,
          notes: reason,
        });
      });
      productsStore.save(products);
    }
    const updated: Sale = {
      ...s,
      documentStatus: "cancelled",
      cancelledAt: Date.now(),
      cancelledBy: by,
      cancellationReason: reason,
      stockMovementCreated: false,
      updatedAt: Date.now(),
    };
    list[idx] = updated;
    this.save(list);
    return updated;
  },
  /** Convert a delivery note (or proforma) to an INVOICE without re-deducting stock. */
  convertToInvoice(saleId: string, invoiceNumber?: string): Sale | undefined {
    const list = this.all();
    const src = list.find((s) => s.id === saleId);
    if (!src) return;
    if (src.documentStatus === "cancelled") return;
    const newId = nanoid(12);
    const isPaid = src.paymentStatus === "PAID";
    const created: Sale = {
      ...src,
      id: newId,
      documentType: "INVOICE",
      documentStatus: "open",
      sourceDocumentId: src.id,
      // Stock was already moved on the source document; do NOT double-deduct.
      stockMovementCreated: false,
      invoiceNumber: isPaid ? invoiceNumber ?? consumeNextSerial("INVOICE") : `DRAFT-${newId.slice(0, 6).toUpperCase()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    // Mark source as converted.
    const next = list.map((s) =>
      s.id === src.id ? { ...s, documentStatus: "converted" as DocumentStatus, updatedAt: Date.now() } : s,
    );
    next.unshift(created);
    this.save(next);
    return created;
  },
  /** Record a return / refund for one line. Optionally restores stock. */
  recordReturn(
    saleId: string,
    payload: Omit<ReturnEntry, "id" | "createdAt">,
  ): Sale | undefined {
    const list = this.all();
    const idx = list.findIndex((s) => s.id === saleId);
    if (idx < 0) return;
    const s = list[idx];
    const entry: ReturnEntry = { ...payload, id: nanoid(8), createdAt: Date.now() };
    if (entry.stockAction === "back_to_stock") {
      const products = productsStore.all();
      const i = products.findIndex((p) => p.id === entry.productId);
      const previousQty = i >= 0 ? products[i].stock : undefined;
      if (i >= 0) {
        products[i] = { ...products[i], stock: products[i].stock + entry.quantity, updatedAt: Date.now() };
        productsStore.save(products);
      }
      inventoryStore.log({
        movementType: "return",
        documentId: s.id,
        productId: entry.productId,
        previousQty,
        quantityChange: entry.quantity,
        newQty: previousQty === undefined ? undefined : previousQty + entry.quantity,
        notes: entry.reason,
      });
    }
    const returns = [...(s.returns ?? []), entry];
    // Refunded amount reduces effective amountPaid; pendingAmount adjusts so it remains accurate.
    const refundedTotal = returns.reduce((a, r) => a + r.refundAmount, 0);
    const amountPaid = Math.max(0, (s.amountPaid ?? 0) - entry.refundAmount);
    const amountDue = Math.max(0, s.total - refundedTotal - amountPaid);
    const updated: Sale = {
      ...s,
      returns,
      amountPaid,
      amountDue,
      deliveryStatus: "returned",
      updatedAt: Date.now(),
    };
    list[idx] = updated;
    this.save(list);
    return updated;
  },
  /** Manually set the delivery / preparation status. */
  setDeliveryStatus(saleId: string, status: DeliveryStatus): Sale | undefined {
    const list = this.all();
    const idx = list.findIndex((s) => s.id === saleId);
    if (idx < 0) return;
    const updated: Sale = { ...list[idx], deliveryStatus: status, updatedAt: Date.now() };
    list[idx] = updated;
    this.save(list);
    return updated;
  },
  /**
   * Replace the line items of an open/partial sale, reconciling stock and recomputing totals.
   * Tax rate and transport fee are preserved from the original sale.
   */
  updateLines(
    saleId: string,
    newLines: Sale["lines"],
    transportOverride?: Sale["transport"],
  ): Sale | undefined {
    const list = this.all();
    const idx = list.findIndex((s) => s.id === saleId);
    if (idx < 0) return;
    const s = list[idx];

    // Reconcile stock based on per-product quantity delta.
    const prevByProduct = new Map<string, number>();
    s.lines.forEach((l) => prevByProduct.set(l.productId, (prevByProduct.get(l.productId) ?? 0) + l.quantity));
    const nextByProduct = new Map<string, number>();
    newLines.forEach((l) => nextByProduct.set(l.productId, (nextByProduct.get(l.productId) ?? 0) + l.quantity));
    const ids = new Set([...prevByProduct.keys(), ...nextByProduct.keys()]);
    ids.forEach((pid) => {
      const delta = (nextByProduct.get(pid) ?? 0) - (prevByProduct.get(pid) ?? 0);
      if (delta > 0) {
        const stock = productsStore.adjustStock(pid, -delta);
        inventoryStore.log({
          movementType: "sale",
          documentId: s.id,
          productId: pid,
          previousQty: stock?.previousQty,
          quantityChange: -delta,
          newQty: stock?.nextQty,
          notes: "Order line quantity increased",
        });
      }
      else if (delta < 0) {
        // restore stock
        const all = productsStore.all();
        const i = all.findIndex((p) => p.id === pid);
        const previousQty = i >= 0 ? all[i].stock : undefined;
        if (i >= 0) {
          all[i] = { ...all[i], stock: all[i].stock + -delta, updatedAt: Date.now() };
          productsStore.save(all);
          inventoryStore.log({
            movementType: "cancel_restore",
            documentId: s.id,
            productId: pid,
            previousQty,
            quantityChange: -delta,
            newQty: previousQty === undefined ? undefined : previousQty + -delta,
            notes: "Order line quantity reduced",
          });
        }
      }
    });

    const subtotal = newLines.reduce(
      (a, l) => a + l.unitPrice * l.quantity * (1 - (l.discountPct ?? 0) / 100),
      0,
    );
    const tax = subtotal * (s.taxRate ?? 0);
    const transport = transportOverride ?? s.transport;
    const transportFee = transport?.fee ?? 0;
    const total = subtotal + tax + transportFee;
    const taxBreakdown = s.taxBreakdown
      ? {
          ...s.taxBreakdown,
          vatAmount: subtotal * s.taxBreakdown.vat,
          surchargeAmount: subtotal * s.taxBreakdown.surcharge,
        }
      : s.taxBreakdown;
    const amountPaid = Math.min(total, s.amountPaid ?? 0);
    const amountDue = Math.max(0, total - amountPaid);
    const paymentStatus: Sale["paymentStatus"] =
      amountDue <= 0.0001 ? "PAID" : amountPaid > 0 ? "PARTIAL" : "OPEN";
    const updated: Sale = {
      ...s,
      lines: newLines,
      transport,
      subtotal,
      tax,
      total,
      taxBreakdown,
      amountPaid,
      amountDue,
      paymentStatus,
      updatedAt: Date.now(),
    };
    list[idx] = updated;
    this.save(list);
    return updated;
  },
  /** Update invoice metadata and fiscal values without changing stock movement history. */
  updateInvoice(
    saleId: string,
    patch: Partial<
      Pick<
        Sale,
        | "documentType"
        | "documentStatus"
        | "invoiceNumber"
        | "dueDate"
        | "invoiceNotes"
        | "invoiceTaxProfile"
        | "taxRate"
        | "taxBreakdown"
        | "transport"
      >
    >,
  ): Sale | undefined {
    const list = this.all();
    const idx = list.findIndex((s) => s.id === saleId);
    if (idx < 0) return;
    const s = list[idx];
    const subtotal = s.lines.reduce(
      (a, l) => a + l.unitPrice * l.quantity * (1 - (l.discountPct ?? 0) / 100),
      0,
    );
    const taxRate = patch.taxRate ?? s.taxRate ?? 0;
    const taxBreakdownSource =
      patch.taxBreakdown ?? (patch.taxRate === undefined ? s.taxBreakdown : undefined);
    const taxBreakdown = taxBreakdownSource
      ? {
          ...taxBreakdownSource,
          vatAmount: subtotal * taxBreakdownSource.vat,
          surchargeAmount: subtotal * taxBreakdownSource.surcharge,
        }
      : undefined;
    const tax = taxBreakdown ? taxBreakdown.vatAmount + taxBreakdown.surchargeAmount : subtotal * taxRate;
    const transport = patch.transport === undefined ? s.transport : patch.transport;
    const transportFee = transport?.fee ?? 0;
    const total = subtotal + tax + transportFee;
    const amountPaid = Math.min(total, s.amountPaid ?? 0);
    const amountDue = Math.max(0, total - amountPaid);
    const paymentStatus: Sale["paymentStatus"] =
      amountDue <= 0.0001 ? "PAID" : amountPaid > 0 ? "PARTIAL" : "OPEN";
    const updated: Sale = {
      ...s,
      ...patch,
      subtotal,
      taxRate,
      tax,
      taxBreakdown,
      transport,
      total,
      amountPaid,
      amountDue,
      paymentStatus,
      updatedAt: Date.now(),
    };
    list[idx] = updated;
    this.save(list);
    return updated;
  },
};

/* ---------- Seed (first run) ---------- */
export function seedIfEmpty() {
  if (localStorage.getItem("app.cloud.ready") === "1") {
    return;
  }
  // One-time wipe of legacy seeded products
  if (!localStorage.getItem("form.products.wiped.v1")) {
    localStorage.setItem("form.products.wiped.v1", "1");
  }
  seedDemoProductsIfNeeded();
  seedDemoCustomersIfNeeded();
  // Backfill: ensure every product has a Model (barcode "P###") and SKU (Model+ColourCode+Size)
  backfillModelsAndSkus();
  if (customersStore.all().length === 0) {
    customersStore.upsert({
      name: "Atelier",
      surname: "Marlow",
      businessType: "EU VAT",
      businessName: "Atelier Marlow Ltd",
      phoneCountryCode: "+44",
      phoneNumber: "20 7946 0991",
      phone: "+44 20 7946 0991",
      vatNumber: "GB123456789",
      email: "orders@marlow.co",
      fiscalAddress: { line1: "12 Hanbury St", line2: "", additionalInfo: "", postalCode: "E1 6QR", provinceState: "London", country: "United Kingdom" },
      logisticsAddress: { line1: "12 Hanbury St", line2: "", additionalInfo: "", postalCode: "E1 6QR", provinceState: "London", country: "United Kingdom" },
      address: "12 Hanbury St, London",
    });
    customersStore.upsert({
      name: "Studio",
      surname: "Noir",
      businessType: "EU VAT",
      businessName: "Studio Noir SARL",
      phoneCountryCode: "+33",
      phoneNumber: "1 42 60 30 30",
      phone: "+33 1 42 60 30 30",
      vatNumber: "FR40123456824",
      email: "hello@studionoir.fr",
      fiscalAddress: { line1: "5 Rue Debelleyme", line2: "", additionalInfo: "", postalCode: "75003", provinceState: "Île-de-France", country: "France" },
      logisticsAddress: { line1: "5 Rue Debelleyme", line2: "", additionalInfo: "", postalCode: "75003", provinceState: "Île-de-France", country: "France" },
      address: "5 Rue Debelleyme, Paris",
    });
  }
}

function seedDemoProductsIfNeeded() {
  const existing = productsStore.all();
  const existingSkus = new Set(existing.map((product) => product.sku));
  const missing = DEMO_PRODUCTS.filter((product) => !existingSkus.has(product.sku));
  if (missing.length === 0) return;

  const now = Date.now();
  const created = missing.map((product, index) => ({
    ...product,
    createdAt: now - index * 60_000,
  }));
  productsStore.save([...created, ...existing]);
}

function seedDemoCustomersIfNeeded() {
  const existing = customersStore.all();
  const legacySeedEmails = new Set(["orders@marlow.co", "hello@studionoir.fr"]);
  const base =
    existing.length > 0 && existing.every((customer) => legacySeedEmails.has(customer.email ?? ""))
      ? []
      : existing;
  const existingEmails = new Set(base.map((customer) => customer.email).filter(Boolean));
  const missing = DEMO_CUSTOMERS.filter((customer) => !existingEmails.has(customer.email));
  if (missing.length === 0) return;

  const now = Date.now();
  const created = missing.map((customer, index) => ({
    ...customer,
    createdAt: now - index * 60_000,
  }));
  customersStore.save([...created, ...base]);
}

function backfillModelsAndSkus() {
  const list = productsStore.all();
  if (list.length === 0) return;
  const colours = getColours();
  // find current max P number across existing model codes
  let max = 0;
  for (const p of list) {
    const m = (p.barcode || "").match(/^P(\d{3,})$/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  // group siblings (same name+category) so they share a Model number
  const groupKey = (p: Product) => `${(p.name || "").toLowerCase()}|${(p.category || "").toLowerCase()}`;
  const assigned = new Map<string, string>();
  let changed = false;
  const updated = list.map((p) => {
    let model = p.barcode && /^P\d{3,}$/i.test(p.barcode) ? p.barcode : "";
    if (!model) {
      const key = groupKey(p);
      if (assigned.has(key)) {
        model = assigned.get(key)!;
      } else {
        max += 1;
        model = `P${String(max).padStart(3, "0")}`;
        assigned.set(key, model);
      }
      changed = true;
    }
    const colourCode = colours.find((c) => c.name.toLowerCase() === (p.color || "").toLowerCase())?.code ?? "";
    const sku = model && colourCode && p.size ? `${model}${colourCode}${p.size}` : p.sku || "";
    if (model !== p.barcode || sku !== p.sku) {
      changed = true;
      return { ...p, barcode: model, sku };
    }
    return p;
  });
  if (changed) productsStore.save(updated);
}
