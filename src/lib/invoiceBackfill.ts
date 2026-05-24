import { salesStore } from "./storage";
import { generateInvoicePdf } from "./invoicePdf";

const BACKFILL_KEY = "app.invoicePdfBackfill.v2";

export function scheduleInvoicePdfBackfill() {
  if (typeof window === "undefined") return;
  const sales = salesStore
    .all()
    .filter((sale) => {
      if ((sale.paymentStatus ?? "OPEN") !== "PAID") return false;
      if ((sale.invoiceNumber ?? "").startsWith("DRAFT-")) return false;
      if (sale.documentStatus === "cancelled") return false;
      return true;
    })
    .slice(0, 50);
  const signature = sales.map((sale) => `${sale.id}:${sale.updatedAt ?? sale.createdAt}`).join("|");
  if (!signature || localStorage.getItem(BACKFILL_KEY) === signature) return;
  localStorage.setItem(BACKFILL_KEY, signature);

  window.setTimeout(() => {
    for (const sale of sales) {
      generateInvoicePdf(sale, { action: "cloud" });
    }
  }, 2500);
}
