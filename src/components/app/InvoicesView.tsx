import { useEffect, useMemo, useState } from "react";
import { BadgePercent, Download, Edit3, Eye, FileText, Printer, Save, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionHeader } from "./SectionHeader";
import { EmptyState } from "./EmptyState";
import { useCustomers, useSales } from "@/hooks/useStore";
import { salesStore } from "@/lib/storage";
import { fmtDateOnly, fmtMoney } from "@/lib/format";
import { generateInvoicePdf } from "@/lib/invoicePdf";
import { cn } from "@/lib/utils";
import type { Customer, PaymentStatus, Sale, SaleDocumentType } from "@/types";
import { toast } from "sonner";
import { useSession } from "@/lib/auth";

type InvoiceType = "B2B_INVOICE" | "B2C_RECEIPT" | "DELIVERY_NOTE" | "NO_INVOICE" | "PROFORMA";
type FiscalStatus = "draft" | "issued" | "cancelled" | "void";
type InvoiceFilter = "all" | "b2b" | "b2c" | "proforma" | "no_invoice" | "draft" | "issued" | "editable";

type DecoratedInvoice = {
  sale: Sale;
  customer?: Customer;
  invoiceType: InvoiceType;
  taxProfile: NonNullable<Sale["invoiceTaxProfile"]>;
  fiscalStatus: FiscalStatus;
  editable: boolean;
};

const INVOICE_TYPE_LABEL: Record<InvoiceType, string> = {
  B2B_INVOICE: "B2B invoice",
  B2C_RECEIPT: "B2C receipt",
  DELIVERY_NOTE: "Delivery note",
  NO_INVOICE: "No invoice",
  PROFORMA: "Proforma",
};

const TAX_PROFILE_LABEL: Record<NonNullable<Sale["invoiceTaxProfile"]>, string> = {
  standard: "Standard",
  b2b_spain: "B2B Spain",
  b2b_eu_vat: "B2B EU VAT",
  b2b_international: "B2B International",
  b2c: "B2C",
  no_tax: "No tax",
  custom: "Custom",
};

const FILTERS: { key: InvoiceFilter; label: string }[] = [
  { key: "all", label: "All invoices" },
  { key: "b2b", label: "B2B" },
  { key: "b2c", label: "B2C" },
  { key: "proforma", label: "Proforma" },
  { key: "no_invoice", label: "No invoice" },
  { key: "draft", label: "Draft" },
  { key: "issued", label: "Issued" },
  { key: "editable", label: "Editable" },
];

type InvoiceForm = {
  documentType: SaleDocumentType;
  invoiceNumber: string;
  dueDate: string;
  taxProfile: NonNullable<Sale["invoiceTaxProfile"]>;
  taxRatePercent: string;
  notes: string;
  transportLabel: string;
  transportFee: string;
};

function statusOf(sale: Sale): PaymentStatus {
  return sale.paymentStatus ?? "PAID";
}

function customerDisplayName(sale: Sale, customer?: Customer) {
  if (customer?.businessName) return customer.businessName;
  const joined = [customer?.name, customer?.surname].filter(Boolean).join(" ").trim();
  return joined || sale.customerSnapshot.businessName || sale.customerSnapshot.name;
}

function inferInvoiceType(sale: Sale, customer?: Customer): InvoiceType {
  const docType = sale.documentType ?? "INVOICE";
  if (docType === "PROFORMA") return "PROFORMA";
  if (docType === "DELIVERY_NOTE") return "NO_INVOICE";
  if (docType === "RECEIPT") return "B2C_RECEIPT";
  if ((customer?.clientType ?? "B2B") === "B2C") return "B2C_RECEIPT";
  return "B2B_INVOICE";
}

function inferTaxProfile(sale: Sale, customer?: Customer): NonNullable<Sale["invoiceTaxProfile"]> {
  if (sale.invoiceTaxProfile) return sale.invoiceTaxProfile;
  if ((sale.documentType ?? "INVOICE") === "DELIVERY_NOTE") return "no_tax";
  if ((sale.documentType ?? "INVOICE") === "PROFORMA") return profile;
  if ((sale.taxRate ?? 0) <= 0) return "no_tax";
  if ((customer?.clientType ?? "B2B") === "B2C" || (sale.documentType ?? "INVOICE") === "RECEIPT") {
    return "b2c";
  }
  if (customer?.taxRate !== undefined) return "custom";
  if (customer?.businessType === "EU VAT" || customer?.businessType === "EU LOCAL") return "b2b_eu_vat";
  if (customer?.businessType === "INTERNATIONAL") return "b2b_international";
  if (customer?.businessType === "ESP AUTONOMO" || customer?.businessType === "ESP EMPRESA") return "b2b_spain";
  return "standard";
}

