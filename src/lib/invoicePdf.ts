import { jsPDF } from "jspdf";
import type { Sale, SaleDocumentType } from "@/types";
import { getRibbonTitle } from "./brandSettings";
import { productsStore } from "./storage";
import { getCompanyInfo } from "./companySettings";
import { outputPdfDocument, type PdfAction } from "./pdfOutput";
import { saveInvoicePdfToCloud } from "./cloudDocuments";

const DOC_TITLE: Record<SaleDocumentType, string> = {
  INVOICE: "Factura",
  DELIVERY_NOTE: "Albaran",
  RECEIPT: "Recibo",
  PROFORMA: "Proforma",
};

type Issuer = {
  name: string;
  nif: string;
  addrLines: string[];
  tel: string;
  email: string;
  iban: string;
  swift: string;
};

function brandInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "PTG";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 3).map((word) => word[0]).join("").toUpperCase();
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(n).replace(/[\u202F\u00A0]/g, " ");
}

function safePdfName(value: string) {
  return `${value.trim().replace(/[^A-Za-z0-9._-]+/g, "-") || "invoice"}.pdf`;
}

function getIssuer(): Issuer {
  const c = getCompanyInfo();
  const addrLines = (c.address || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    name: c.companyName || getRibbonTitle(),
    nif: c.vatNumber || "",
    addrLines,
    tel: (c as { phone?: string }).phone ?? "",
    email: (c as { email?: string }).email ?? "",
    iban: c.bank || "",
    swift: c.swift || "",
  };
}

function setSpacing(doc: jsPDF, pt: number) {
  (doc as unknown as { setCharSpace: (n: number) => void }).setCharSpace(pt);
}

function splitLines(doc: jsPDF, value: string, width: number): string[] {
  return doc.splitTextToSize(value || "-", width) as string[];
}

