import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { customersStore, productsStore, salesStore } from "@/lib/storage";
import { TAX_KEYS } from "@/lib/taxSettings";
import { TRANSPORT_KEYS } from "@/lib/transportSettings";
import { setRibbonTitle } from "@/lib/brandSettings";
import { getColours, setColours } from "@/lib/colourSettings";
import { maintenanceStore } from "@/lib/maintenanceStore";

const KEY = "form.approvals.v1";
const EVT = "form-approvals";

export type ApprovalStatus = "pending" | "approved" | "declined";

export type ApprovalAction =
  | { type: "delete_customer"; customerId: string; customerName: string }
  | { type: "delete_product"; productId: string; productName: string }
  | { type: "delete_sale"; saleId: string; invoiceNumber: string }
  | { type: "delete_colour"; code: string; name: string }
  | { type: "approve_temporary_product"; productId: string; productName: string }
  | { type: "resolve_maintenance"; maintenanceId: string; summary: string }
  | {
      type: "settings_change";
      label: string;
      changes: Array<
        | { kind: "localStorage"; key: string; value: string; previous: string | null }
        | { kind: "ribbonTitle"; value: string; previous: string }
        | { kind: "customerTaxRate"; customerId: string; customerName: string; value: number | null; previous: number | null }
      >;
    };

export type ApprovalRequest = {
  id: string;
  action: ApprovalAction;
  requestedBy: string;
  requestedAt: number;
  status: ApprovalStatus;
  resolvedBy?: string;
  resolvedAt?: number;
  declineReason?: string;
};

function read(): ApprovalRequest[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ApprovalRequest[];
  } catch {
    return [];
  }
}

function write(list: ApprovalRequest[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent(EVT));
}

export const approvalsStore = {
  all(): ApprovalRequest[] {
    return read();
  },
  pending(): ApprovalRequest[] {
    return read().filter((r) => r.status === "pending");
  },
  request(action: ApprovalAction, requestedBy: string): ApprovalRequest {
    const req: ApprovalRequest = {
      id: nanoid(10),
      action,
      requestedBy,
      requestedAt: Date.now(),
      status: "pending",
    };
    const list = read();
    list.unshift(req);
    write(list);
    return req;
  },
  approve(id: string, resolvedBy: string) {
    const list = read();
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const req = list[idx];
    if (req.status !== "pending") return;
    executeAction(req.action);
    list[idx] = { ...req, status: "approved", resolvedBy, resolvedAt: Date.now() };
    write(list);
  },
  decline(id: string, resolvedBy: string, reason?: string) {
    const list = read();
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const req = list[idx];
    if (req.status !== "pending") return;
    list[idx] = {
      ...req,
      status: "declined",
      resolvedBy,
      resolvedAt: Date.now(),
      declineReason: reason,
    };
    write(list);
  },
  clearResolved() {
    write(read().filter((r) => r.status === "pending"));
  },
};

function executeAction(action: ApprovalAction) {
  switch (action.type) {
    case "delete_customer":
      customersStore.remove(action.customerId);
      break;
    case "delete_product":
      productsStore.remove(action.productId);
      break;
    case "delete_sale": {
      const list = salesStore.all().filter((s) => s.id !== action.saleId);
      salesStore.save(list);
      break;
    }
    case "delete_colour": {
      setColours(getColours().filter((c) => c.code !== action.code));
      break;
    }
    case "approve_temporary_product": {
      const product = productsStore.all().find((p) => p.id === action.productId);
      if (!product) break;
      productsStore.upsert({
        ...product,
        temporaryProduct: false,
        maintenanceStatus: "approved",
        maintenanceApprovedAt: Date.now(),
      });
      break;
    }
    case "resolve_maintenance":
      maintenanceStore.resolve(action.maintenanceId);
      break;
    case "settings_change":
      for (const c of action.changes) {
        if (c.kind === "localStorage") {
          localStorage.setItem(c.key, c.value);
        } else if (c.kind === "ribbonTitle") {
          setRibbonTitle(c.value);
        } else if (c.kind === "customerTaxRate") {
          const customer = customersStore.all().find((cu) => cu.id === c.customerId);
          if (!customer) continue;
          const next = { ...customer };
          if (c.value === null) {
            delete next.taxRate;
          } else {
            next.taxRate = c.value;
          }
          customersStore.upsert(next);
        }
      }
      // Notify any settings UI listening to localStorage changes.
      window.dispatchEvent(new StorageEvent("storage"));
      break;
  }
}

// Re-export keys so other files can build settings_change payloads consistently.
export const SETTINGS_KEYS = {
  tax: TAX_KEYS,
  transport: TRANSPORT_KEYS,
};

export function describeAction(a: ApprovalAction): string {
  switch (a.type) {
    case "delete_customer":
      return `Delete customer "${a.customerName}"`;
    case "delete_product":
      return `Delete product "${a.productName}"`;
    case "delete_sale":
      return `Delete sale ${a.invoiceNumber}`;
    case "delete_colour":
      return `Delete colour "${a.name}" (${a.code})`;
    case "approve_temporary_product":
      return `Approve temporary product "${a.productName}"`;
    case "resolve_maintenance":
      return `Resolve maintenance: ${a.summary}`;
    case "settings_change":
      return `Settings change: ${a.label}`;
  }
}

export function useApprovals(): ApprovalRequest[] {
  const [list, setList] = useState<ApprovalRequest[]>(() => read());
  useEffect(() => {
    const handler = () => setList(read());
    window.addEventListener(EVT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);
  return list;
}

export function usePendingApprovalsCount(): number {
  return useApprovals().filter((r) => r.status === "pending").length;
}

/** Set of entity ids (customer/product/sale) that currently have a pending delete request. */
export function usePendingDeletes(): {
  customers: Set<string>;
  products: Set<string>;
  sales: Set<string>;
  colours: Set<string>;
  temporaryProducts: Set<string>;
  maintenance: Set<string>;
} {
  const all = useApprovals();
  const customers = new Set<string>();
  const products = new Set<string>();
  const sales = new Set<string>();
  const colours = new Set<string>();
  const temporaryProducts = new Set<string>();
  const maintenance = new Set<string>();
  for (const r of all) {
    if (r.status !== "pending") continue;
    if (r.action.type === "delete_customer") customers.add(r.action.customerId);
    else if (r.action.type === "delete_product") products.add(r.action.productId);
    else if (r.action.type === "delete_sale") sales.add(r.action.saleId);
    else if (r.action.type === "delete_colour") colours.add(r.action.code);
    else if (r.action.type === "approve_temporary_product") temporaryProducts.add(r.action.productId);
    else if (r.action.type === "resolve_maintenance") maintenance.add(r.action.maintenanceId);
  }
  return { customers, products, sales, colours, temporaryProducts, maintenance };
}
