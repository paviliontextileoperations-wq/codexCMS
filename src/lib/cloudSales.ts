import type { Sale, SaleDocumentType } from "@/types";
import { getSerialConfig, setSerialConfig } from "./serialSettings";

export function cloudSalesAvailable() {
  return Boolean(window.desktopApp?.saveSale && window.desktopApp?.allocateSerial);
}

export async function allocateDocumentSerial(documentType: SaleDocumentType): Promise<string | null> {
  const desktopApp = window.desktopApp;
  if (!desktopApp?.allocateSerial) return null;
  const config = getSerialConfig(documentType);
  const result = await desktopApp.allocateSerial({
    documentType,
    prefix: config.prefix,
    counter: config.counter,
  });
  if (result?.serial && result.nextCounter) {
    setSerialConfig(documentType, config.prefix, result.nextCounter);
    return result.serial;
  }
  return null;
}

export async function saveSaleToCloud(
  sale: Sale,
  options: {
    previousSale?: Sale | null;
    operation: "create" | "payment" | "cancel" | "return" | "update_lines" | "convert" | "save";
    actor?: string;
  },
) {
  const desktopApp = window.desktopApp;
  if (!desktopApp?.saveSale) return null;
  return desktopApp.saveSale({
    sale,
    previousSale: options.previousSale ?? undefined,
    operation: options.operation,
    actor: options.actor,
  });
}

export function snapshotSalesState() {
  return {
    sales: localStorage.getItem("form.sales.v1"),
    products: localStorage.getItem("form.products.v1"),
    inventory: localStorage.getItem("form.inventoryMovements.v1"),
  };
}

export function restoreSalesState(snapshot: ReturnType<typeof snapshotSalesState>) {
  const restore = (key: string, value: string | null) => {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    window.dispatchEvent(new CustomEvent("form-storage", { detail: { key } }));
  };
  restore("form.sales.v1", snapshot.sales);
  restore("form.products.v1", snapshot.products);
  restore("form.inventoryMovements.v1", snapshot.inventory);
}

export async function reconcileCloudInventory(actor?: string) {
  return window.desktopApp?.reconcileInventory?.({ actor });
}
