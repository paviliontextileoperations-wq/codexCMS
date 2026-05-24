import { jsPDF } from "jspdf";
import type { Sale } from "@/types";
import { getRibbonTitle } from "./brandSettings";
import { saveOrderPdfToCloud } from "./cloudDocuments";
import { outputPdfDocument, type PdfAction } from "./pdfOutput";

type ShippingLabelAction = PdfAction | "cloud";

function formatAddress(sale: Sale): string[] {
  const address = sale.customerSnapshot.logisticsAddress ?? sale.customerSnapshot.fiscalAddress;
  if (!address) return [sale.customerSnapshot.address ?? ""].filter(Boolean);
  return [
    address.line1,
    address.line2,
    address.additionalInfo,
    [address.postalCode, address.provinceState, address.country].filter(Boolean).join(", "),
  ].filter((line): line is string => Boolean(line && line.trim()));
}

export function generateShippingLabelPdf(sale: Sale, options: { action?: ShippingLabelAction } = {}) {
  const doc = new jsPDF({ unit: "pt", format: [420, 595] });
  const W = doc.internal.pageSize.getWidth();
  const M = 28;
  const action = options.action ?? "download";
  const itemCount = sale.lines.reduce((sum, line) => sum + line.quantity, 0);
  const brand = getRibbonTitle();
  const addressLines = formatAddress(sale);

  doc.setLineWidth(2);
  doc.rect(M, M, W - M * 2, 540);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("SHIPPING LABEL", M + 18, M + 34);
  doc.setFontSize(10);
  doc.text(brand.toUpperCase(), W - M - 18, M + 28, { align: "right" });

  doc.setLineWidth(1);
  doc.line(M, M + 56, W - M, M + 56);

  doc.setFontSize(32);
  doc.text(sale.invoiceNumber, M + 18, M + 108);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`ORDER ID: ${sale.id}`, M + 18, M + 128);
  doc.text(`ITEMS: ${itemCount}`, W - M - 18, M + 128, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("SHIP TO", M + 18, M + 178);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.text(sale.customerSnapshot.name.toUpperCase(), M + 18, M + 202);
  doc.setFontSize(10);
  doc.text(`PHONE: ${sale.customerSnapshot.phone || "-"}`, M + 18, M + 220);
  let y = M + 246;
  addressLines.forEach((line) => {
    doc.text(line.toUpperCase(), M + 18, y);
    y += 16;
  });

  y += 20;
  doc.setFont("helvetica", "bold");
  doc.text("TRANSPORT", M + 18, y);
  doc.setFont("helvetica", "normal");
  doc.text(sale.transport?.label ?? "TRANSPORT", M + 110, y);
  y += 26;
  doc.setFont("helvetica", "bold");
  doc.text("PRODUCTS", M + 18, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  sale.lines.slice(0, 10).forEach((line) => {
    const text = `${line.quantity} x ${line.barcode}  ${line.name}`.slice(0, 52);
    doc.text(text, M + 18, y);
    y += 14;
  });
  if (sale.lines.length > 10) doc.text(`+ ${sale.lines.length - 10} more lines`, M + 18, y);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text(`*${sale.invoiceNumber}*`, W / 2, M + 505, { align: "center" });

  const documentNumber = `${sale.invoiceNumber}-LABEL`;
  const fileName = `${documentNumber}.pdf`;
  const pdfBase64 = String(doc.output("datauristring")).split(",")[1] ?? "";

  if (pdfBase64) {
    void saveOrderPdfToCloud(sale, {
      documentType: "SHIPPING_LABEL",
      documentNumber,
      fileName,
      pdfBase64,
    }).catch((error) => {
      console.warn("Unable to save shipping label to cloud", error);
    });
  }

  if (action !== "cloud") {
    outputPdfDocument(doc, fileName, action, `${sale.invoiceNumber} shipping label`);
  }
  return true;
}