function fiscalStatusOf(sale: Sale): FiscalStatus {
  if (sale.documentStatus === "cancelled") return "cancelled";
  if ((sale.invoiceNumber ?? "").startsWith("DRAFT-") || statusOf(sale) !== "PAID") return "draft";
  return "issued";
}

function isEditableInvoice(sale: Sale) {
  return fiscalStatusOf(sale) === "draft" || statusOf(sale) !== "PAID";
}

function toInputDate(ms?: number) {
  if (!ms) return "";
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function buildForm(item: DecoratedInvoice): InvoiceForm {
  const sale = item.sale;
  return {
    documentType: sale.documentType ?? "INVOICE",
    invoiceNumber: sale.invoiceNumber,
    dueDate: toInputDate(sale.dueDate),
    taxProfile: item.taxProfile,
    taxRatePercent: ((sale.taxRate ?? 0) * 100).toFixed(2).replace(/\.?0+$/, ""),
    notes: sale.invoiceNotes ?? "",
    transportLabel: sale.transport?.label ?? "",
    transportFee: sale.transport?.fee !== undefined ? String(sale.transport.fee) : "",
  };
}

function taxProfileForDocument(
  documentType: SaleDocumentType,
  profile: NonNullable<Sale["invoiceTaxProfile"]>,
) {
  return documentType === "DELIVERY_NOTE" ? "no_tax" : profile;
}

function Badge({ children, tone = "default" }: { children: string; tone?: "default" | "red" | "yellow" | "muted" }) {
  const cls =
    tone === "red"
      ? "bg-bauhaus-red text-primary-foreground"
      : tone === "yellow"
      ? "bg-bauhaus-yellow text-foreground"
      : tone === "muted"
      ? "bg-secondary text-foreground"
      : "bg-foreground text-primary-foreground";
  return (
    <span className={cn("border-2 border-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em]", cls)}>
      {children}
    </span>
  );
}

function InvoicePreview({ item }: { item: DecoratedInvoice }) {
  const sale = item.sale;
  const customerName = customerDisplayName(sale, item.customer);
  const address =
    sale.customerSnapshot.fiscalAddress ??
    item.customer?.fiscalAddress ??
    item.customer?.logisticsAddress ??
    undefined;
  const taxRows = sale.taxBreakdown && sale.taxBreakdown.surcharge > 0
    ? [
        [`VAT ${(sale.taxBreakdown.vat * 100).toFixed(0)}%`, sale.taxBreakdown.vatAmount],
        [`Recargo ${(sale.taxBreakdown.surcharge * 100).toFixed(2).replace(/\.?0+$/, "")}%`, sale.taxBreakdown.surchargeAmount],
      ]
    : [[`Tax ${((sale.taxRate ?? 0) * 100).toFixed(2).replace(/\.?0+$/, "")}%`, sale.tax]];

  return (
    <div className="border-2 border-foreground bg-background p-6">
      <div className="mb-8 flex items-start justify-between gap-6 border-b-2 border-foreground pb-5">
        <div>
          <div className="font-display text-2xl">PAVILION TEXTILE GROUP</div>
          <div className="mt-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">Madrid - Spain</div>
        </div>
        <div className="text-right">
          <div className="font-display text-3xl uppercase">{INVOICE_TYPE_LABEL[item.invoiceType]}</div>
          <div className="mt-2 font-mono-tabular text-sm">{sale.invoiceNumber}</div>
          <div className="text-xs text-muted-foreground">{fmtDateOnly(sale.createdAt)}</div>
        </div>
      </div>

      <div className="mb-8 grid gap-6 md:grid-cols-2">
        <div>
          <div className="mb-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">Bill to</div>
          <div className="font-semibold">{customerName}</div>
          {sale.customerSnapshot.vatNumber && (
            <div className="text-sm text-muted-foreground">VAT/CIF: {sale.customerSnapshot.vatNumber}</div>
          )}
          {address && (
            <div className="mt-2 text-sm text-muted-foreground">
              <div>{address.line1}</div>
              <div>{[address.postalCode, address.provinceState, address.country].filter(Boolean).join(", ")}</div>
            </div>
          )}
        </div>
        <div>
          <div className="mb-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">Classification</div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={item.fiscalStatus === "draft" ? "yellow" : item.fiscalStatus === "issued" ? "default" : "red"}>
              {item.fiscalStatus}
            </Badge>
            <Badge tone="muted">{TAX_PROFILE_LABEL[item.taxProfile]}</Badge>
            {item.editable && <Badge tone="yellow">editable</Badge>}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b-2 border-foreground">
            <tr className="text-left">
              <th className="py-2 font-display text-xs uppercase">SKU</th>
              <th className="py-2 font-display text-xs uppercase">Item</th>
              <th className="py-2 text-right font-display text-xs uppercase">Qty</th>
              <th className="py-2 text-right font-display text-xs uppercase">Unit</th>
              <th className="py-2 text-right font-display text-xs uppercase">Total</th>
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((line) => {
              const lineTotal = line.unitPrice * line.quantity * (1 - (line.discountPct ?? 0) / 100);
              return (
                <tr key={`${line.productId}-${line.barcode}`} className="border-b border-foreground/20">
                  <td className="py-2 font-mono-tabular text-xs">{line.barcode}</td>
                  <td className="py-2">
                    <div>{line.name}</div>
                    <div className="text-xs text-muted-foreground">{[line.color, line.size].filter(Boolean).join(" / ")}</div>
                  </td>
                  <td className="py-2 text-right font-mono-tabular">{line.quantity}</td>
                  <td className="py-2 text-right font-mono-tabular">{fmtMoney(line.unitPrice)}</td>
                  <td className="py-2 text-right font-mono-tabular">{fmtMoney(lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex justify-end">
        <div className="w-full max-w-xs space-y-2 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span>{fmtMoney(sale.subtotal)}</span></div>
          {taxRows.map(([label, amount]) => (
            <div key={label} className="flex justify-between"><span>{label}</span><span>{fmtMoney(amount as number)}</span></div>
          ))}
          {sale.transport && sale.transport.fee > 0 && (
            <div className="flex justify-between"><span>Transport</span><span>{fmtMoney(sale.transport.fee)}</span></div>
          )}
          <div className="flex justify-between border-t-2 border-foreground pt-2 font-display text-xl">
            <span>Total</span><span>{fmtMoney(sale.total)}</span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Amount due</span><span>{fmtMoney(sale.amountDue ?? 0)}</span>
          </div>
        </div>
      </div>

      {sale.invoiceNotes && (
        <div className="mt-6 border-t border-foreground/20 pt-4 text-sm text-muted-foreground">{sale.invoiceNotes}</div>
      )}
    </div>
  );
}

export function InvoicesView() {
  const [sales] = useSales();
  const [customers] = useCustomers();
  const session = useSession();
  const canEditInvoices = session?.role === "developer";
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<DecoratedInvoice | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<InvoiceForm | null>(null);

  const invoices = useMemo<DecoratedInvoice[]>(() => {
    return sales.map((sale) => {
      const customer = customers.find((item) => item.id === sale.customerId);
      const invoiceType = inferInvoiceType(sale, customer);
      const taxProfile = inferTaxProfile(sale, customer);
      const fiscalStatus = fiscalStatusOf(sale);
      return {
        sale,
        customer,
        invoiceType,
        taxProfile,
        fiscalStatus,
        editable: isEditableInvoice(sale),
      };
    });
  }, [sales, customers]);

  useEffect(() => {
    if (!selected) return;
    const fresh = invoices.find((item) => item.sale.id === selected.sale.id);
    if (fresh && fresh.sale !== selected.sale) setSelected(fresh);
  }, [invoices, selected]);

  useEffect(() => {
    if (!selected) {
      setForm(null);
      setEditing(false);
      return;
    }
    setForm(buildForm(selected));
  }, [selected]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return invoices
      .filter((item) => {
        if (filter === "b2b") return item.invoiceType === "B2B_INVOICE";
        if (filter === "b2c") return item.invoiceType === "B2C_RECEIPT";
        if (filter === "proforma") return item.invoiceType === "PROFORMA";
        if (filter === "no_invoice") return item.invoiceType === "NO_INVOICE" || item.invoiceType === "DELIVERY_NOTE";
        if (filter === "draft") return item.fiscalStatus === "draft";
        if (filter === "issued") return item.fiscalStatus === "issued";
        if (filter === "editable") return item.editable;
        return true;
      })
      .filter((item) => {
        if (!term) return true;
        const sale = item.sale;
        return [
          sale.invoiceNumber,
          sale.customerSnapshot.name,
          sale.customerSnapshot.businessName,
          sale.customerSnapshot.phone,
          sale.customerSnapshot.vatNumber,
          item.invoiceType,
          item.taxProfile,
          item.fiscalStatus,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term);
      })
      .sort((a, b) => b.sale.createdAt - a.sale.createdAt);
  }, [filter, invoices, q]);

  const stats = useMemo(() => {
    const issued = invoices.filter((item) => item.fiscalStatus === "issued").length;
    const draft = invoices.filter((item) => item.fiscalStatus === "draft").length;
    const noInvoice = invoices.filter((item) => item.invoiceType === "NO_INVOICE" || item.invoiceType === "DELIVERY_NOTE").length;
    const outstanding = invoices.reduce((sum, item) => sum + (item.sale.amountDue ?? 0), 0);
    return { total: invoices.length, issued, draft, noInvoice, outstanding };
  }, [invoices]);

  function updateForm(patch: Partial<InvoiceForm>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function saveInvoiceEdits() {
    if (!selected || !form) return;
    if (!canEditInvoices) {
      toast.error("Only developer accounts can edit invoices");
      return;
    }
    if (!selected.editable) {
      toast.error("Issued paid invoices are locked");
      return;
    }
    const taxPct = form.documentType === "DELIVERY_NOTE" ? 0 : parseFloat(form.taxRatePercent);
    if (!Number.isFinite(taxPct) || taxPct < 0 || taxPct > 100) {
      toast.error("Tax rate must be between 0 and 100");
      return;
    }
    const dueDateMs = form.dueDate ? new Date(form.dueDate).getTime() : undefined;
    if (form.dueDate && !Number.isFinite(dueDateMs)) {
      toast.error("Due date is invalid");
      return;
    }
    const transportFee = form.transportFee.trim() === "" ? 0 : parseFloat(form.transportFee);
    if (!Number.isFinite(transportFee) || transportFee < 0) {
      toast.error("Transport fee is invalid");
      return;
    }
    const transport =
      transportFee > 0 || selected.sale.transport
        ? {
            method: selected.sale.transport?.method ?? "DELIVERY",
            label: form.transportLabel.trim() || "TRANSPORT",
            fee: transportFee,
          }
        : undefined;
    const invoiceNumber = form.invoiceNumber.trim();
    if (!invoiceNumber) {
      toast.error("Invoice number is required");
      return;
    }
    const updated = salesStore.updateInvoice(selected.sale.id, {
      documentType: form.documentType,
      invoiceNumber,
      dueDate: dueDateMs,
      invoiceTaxProfile: taxProfileForDocument(form.documentType, form.taxProfile),
      taxRate: taxPct / 100,
      invoiceNotes: form.notes.trim() || undefined,
      transport,
    });
    if (updated) {
      const customer = customers.find((item) => item.id === updated.customerId);
      const next: DecoratedInvoice = {
        sale: updated,
        customer,
        invoiceType: inferInvoiceType(updated, customer),
        taxProfile: inferTaxProfile(updated, customer),
        fiscalStatus: fiscalStatusOf(updated),
        editable: isEditableInvoice(updated),
      };
      setSelected(next);
      setEditing(false);
      toast.success("Invoice updated");
    }
  }

  function downloadInvoice(item: DecoratedInvoice) {
    const ok = generateInvoicePdf(item.sale, { allowDraft: true });
    if (!ok) toast.error("Could not generate PDF");
  }

  function printInvoice(item: DecoratedInvoice) {
    const ok = generateInvoicePdf(item.sale, { allowDraft: true, action: "print" });
    if (!ok) toast.error("Could not generate PDF");
  }

  function previewInvoice(item: DecoratedInvoice) {
    const ok = generateInvoicePdf(item.sale, { allowDraft: true, action: "preview" });
    if (!ok) toast.error("Could not generate PDF");
  }

  return (
    <>
      <SectionHeader
        title="Invoices"
        description="Classified invoice database for B2B, B2C, no-invoice customers, tax profiles, preview, download, and draft editing."
      />

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <div className="border-2 border-foreground p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <FileText className="h-4 w-4" /> Total
          </div>
          <div className="mt-2 font-display text-3xl">{stats.total}</div>
        </div>
        <div className="border-2 border-foreground p-3">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Issued</div>
          <div className="mt-2 font-display text-3xl">{stats.issued}</div>
        </div>
        <div className="border-2 border-foreground p-3">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Draft / editable</div>
          <div className="mt-2 font-display text-3xl">{stats.draft}</div>
        </div>
        <div className="border-2 border-foreground p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <BadgePercent className="h-4 w-4" /> Outstanding
          </div>
          <div className="mt-2 font-display text-3xl">{fmtMoney(stats.outstanding)}</div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            onClick={() => setFilter(item.key)}
            className={cn(
              "border-2 border-foreground px-3 py-2 text-xs uppercase tracking-[0.15em]",
              filter === item.key ? "bg-foreground text-primary-foreground" : "bg-background hover:bg-secondary",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-3 border-2 border-foreground bg-background px-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by invoice, customer, VAT, tax profile or status..."
          className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No invoice results" description="Invoices will appear here after orders are created." />
      ) : (
        <div className="overflow-x-auto border-2 border-foreground">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="bg-secondary/50">
              <tr className="border-b-2 border-foreground text-left">
                <th className="px-3 py-2 font-display text-xs uppercase">Invoice</th>
                <th className="px-3 py-2 font-display text-xs uppercase">Customer</th>
                <th className="px-3 py-2 font-display text-xs uppercase">Type</th>
                <th className="px-3 py-2 font-display text-xs uppercase">Tax profile</th>
                <th className="px-3 py-2 font-display text-xs uppercase">Status</th>
                <th className="px-3 py-2 text-right font-display text-xs uppercase">Total</th>
                <th className="px-3 py-2 text-right font-display text-xs uppercase">Due</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const sale = item.sale;
                return (
                  <tr
                    key={sale.id}
                    onDoubleClick={() => setSelected(item)}
                    className="cursor-pointer border-b border-foreground/20 hover:bg-secondary/30"
                  >
                    <td className="px-3 py-3">
                      <div className="font-mono-tabular text-xs">{sale.invoiceNumber}</div>
                      <div className="text-xs text-muted-foreground">{fmtDateOnly(sale.createdAt)}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div>{customerDisplayName(sale, item.customer)}</div>
                      <div className="text-xs text-muted-foreground">{sale.customerSnapshot.vatNumber || sale.customerSnapshot.phone}</div>
                    </td>
                    <td className="px-3 py-3">{INVOICE_TYPE_LABEL[item.invoiceType]}</td>
                    <td className="px-3 py-3">{TAX_PROFILE_LABEL[item.taxProfile]}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Badge tone={item.fiscalStatus === "draft" ? "yellow" : item.fiscalStatus === "issued" ? "default" : "red"}>
                          {item.fiscalStatus}
                        </Badge>
                        {item.editable && <Badge tone="muted">edit</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono-tabular">{fmtMoney(sale.total)}</td>
                    <td className="px-3 py-3 text-right font-mono-tabular">{fmtMoney(sale.amountDue ?? 0)}</td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(event) => {
                            event.stopPropagation();
                            previewInvoice(item);
                          }}
                        >
                          <Eye /> Preview
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(event) => {
                            event.stopPropagation();
                            printInvoice(item);
                          }}
                        >
                          <Printer /> Print
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(event) => {
                            event.stopPropagation();
                            downloadInvoice(item);
                          }}
                        >
                          <Download /> PDF
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center justify-between gap-3">
              <span>{selected?.sale.invoiceNumber}</span>
              {selected && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => downloadInvoice(selected)}>
                    <Download /> Download PDF
                  </Button>
                  <Button variant="outline" onClick={() => printInvoice(selected)}>
                    <Printer /> Print
                  </Button>
                  {canEditInvoices && selected.editable && !editing && (
                    <Button onClick={() => setEditing(true)}>
                      <Edit3 /> Edit invoice
                    </Button>
                  )}
                </div>
              )}
            </DialogTitle>
          </DialogHeader>

          {selected && form && (
            <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
              <InvoicePreview item={selected} />
              <div className="space-y-4">
                {editing && canEditInvoices ? (
                  <div className="border-2 border-foreground p-4">
                    <div className="mb-4 font-display text-lg">Edit invoice</div>
                    <div className="space-y-3 text-sm">
                      <label className="block">
                        <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-muted-foreground">Document type</span>
                        <select
                          value={form.documentType}
                          onChange={(event) =>
                            updateForm({
                              documentType: event.target.value as SaleDocumentType,
                              taxProfile: taxProfileForDocument(event.target.value as SaleDocumentType, form.taxProfile),
                              taxRatePercent: event.target.value === "DELIVERY_NOTE" ? "0" : form.taxRatePercent,
                            })
                          }
                          className="h-10 w-full border-2 border-foreground bg-background px-2"
                        >
                          <option value="INVOICE">Invoice</option>
                          <option value="PROFORMA">Proforma</option>
                          <option value="RECEIPT">Receipt</option>
                          <option value="DELIVERY_NOTE">Delivery note / no invoice</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-muted-foreground">Invoice number</span>
                        <input
                          value={form.invoiceNumber}
                          onChange={(event) => updateForm({ invoiceNumber: event.target.value })}
                          className="h-10 w-full border-2 border-foreground bg-background px-2 font-mono-tabular"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-muted-foreground">Due date</span>
                        <input
                          type="date"
                          value={form.dueDate}
                          onChange={(event) => updateForm({ dueDate: event.target.value })}
                          className="h-10 w-full border-2 border-foreground bg-background px-2"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-muted-foreground">Tax profile</span>
                        <select
                          value={form.taxProfile}
                          onChange={(event) => updateForm({ taxProfile: event.target.value as NonNullable<Sale["invoiceTaxProfile"]> })}
                          className="h-10 w-full border-2 border-foreground bg-background px-2"
                        >
                          {Object.entries(TAX_PROFILE_LABEL).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-muted-foreground">Tax rate %</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={form.taxRatePercent}
                          disabled={form.documentType === "DELIVERY_NOTE"}
                          onChange={(event) => updateForm({ taxRatePercent: event.target.value })}
                          className="h-10 w-full border-2 border-foreground bg-background px-2"
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-muted-foreground">Transport label</span>
                          <input
                            value={form.transportLabel}
                            onChange={(event) => updateForm({ transportLabel: event.target.value })}
                            className="h-10 w-full border-2 border-foreground bg-background px-2"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-muted-foreground">Transport fee</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={form.transportFee}
                            onChange={(event) => updateForm({ transportFee: event.target.value })}
                            className="h-10 w-full border-2 border-foreground bg-background px-2"
                          />
                        </label>
                      </div>
                      <label className="block">
                        <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-muted-foreground">Invoice note</span>
                        <textarea
                          value={form.notes}
                          onChange={(event) => updateForm({ notes: event.target.value })}
                          rows={5}
                          className="w-full border-2 border-foreground bg-background p-2"
                        />
                      </label>
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setForm(buildForm(selected));
                          setEditing(false);
                        }}
                      >
                        <X /> Cancel
                      </Button>
                      <Button onClick={saveInvoiceEdits}>
                        <Save /> Save changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="border-2 border-foreground p-4">
                    <div className="mb-4 font-display text-lg">Invoice data</div>
                    <dl className="space-y-3 text-sm">
                      <div><dt className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Type</dt><dd>{INVOICE_TYPE_LABEL[selected.invoiceType]}</dd></div>
                      <div><dt className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Tax profile</dt><dd>{TAX_PROFILE_LABEL[selected.taxProfile]}</dd></div>
                      <div><dt className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Fiscal status</dt><dd>{selected.fiscalStatus}</dd></div>
                      <div><dt className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Payment status</dt><dd>{selected.sale.paymentStatus}</dd></div>
                      <div><dt className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Editable</dt><dd>{selected.editable ? "Yes" : "No"}</dd></div>
                    </dl>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
