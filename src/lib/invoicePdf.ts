import { jsPDF } from "jspdf";
import type { Sale, SaleDocumentType } from "@/types";
import { getRibbonTitle } from "./brandSettings";
import { outputPdfDocument, type PdfAction } from "./pdfOutput";
import { saveInvoicePdfToCloud } from "./cloudDocuments";

const DOC_TITLE: Record<SaleDocumentType, string> = {
  INVOICE: "INVOICE",
  DELIVERY_NOTE: "DELIVERY NOTE",
  RECEIPT: "RECEIPT",
  PROFORMA: "PROFORMA",
};

const DOC_LABEL: Record<SaleDocumentType, string> = {
  INVOICE: "INVOICE NO.",
  DELIVERY_NOTE: "DELIVERY NO.",
  RECEIPT: "RECEIPT NO.",
  PROFORMA: "PROFORMA NO.",
};

function brandInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "PTG";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 3).map(w => w[0]).join("").toUpperCase();
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  }).toUpperCase();
}

function safePdfName(value: string) {
  return `${value.trim().replace(/[^A-Za-z0-9._-]+/g, "-") || "invoice"}.pdf`;
}

export function generateInvoicePdf(
  sale: Sale,
  options: { allowDraft?: boolean; action?: PdfAction } = {},
) {
  if (!options.allowDraft && (sale.paymentStatus ?? "PAID") !== "PAID") return false;

  const docType: SaleDocumentType = sale.documentType ?? "INVOICE";
  const isDeliveryNote = docType === "DELIVERY_NOTE";
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 50;
  const BLACK: [number, number, number] = [20, 20, 20];
  const MUTED: [number, number, number] = [130, 130, 130];
  const LINE: [number, number, number] = [200, 200, 200];

  const brandName = getRibbonTitle();
  const initials = brandInitials(brandName);

  // ===== Header =====
  // Logo (left)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(46);
  doc.setTextColor(...BLACK);
  doc.text(initials, M, 90);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setCharSpace(1.2);
  doc.text(brandName.toUpperCase(), M, 110);
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text("MADRID  ·  SPAIN", M, 126);
  doc.setCharSpace(0);

  // Title (right)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(28);
  doc.setTextColor(...BLACK);
  doc.setCharSpace(4);
  doc.text(DOC_TITLE[docType], W - M, 90, { align: "right" });
  doc.setCharSpace(0);

  // Meta block (right, under title)
  const metaTop = 110;
  const metaLineH = 14;
  const metaValueX = W - M;
  const metaLabelX = metaValueX - 90;
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);

  const metaRows: [string, string][] = [
    [
      `${docType === "INVOICE" ? "INVOICE" : docType === "DELIVERY_NOTE" ? "DELIVERY" : docType === "PROFORMA" ? "PROFORMA" : "RECEIPT"} NO.`,
      sale.invoiceNumber,
    ],
    ["ISSUE DATE", fmtDate(sale.createdAt)],
  ];
  if (sale.dueDate) metaRows.push(["DUE DATE", fmtDate(sale.dueDate)]);
  if (sale.payments && sale.payments[0]?.method) {
    const m = sale.payments[0].method;
    const label = m === "TRANSFER" ? "BANK TRANSFER" : m;
    metaRows.push(["PAYMENT TERMS", label]);
  }

  let my = metaTop;
  metaRows.forEach(([k, v]) => {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(k, metaLabelX, my, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...BLACK);
    doc.text(v, metaValueX, my, { align: "right" });
    my += metaLineH;
  });

  // Divider under header
  const divY = Math.max(160, my + 10);
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.6);
  doc.line(M, divY, W - M, divY);

  // ===== From / Bill To =====
  const colY = divY + 28;
  const colGap = (W - M * 2) / 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BLACK);
  doc.setCharSpace(1);
  doc.text("FROM", M, colY);
  doc.text("BILL TO", M + colGap, colY);
  doc.setCharSpace(0);

  const writeBlock = (x: number, y0: number, lines: string[]) => {
    let yy = y0;
    lines.forEach((ln, i) => {
      if (!ln) return;
      if (i === 0) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(...BLACK);
      } else {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(80, 80, 80);
      }
      doc.text(ln, x, yy);
      yy += 12;
    });
    return yy;
  };

  const fromLines = [
    `${brandName.toUpperCase()} S.L.`,
    "CIF: B12345678",
    "CALLE DE LA MODA, 28",
    "28001 MADRID, SPAIN",
    "info@paviliontextile.com",
    "+34 912 345 678",
  ];

  const c = sale.customerSnapshot;
  const billLines: string[] = [c.name];
  if (c.vatNumber) billLines.push(`CIF/NIF: ${c.vatNumber}`);
  if (c.fiscalAddress) {
    const a = c.fiscalAddress;
    if (a.line1) billLines.push(a.line1.toUpperCase());
    billLines.push(`${a.postalCode} ${a.provinceState}, ${a.country}`.toUpperCase());
  } else if (c.address) {
    billLines.push(c.address);
  }
  if (c.email) billLines.push(c.email);
  if (c.phone) billLines.push(c.phone);

  const blockTop = colY + 16;
  const fromEnd = writeBlock(M, blockTop, fromLines);
  const billEnd = writeBlock(M + colGap, blockTop, billLines);

  // ===== Items table =====
  const tableTop = Math.max(fromEnd, billEnd) + 30;

  // Column x positions (right-aligned numeric columns)
  const colRef = M;
  const colDesc = M + 60;
  const colTotal = W - M;
  const colVat = colTotal - 60;
  const colUnit = colVat - 70;
  const colQty = colUnit - 60;
  const descMaxW = colQty - colDesc - 40; // leave gap before qty

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BLACK);
  doc.setCharSpace(1);
  doc.text("REF.", colRef, tableTop);
  doc.text("DESCRIPTION", colDesc, tableTop);
  doc.text("QTY", colQty, tableTop, { align: "right" });
  doc.text("UNIT PRICE", colUnit, tableTop, { align: "right" });
  if (!isDeliveryNote) doc.text("VAT", colVat, tableTop, { align: "right" });
  doc.text("TOTAL", colTotal, tableTop, { align: "right" });
  doc.setCharSpace(0);

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.5);
  doc.line(M, tableTop + 8, W - M, tableTop + 8);

  const vatRate = isDeliveryNote ? 0 : sale.taxRate;

  let y = tableTop + 28;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  sale.lines.forEach((l) => {
    const disc = l.discountPct ?? 0;
    const lineTotal = l.unitPrice * l.quantity * (1 - disc / 100);
    const desc = [l.name, [l.size, l.color].filter(Boolean).join(" / ")]
      .filter(Boolean).join(" - ").toUpperCase();

    doc.setTextColor(...BLACK);
    doc.text(l.barcode, colRef, y);
    let descText = desc;
    while (descText.length > 0 && doc.getTextWidth(descText) > descMaxW) {
      descText = descText.slice(0, -1);
    }
    if (descText.length < desc.length) descText = descText.slice(0, -1) + "…";
    doc.text(descText, colDesc, y);
    doc.text(String(l.quantity), colQty, y, { align: "right" });
    doc.text(`€${l.unitPrice.toFixed(2)}`, colUnit, y, { align: "right" });
    if (!isDeliveryNote) {
      doc.text(`${(vatRate * 100).toFixed(0)}%`, colVat, y, { align: "right" });
    }
    doc.text(`€${lineTotal.toFixed(2)}`, colTotal, y, { align: "right" });

    y += 14;
    doc.setDrawColor(...LINE);
    doc.line(M, y, W - M, y);
    y += 18;

    if (y > H - 220) { doc.addPage(); y = 80; }
  });

  // ===== Totals box (right) =====
  const boxX = W - M - 240;
  const boxW = 240;
  let by = y + 10;

  // Light grey rows
  doc.setFillColor(245, 245, 245);
  doc.rect(boxX, by, boxW, 28, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...BLACK);
  doc.text("SUBTOTAL", boxX + 14, by + 18);
  doc.text(`€${sale.subtotal.toFixed(2)}`, boxX + boxW - 14, by + 18, { align: "right" });
  by += 28;

  if (isDeliveryNote) {
    doc.setFillColor(245, 245, 245);
    doc.rect(boxX, by, boxW, 24, "F");
    doc.text("VAT", boxX + 14, by + 16);
    doc.text("— No tax —", boxX + boxW - 14, by + 16, { align: "right" });
    by += 24;
  } else if (sale.taxBreakdown && sale.taxBreakdown.surcharge > 0) {
    const tb = sale.taxBreakdown;
    doc.setFillColor(245, 245, 245);
    doc.rect(boxX, by, boxW, 24, "F");
    doc.text(`VAT ${(tb.vat * 100).toFixed(0)}%`, boxX + 14, by + 16);
    doc.text(`€${tb.vatAmount.toFixed(2)}`, boxX + boxW - 14, by + 16, { align: "right" });
    by += 24;
    doc.setFillColor(245, 245, 245);
    doc.rect(boxX, by, boxW, 24, "F");
    doc.text(`RECARGO ${(tb.surcharge * 100).toFixed(2).replace(/\.?0+$/, "")}%`, boxX + 14, by + 16);
    doc.text(`€${tb.surchargeAmount.toFixed(2)}`, boxX + boxW - 14, by + 16, { align: "right" });
    by += 24;
  } else {
    doc.setFillColor(245, 245, 245);
    doc.rect(boxX, by, boxW, 24, "F");
    doc.text(`VAT ${(sale.taxRate * 100).toFixed(0)}%`, boxX + 14, by + 16);
    doc.text(`€${sale.tax.toFixed(2)}`, boxX + boxW - 14, by + 16, { align: "right" });
    by += 24;
  }

  if (sale.transport && sale.transport.fee > 0) {
    doc.setFillColor(245, 245, 245);
    doc.rect(boxX, by, boxW, 24, "F");
    doc.text(`TRANSPORT`, boxX + 14, by + 16);
    doc.text(`€${sale.transport.fee.toFixed(2)}`, boxX + boxW - 14, by + 16, { align: "right" });
    by += 24;
  }

  // TOTAL bar (dark)
  doc.setFillColor(...BLACK);
  doc.rect(boxX, by, boxW, 38, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text("TOTAL", boxX + 14, by + 24);
  doc.text(`€${sale.total.toFixed(2)}`, boxX + boxW - 14, by + 24, { align: "right" });
  by += 38;

  // ===== Payment details (bottom-left) =====
  const payTop = Math.max(by + 40, H - 130);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BLACK);
  doc.setCharSpace(1);
  doc.text("PAYMENT DETAILS", M, payTop);
  doc.setCharSpace(0);
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.5);
  doc.line(M, payTop + 6, M + 90, payTop + 6);

  const payRows: [string, string][] = [
    ["BANK", "SANTANDER BANK"],
    ["IBAN", "ES12 0049 1826 7521 1024 1234"],
    ["SWIFT/BIC", "BSCHESMMXXX"],
    ["PAYMENT TERMS", sale.payments?.[0]?.method === "TRANSFER" ? "BANK TRANSFER" : (sale.payments?.[0]?.method ?? "BANK TRANSFER")],
  ];
  let py = payTop + 22;
  doc.setFontSize(8);
  payRows.forEach(([k, v]) => {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(k, M, py);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...BLACK);
    doc.text(v, M + 110, py);
    py += 14;
  });

  const fileName = safePdfName(sale.invoiceNumber);
  const dataUri = doc.output("datauristring");
  const pdfBase64 = dataUri.includes(",") ? dataUri.split(",")[1] : "";
  if (pdfBase64) {
    void saveInvoicePdfToCloud(sale, fileName, pdfBase64).catch((error) => {
      console.warn("Invoice PDF was generated locally but could not be saved to cloud", error);
    });
  }

  outputPdfDocument(doc, fileName, options.action ?? "download", sale.invoiceNumber);
  return true;
}
