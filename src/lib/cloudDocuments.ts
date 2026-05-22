import type { Sale } from "@/types";

export async function saveInvoicePdfToCloud(
  sale: Sale,
  fileName: string,
  pdfBase64: string,
) {
  const desktopApp = window.desktopApp;
  if (!desktopApp?.saveInvoiceDocument) return null;
  return desktopApp.saveInvoiceDocument({ sale, fileName, pdfBase64 });
}
