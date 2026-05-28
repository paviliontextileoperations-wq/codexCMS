import type { Product } from "@/types";

export function productInventorySku(product: Product): string {
  return (product.sku || product.otherSku || product.barcode || product.id || "").trim();
}

export async function adjustProductInventoryInCloud(args: {
  id: string;
  product: Product;
  movementType: string;
  previousQty: number;
  quantityChange?: number;
  newQty: number;
  reason?: string;
  warehouse?: string;
  location?: string;
  notes?: string;
  actor?: string;
  documentId?: string;
}) {
  const desktopApp = window.desktopApp;
  if (!desktopApp?.adjustInventory) return null;
  const quantityChange = args.quantityChange ?? args.newQty - args.previousQty;
  return desktopApp.adjustInventory({
    id: args.id,
    productId: args.product.id,
    sku: productInventorySku(args.product),
    movementType: args.movementType,
    previousQty: args.previousQty,
    quantityChange,
    newQty: args.newQty,
    reason: args.reason,
    warehouse: args.warehouse,
    location: args.location,
    notes: args.notes,
    actor: args.actor ?? "desktop",
    documentId: args.documentId,
  });
}
