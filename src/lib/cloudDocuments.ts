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

export async function saveOrderPdfToCloud(
  sale: Sale,
  payload: {
    documentType: "SHIPPING_LABEL";
    documentNumber?: string;
    fileName: string;
    pdfBase64: string;
  },
) {
  const desktopApp = window.desktopApp;
  if (!desktopApp?.saveOrderDocument) return null;
  return desktopApp.saveOrderDocument({ sale, ...payload });
}