function buildInvoiceDoc(sale: Sale): jsPDF {
  const issuer = getIssuer();
  const docType: SaleDocumentType = sale.documentType ?? "INVOICE";
  const isDeliveryNote = docType === "DELIVERY_NOTE";
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const ML = 56;
  const MR = 56;
  const MT = 56;
  const MB = 48;
  const RIGHT = W - MR;
  const TEXT_RIGHT = RIGHT - 10;
  const TEXT_W = TEXT_RIGHT - ML;
  const FOOTER_H = 110;
  const FOOTER_TOP = H - MB - FOOTER_H;
  const CONTENT_BOTTOM = FOOTER_TOP - 18;

  const INK: [number, number, number] = [0, 0, 0];
  const MUTED: [number, number, number] = [88, 88, 88];
  const RULE: [number, number, number] = [198, 198, 198];
  const LIGHT: [number, number, number] = [247, 246, 243];

  const paintBg = () => {
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, W, H, "F");
  };
  paintBg();

  const brandName = getRibbonTitle();
  const initials = brandInitials(brandName);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(52);
  doc.setTextColor(...INK);
  setSpacing(doc, 2);
  doc.text(initials, ML, MT + 44);
  setSpacing(doc, 0);

  doc.setFont("times", "italic");
  doc.setFontSize(32);
  doc.text(DOC_TITLE[docType], TEXT_RIGHT, MT + 36, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  setSpacing(doc, 2);
  doc.text("MADRID - SPAIN", ML, MT + 68);
  setSpacing(doc, 0);

  let metaY = MT + 60;
  const drawMeta = (label: string, value?: string) => {
    if (!value) return;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(label.toUpperCase(), TEXT_RIGHT - 120, metaY, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text(value, TEXT_RIGHT, metaY, { align: "right" });
    metaY += 15;
  };
  drawMeta("Numero", sale.invoiceNumber);
  drawMeta("Fecha", fmtDate(sale.createdAt));
  drawMeta("Vencimiento", sale.dueDate ? fmtDate(sale.dueDate) : undefined);
  if (sale.payments?.[0]?.method) drawMeta("Pago", sale.payments[0].method);

  const divY = Math.max(metaY + 12, MT + 116);
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.6);
  doc.line(ML, divY, TEXT_RIGHT, divY);

  const gutter = 34;
  const colW = Math.floor((TEXT_W - gutter) / 2);
  const rightColX = TEXT_RIGHT - colW;
  const partyY = divY + 28;

  const drawBlock = (
    label: string,
    x: number,
    y: number,
    width: number,
    title: string,
    lines: string[],
    align: "left" | "right" = "left",
  ) => {
    const anchor = align === "right" ? x + width : x;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    setSpacing(doc, 1.6);
    doc.text(label.toUpperCase(), anchor, y, { align });
    setSpacing(doc, 0);

    let yy = y + 20;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    splitLines(doc, title, width).forEach((line) => {
      doc.text(line, anchor, yy, { align });
      yy += 15;
    });
    yy += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    lines.filter(Boolean).forEach((line) => {
      splitLines(doc, line, width).forEach((part) => {
        doc.text(part, anchor, yy, { align });
        yy += 12.5;
      });
    });
    return yy;
  };

  const customer = sale.customerSnapshot;
  const receiverName = (customer.businessName && customer.businessName.trim()) || customer.name || "-";
  const receiverLines: string[] = [];
  if (customer.vatNumber) receiverLines.push(`NIF/VAT: ${customer.vatNumber}`);
  if (customer.fiscalAddress) {
    const a = customer.fiscalAddress;
    if (a.line1) receiverLines.push(a.line1);
    if (a.line2) receiverLines.push(a.line2);
    receiverLines.push([a.postalCode, a.provinceState, a.country].filter(Boolean).join(", "));
  } else if (customer.address) {
    receiverLines.push(customer.address);
  }
  if (customer.phone) receiverLines.push(`Tel: ${customer.phone}`);
  if (customer.email) receiverLines.push(customer.email);

  const issuerLines = [
    issuer.nif ? `NIF: ${issuer.nif}` : "",
    ...issuer.addrLines,
    issuer.tel ? `Tel: ${issuer.tel}` : "",
    issuer.email,
  ];
  const leftEnd = drawBlock("Datos del emisor", ML, partyY, colW, issuer.name, issuerLines, "left");
  const rightEnd = drawBlock("Datos del receptor", rightColX, partyY, colW, receiverName, receiverLines, "right");

  let tableTop = Math.max(leftEnd, rightEnd) + 44;
  const tableHeader = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...INK);
    setSpacing(doc, 1.2);
    doc.text("REFERENCIA", ML, tableTop);
    doc.text("DESCRIPCION", ML + 92, tableTop);
    setSpacing(doc, 0);
    doc.text("CANT.", TEXT_RIGHT - 245, tableTop, { align: "right" });
    doc.text("PRECIO", TEXT_RIGHT - 165, tableTop, { align: "right" });
    if (!isDeliveryNote) doc.text("DTO.", TEXT_RIGHT - 92, tableTop, { align: "right" });
    doc.text("BASE IMP.", TEXT_RIGHT, tableTop, { align: "right" });
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.75);
    doc.line(ML, tableTop + 7, TEXT_RIGHT, tableTop + 7);
  };
  tableHeader();

  const productSkuById = new Map<string, string>();
  try {
    for (const p of productsStore.all()) {
      if (p.id) productSkuById.set(p.id, p.sku || p.otherSku || p.barcode);
    }
  } catch {
    /* local lookup is optional */
  }

  let y = tableTop + 30;
  sale.lines.forEach((line, index) => {
    const disc = line.discountPct ?? 0;
    const amount = line.unitPrice * line.quantity * (1 - disc / 100);
    const ref = productSkuById.get(line.productId) || line.barcode || "-";
    const desc = [line.name, [line.size, line.color].filter(Boolean).join(" / ")]
      .filter(Boolean)
      .join(" - ");
    const descLines = splitLines(doc, desc, 220);
    const rowH = Math.max(34, 16 + descLines.length * 12);

    if (y + rowH > CONTENT_BOTTOM) {
      doc.addPage();
      paintBg();
      tableTop = MT;
      tableHeader();
      y = tableTop + 30;
    }

    if (index > 0) {
      doc.setDrawColor(...RULE);
      doc.setLineWidth(0.5);
      doc.line(ML, y - 14, TEXT_RIGHT, y - 14);
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    splitLines(doc, ref, 82).forEach((part, i) => doc.text(part, ML, y + i * 12));

    doc.setTextColor(...INK);
    descLines.forEach((part, i) => doc.text(part, ML + 92, y + i * 12));
    doc.text(String(line.quantity), TEXT_RIGHT - 245, y, { align: "right" });
    doc.text(fmtMoney(line.unitPrice), TEXT_RIGHT - 165, y, { align: "right" });
    if (!isDeliveryNote) {
      doc.setTextColor(disc ? 0 : 110, disc ? 0 : 110, disc ? 0 : 110);
      doc.text(disc ? `${disc.toFixed(2).replace(/\.00$/, "")}%` : "0%", TEXT_RIGHT - 92, y, { align: "right" });
    }
    doc.setTextColor(...INK);
    doc.text(fmtMoney(amount), TEXT_RIGHT, y, { align: "right" });
    y += rowH;
  });

  const totalsW = 238;
  const totalsX = TEXT_RIGHT - totalsW;
  const totalsEstimate = isDeliveryNote ? 90 : 140;
  let ty = Math.max(y + 34, CONTENT_BOTTOM - totalsEstimate - 42);
  if (ty + totalsEstimate > CONTENT_BOTTOM) {
    doc.addPage();
    paintBg();
    ty = MT + 30;
  }

  const totalRow = (label: string, value: string) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...MUTED);
    doc.text(label, totalsX, ty);
    doc.setTextColor(...INK);
    doc.text(value, TEXT_RIGHT, ty, { align: "right" });
    ty += 18;
  };

  totalRow("Subtotal", fmtMoney(sale.subtotal));
  const grossSubtotal = sale.lines.reduce((a, line) => a + line.unitPrice * line.quantity, 0);
  const totalDiscount = Math.max(0, grossSubtotal - sale.subtotal);
  if (totalDiscount > 0.005) totalRow("Descuento", `-${fmtMoney(totalDiscount)}`);
  if (isDeliveryNote) {
    totalRow("IVA", "Sin impuestos");
  } else if (sale.taxBreakdown && sale.taxBreakdown.surcharge > 0) {
    const tb = sale.taxBreakdown;
    totalRow(`IVA ${(tb.vat * 100).toFixed(0)}%`, fmtMoney(tb.vatAmount));
    totalRow(`Recargo ${String((tb.surcharge * 100).toFixed(2)).replace(/\.?0+$/, "")}%`, fmtMoney(tb.surchargeAmount));
  } else {
    totalRow(`IVA ${(sale.taxRate * 100).toFixed(0)}%`, fmtMoney(sale.tax));
  }
  if (sale.transport && sale.transport.fee > 0) totalRow("Transporte", fmtMoney(sale.transport.fee));
  totalRow("Divisa", "EURO");

  ty += 8;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.75);
  doc.line(totalsX, ty, TEXT_RIGHT, ty);
  ty += 28;
  doc.setFillColor(...LIGHT);
  doc.rect(totalsX - 8, ty - 22, totalsW + 8, 38, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(`TOTAL ${DOC_TITLE[docType].toUpperCase()}`, totalsX, ty);
  doc.setFontSize(18);
  doc.text(fmtMoney(sale.total), TEXT_RIGHT, ty, { align: "right" });

  const pageCount = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  doc.setPage(pageCount);
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.5);
  doc.line(ML, FOOTER_TOP, TEXT_RIGHT, FOOTER_TOP);

  const footerColW = Math.floor((TEXT_W - gutter * 2) / 3);
  const footerY = FOOTER_TOP + 22;
  const drawFooterText = (x: number, lines: string[], width: number) => {
    let yy = footerY;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    lines.filter(Boolean).forEach((line) => {
      splitLines(doc, line, width).forEach((part) => {
        doc.text(part, x, yy);
        yy += 13;
      });
    });
  };

  drawFooterText(ML, [issuer.name, issuer.nif ? `NIF ${issuer.nif}` : "", issuer.addrLines.join(", ")], footerColW);
  drawFooterText(ML + footerColW + gutter, [issuer.tel ? `Tel ${issuer.tel}` : "", issuer.email], footerColW);
  drawFooterText(ML + (footerColW + gutter) * 2 - 30, [
    issuer.iban ? `IBAN ${issuer.iban}` : "",
    issuer.swift ? `BIC/SWIFT ${issuer.swift}` : "",
  ], footerColW + 30);

  if (pageCount > 1) {
    for (let p = 1; p <= pageCount; p += 1) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(`${p} / ${pageCount}`, TEXT_RIGHT, H - MB / 2, { align: "right" });
    }
  }

  return doc;
}

export function generateInvoicePdf(
  sale: Sale,
  options: { allowDraft?: boolean; action?: PdfAction | "cloud" } = {},
) {
  if (!options.allowDraft && (sale.paymentStatus ?? "PAID") !== "PAID") return false;

  const doc = buildInvoiceDoc(sale);
  const fileName = safePdfName(sale.invoiceNumber);
  const dataUri = doc.output("datauristring");
  const pdfBase64 = dataUri.includes(",") ? dataUri.split(",")[1] : "";
  if (pdfBase64) {
    void saveInvoicePdfToCloud(sale, fileName, pdfBase64).catch((error) => {
      console.warn("Invoice PDF was generated locally but could not be saved to cloud", error);
    });
  }

  if (options.action !== "cloud") {
    outputPdfDocument(doc, fileName, options.action ?? "download", sale.invoiceNumber);
  }
  return true;
}
