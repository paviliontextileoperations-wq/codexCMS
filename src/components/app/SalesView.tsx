import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  Barcode,
  Eye,
  FileText,
  Minus,
  Plus,
  Printer,
  Search,
  Trash2,
  Truck,
  Undo2,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCustomers, useSales } from "@/hooks/useStore";
import { productsStore, salesStore } from "@/lib/storage";
import type {
  DeliveryStatus,
  DocumentStatus,
  PaymentMethod,
  PaymentStatus,
  Sale,
  SaleDocumentType,
  SaleLine,
} from "@/types";
import { SectionHeader } from "./SectionHeader";
import { EmptyState } from "./EmptyState";
import { fmtDate, fmtMoney } from "@/lib/format";
import { generateInvoicePdf } from "@/lib/invoicePdf";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSession } from "@/lib/auth";
import { approvalsStore, usePendingDeletes } from "@/lib/approvals";
import { getDefaultTransportFee } from "@/lib/transportSettings";
import { getB2cUnitPrice } from "@/lib/productSettings";
import { normalizeProductCode } from "@/lib/productCodes";
import { generateShippingLabelPdf } from "@/lib/shippingLabelPdf";
import {
  allocateDocumentSerial,
  cloudSalesAvailable,
  restoreSalesState,
  saveSaleToCloud,
  snapshotSalesState,
} from "@/lib/cloudSales";

function statusOf(s: Sale): PaymentStatus {
  return s.paymentStatus ?? "PAID";
}

function docStatusOf(s: Sale): DocumentStatus {
  return s.documentStatus ?? (s.paymentStatus === "PAID" ? "open" : "open");
}
function deliveryStatusOf(s: Sale): DeliveryStatus {
  return (
    s.deliveryStatus ??
    ((s.documentType ?? "INVOICE") === "DELIVERY_NOTE" ? "open" : "open")
  );
}

const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  open: "Open",
  preparing: "Preparing",
  pending_pickup: "Pending pickup",
  product_sent: "Product sent",
  pending_reception: "Pending reception",
  completed: "Completed",
  pending_pickup_client: "Pending pick up by client",
  picked_up_client: "Picked up by client",
  not_prepared: "Not prepared",
  prepared: "Prepared",
  delivered: "Delivered",
  returned: "Returned",
};

function deliveryOptionsFor(s: Sale): DeliveryStatus[] {
  const method = s.transport?.method;
  if (method === "PICKUP") {
    return ["pending_pickup_client", "picked_up_client", "completed", "returned"];
  }
  // DELIVERY or unspecified transport
  return [
    "open",
    "preparing",
    "pending_pickup",
    "product_sent",
    "pending_reception",
    "completed",
    "returned",
  ];
}

function StatusBadge({ status }: { status: PaymentStatus }) {
  const cls =
    status === "PAID"
      ? "bg-foreground text-primary-foreground"
      : status === "PARTIAL"
      ? "bg-bauhaus-yellow text-foreground"
      : "bg-bauhaus-red text-primary-foreground";
  return (
    <span className={cn("border-2 border-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em]", cls)}>
      {status}
    </span>
  );
}

function DocBadge({ status }: { status: DocumentStatus }) {
  // "open" is the default workflow state — don't render it next to the payment
  // badge to avoid showing two confusing statuses (e.g. "OPEN" + "PAID").
  if (status === "open") return null;
  const cls =
    status === "cancelled"
      ? "bg-bauhaus-red text-primary-foreground"
      : status === "converted"
      ? "bg-muted text-muted-foreground"
      : status === "draft"
      ? "bg-secondary text-foreground"
      : "bg-foreground text-primary-foreground";
  return (
    <span className={cn("border-2 border-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em]", cls)}>
      {status}
    </span>
  );
}

function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  const cls =
    status === "completed" || status === "delivered" || status === "picked_up_client"
      ? "bg-foreground text-primary-foreground"
      : status === "returned"
      ? "bg-bauhaus-red text-primary-foreground"
      : status === "prepared" || status === "product_sent"
      ? "bg-bauhaus-yellow text-foreground"
      : "bg-secondary text-foreground";
  return (
    <span className={cn("border-2 border-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em]", cls)}>
      {DELIVERY_LABELS[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

export function SalesView() {
  const [sales] = useSales();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<SaleDocumentType | "PENDING" | "PENDING_PREP">("INVOICE");
  const [payFor, setPayFor] = useState<Sale | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("CARD");
  const [payReference, setPayReference] = useState("");
  const [payDate, setPayDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  
  const [returnFor, setReturnFor] = useState<Sale | null>(null);
  const [returnLineId, setReturnLineId] = useState<string>("");
  const [returnQty, setReturnQty] = useState<string>("1");
  const [returnReason, setReturnReason] =
    useState<"customer_changed_mind" | "defective" | "wrong_size" | "wrong_item" | "damaged" | "other">("customer_changed_mind");
  const [returnCondition, setReturnCondition] =
    useState<"resellable" | "damaged" | "repair_needed">("resellable");
  const [returnRefund, setReturnRefund] = useState("");
  const [returnStockAction, setReturnStockAction] =
    useState<"back_to_stock" | "repair" | "discard" | "no_stock_change">("back_to_stock");
  const [viewSale, setViewSale] = useState<Sale | null>(null);
  const [editLines, setEditLines] = useState<SaleLine[] | null>(null);
  const [scanCode, setScanCode] = useState("");
  const [editTransport, setEditTransport] = useState<Sale["transport"] | null>(null);
  const [customers] = useCustomers();
  const session = useSession();
  const pendingDeletes = usePendingDeletes();

  // Sync editLines when a sale is opened, or when underlying sales change (e.g. after payment).
  useEffect(() => {
    if (!viewSale) { setEditLines(null); setScanCode(""); setEditTransport(null); return; }
    const fresh = sales.find((s) => s.id === viewSale.id);
    if (fresh && fresh !== viewSale) setViewSale(fresh);
    if (fresh) {
      setEditLines(fresh.lines.map((l) => ({ ...l })));
      setEditTransport(fresh.transport ?? null);
    }
  }, [viewSale, sales]);

  const isEditable = !!viewSale && statusOf(viewSale) !== "PAID";
  const dirtyLines =
    !!viewSale &&
    !!editLines &&
    (JSON.stringify(editLines) !== JSON.stringify(viewSale.lines) ||
      JSON.stringify(editTransport ?? null) !== JSON.stringify(viewSale.transport ?? null));

  // Customer logistics availability for delivery toggle.
  const liveCustomer = useMemo(
    () => (viewSale ? customers.find((c) => c.id === viewSale.customerId) : null),
    [viewSale, customers],
  );
  const logisticsCountry = (liveCustomer?.logisticsAddress?.country ?? "").trim();
  const deliveryAvailable = !!logisticsCountry;
  const transportFee = getDefaultTransportFee();

  function setTransportMethod(method: "PICKUP" | "DELIVERY") {
    if (method === "DELIVERY") {
      if (!deliveryAvailable) return;
      setEditTransport({
        method: "DELIVERY",
        label: `${logisticsCountry.toUpperCase()} TRANSPORT`,
        fee: transportFee,
      });
    } else {
      setEditTransport({ method: "PICKUP", label: "Collect in store", fee: 0 });
    }
  }

  function editUpdateQty(productId: string, delta: number) {
    setEditLines((prev) =>
      (prev ?? [])
        .map((l) => (l.productId === productId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  }
  function editRemoveLine(productId: string) {
    setEditLines((prev) => (prev ?? []).filter((l) => l.productId !== productId));
  }
  function editUpdateDiscount(productId: string, raw: string) {
    const n = raw === "" ? 0 : parseFloat(raw);
    const clamped = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
    setEditLines((prev) =>
      (prev ?? []).map((l) => (l.productId === productId ? { ...l, discountPct: clamped } : l)),
    );
  }
  function editAddByBarcode(code: string) {
    const trimmed = code.trim();
    if (!trimmed || !viewSale) return;
    const p = productsStore.byBarcode(trimmed);
    if (!p) {
      const normalized = normalizeProductCode(trimmed);
      const isModel = productsStore.all().some((x) => normalizeProductCode(x.barcode) === normalized);
      toast.error(
        isModel
          ? `"${trimmed}" is a model code. Enter the full SKU (Model + Colour + Size).`
          : `No product for "${trimmed}"`,
      );
      return;
    }
    setEditLines((prev) => {
      const list = prev ?? [];
      const idx = list.findIndex((l) => l.productId === p.id);
      if (idx >= 0) {
        const next = [...list];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      // Match the price tier of the original sale (B2C receipts use marked-up price).
      const useB2C = (viewSale.documentType ?? "INVOICE") === "RECEIPT";
      const unitPrice = useB2C ? getB2cUnitPrice(p.price, p.b2cMarkup, p.b2cPrice) : p.price;
      return [
        ...list,
        { productId: p.id, barcode: p.sku || p.barcode, name: p.name, size: p.size, color: p.color, unitPrice, quantity: 1, discountPct: 0 },
      ];
    });
    setScanCode("");
    toast.success(`Added · ${p.name}`);
  }
  async function saveLineEdits() {
    if (!viewSale || !editLines) return;
    if (editLines.length === 0) { toast.error("Order must have at least one line"); return; }
    const previousSale = viewSale;
    const snapshot = snapshotSalesState();
    const updated = salesStore.updateLines(viewSale.id, editLines, editTransport ?? undefined);
    if (!updated) return;
    try {
      await saveSaleToCloud(updated, {
        previousSale,
        operation: "update_lines",
        actor: session?.username,
      });
    } catch (error) {
      restoreSalesState(snapshot);
      toast.error(error instanceof Error ? error.message : "Cloud database save failed");
      return;
    }
    setViewSale(updated);
    toast.success("Order updated");
  }
  function discardLineEdits() {
    if (!viewSale) return;
    setEditLines(viewSale.lines.map((l) => ({ ...l })));
    setEditTransport(viewSale.transport ?? null);
  }

  const docOf = (s: Sale): SaleDocumentType => s.documentType ?? "INVOICE";

  const counts = useMemo(() => {
    const acc: Record<SaleDocumentType, number> = { INVOICE: 0, DELIVERY_NOTE: 0, RECEIPT: 0, PROFORMA: 0 };
    sales.forEach((s) => { acc[docOf(s)] += 1; });
    return acc;
  }, [sales]);

  const pendingCount = useMemo(
    () => sales.filter((s) => statusOf(s) !== "PAID").length,
    [sales],
  );

  const pendingPrepCount = useMemo(
    () =>
      sales.filter((s) => {
        if (s.documentStatus === "cancelled" || s.documentStatus === "converted") return false;
        return deliveryStatusOf(s) !== "completed";
      }).length,
    [sales],
  );

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return sales
      .filter((s) => {
        if (tab === "PENDING") return statusOf(s) !== "PAID";
        if (tab === "PENDING_PREP") {
          if (s.documentStatus === "cancelled" || s.documentStatus === "converted") return false;
          return deliveryStatusOf(s) !== "completed";
        }
        return docOf(s) === tab;
      })
      .filter((s) =>
        !t ||
        [s.invoiceNumber, s.customerSnapshot.name, s.customerSnapshot.phone, s.customerSnapshot.vatNumber]
          .filter(Boolean).join(" ").toLowerCase().includes(t),
      );
  }, [sales, q, tab]);

  const stats = useMemo(() => {
    const total = sales.reduce((a, s) => a + s.total, 0);
    const items = sales.reduce((a, s) => a + s.lines.reduce((b, l) => b + l.quantity, 0), 0);
    const outstanding = sales.reduce((a, s) => a + (s.amountDue ?? 0), 0);
    return { total, items, count: sales.length, outstanding };
  }, [sales]);

  function openPay(s: Sale) {
    setPayFor(s);
    setPayAmount(((s.amountDue ?? s.total)).toFixed(2));
    setPayMethod("CARD");
    setPayReference("");
    setPayDate(new Date().toISOString().slice(0, 10));
  }

  async function convertProformaToInvoice(s: Sale): Promise<Sale | undefined> {
    if ((s.documentType ?? "INVOICE") !== "PROFORMA") return undefined;
    if (s.paymentStatus !== "PAID") {
      toast.error("Proforma must be fully paid before invoice conversion");
      return undefined;
    }
    if (docStatusOf(s) !== "open") {
      toast.error("Only open proformas can be converted");
      return undefined;
    }
    let invoiceNumber: string | undefined;
    if (cloudSalesAvailable()) {
      try {
        invoiceNumber = await allocateDocumentSerial("INVOICE") ?? undefined;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not allocate cloud invoice number");
        return undefined;
      }
    }
    const snapshot = snapshotSalesState();
    const invoice = salesStore.convertToInvoice(s.id, invoiceNumber);
    if (!invoice) {
      toast.error("Could not generate invoice");
      return undefined;
    }
    try {
      const convertedSource = salesStore.all().find((item) => item.id === s.id);
      if (convertedSource) {
        await saveSaleToCloud(convertedSource, { previousSale: s, operation: "convert", actor: session?.username });
      }
      await saveSaleToCloud(invoice, { operation: "convert", actor: session?.username });
    } catch (error) {
      restoreSalesState(snapshot);
      toast.error(error instanceof Error ? error.message : "Cloud database save failed");
      return undefined;
    }
    generateInvoicePdf(invoice);
    toast.success(`${invoice.invoiceNumber} generated from ${s.invoiceNumber}`);
    return invoice;
  }

  async function submitPay() {
    if (!payFor) return;
    const n = parseFloat(payAmount);
    if (!Number.isFinite(n) || n <= 0) { toast.error("Enter a valid amount"); return; }
    const due = payFor.amountDue ?? payFor.total;
    if (n > due + 0.0001) { toast.error("Amount exceeds pending"); return; }
    const dateMs = payDate ? new Date(payDate).getTime() : Date.now();
    let invoiceNumber: string | undefined;
    const willIssue = n >= due - 0.0001 && payFor.invoiceNumber.startsWith("DRAFT-");
    if (cloudSalesAvailable() && willIssue) {
      try {
        invoiceNumber = await allocateDocumentSerial(payFor.documentType ?? "INVOICE") ?? undefined;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not allocate cloud document number");
        return;
      }
    }
    const snapshot = snapshotSalesState();
    const updated = salesStore.recordPaymentDetailed(payFor.id, {
      amount: n,
      method: payMethod,
      reference: payReference.trim() || undefined,
      paymentDate: Number.isFinite(dateMs) ? dateMs : Date.now(),
      invoiceNumber,
    });
    if (!updated) return;
    try {
      await saveSaleToCloud(updated, { previousSale: payFor, operation: "payment", actor: session?.username });
    } catch (error) {
      restoreSalesState(snapshot);
      toast.error(error instanceof Error ? error.message : "Cloud database save failed");
      return;
    }
    toast.success("Payment recorded");
    if (
      updated &&
      updated.paymentStatus === "PAID"
    ) {
      if ((updated.documentType ?? "INVOICE") === "PROFORMA") {
        await convertProformaToInvoice(updated);
      } else {
        generateInvoicePdf(updated);
        toast.success(`${updated.invoiceNumber} · document issued`);
      }
    }
    setPayFor(null);
  }

  async function removeOrCancelSale(s: Sale) {
    if (!session) return;
    const isDraft = (s.invoiceNumber ?? "").startsWith("DRAFT-");
    // Confirmed sales (with a real document number) should NEVER be hard-deleted.
    // They must go through cancellation so the audit trail is preserved.
    if (!isDraft) {
      const reason = prompt(`Cancel sale ${s.invoiceNumber}? Enter a reason (required):`);
      if (!reason) return;
      const snapshot = snapshotSalesState();
      const updated = salesStore.cancel(s.id, reason, session.username);
      if (!updated) return;
      try {
        await saveSaleToCloud(updated, { previousSale: s, operation: "cancel", actor: session.username });
      } catch (error) {
        restoreSalesState(snapshot);
        toast.error(error instanceof Error ? error.message : "Cloud database save failed");
        return;
      }
      toast.success(`${s.invoiceNumber} cancelled`);
      return;
    }
    if (session.role === "developer") {
      if (!confirm(`Delete sale ${s.invoiceNumber}? This cannot be undone.`)) return;
      const list = salesStore.all().filter((x) => x.id !== s.id);
      salesStore.save(list);
      toast.success("Sale deleted");
      return;
    }
    if (!confirm(`Request deletion of sale ${s.invoiceNumber}? A developer must approve.`)) return;
    approvalsStore.request(
      { type: "delete_sale", saleId: s.id, invoiceNumber: s.invoiceNumber },
      session.username,
    );
    toast.success("Approval request submitted");
  }

  function openReturn(s: Sale) {
    setReturnFor(s);
    setReturnLineId(s.lines[0]?.productId ?? "");
    setReturnQty("1");
    setReturnReason("customer_changed_mind");
    setReturnCondition("resellable");
    setReturnStockAction("back_to_stock");
    const firstLine = s.lines[0];
    setReturnRefund(firstLine ? (firstLine.unitPrice * (1 - (firstLine.discountPct ?? 0) / 100)).toFixed(2) : "");
  }
  async function submitReturn() {
    if (!returnFor) return;
    const line = returnFor.lines.find((l) => l.productId === returnLineId);
    if (!line) { toast.error("Pick a line to return"); return; }
    const qty = parseInt(returnQty, 10);
    if (!Number.isFinite(qty) || qty <= 0 || qty > line.quantity) {
      toast.error(`Quantity must be 1–${line.quantity}`);
      return;
    }
    const refund = parseFloat(returnRefund);
    if (!Number.isFinite(refund) || refund < 0) { toast.error("Enter a valid refund amount"); return; }
    const snapshot = snapshotSalesState();
    const updated = salesStore.recordReturn(returnFor.id, {
      productId: line.productId,
      quantity: qty,
      reason: returnReason,
      condition: returnCondition,
      refundAmount: refund,
      stockAction: returnStockAction,
    });
    if (!updated) return;
    try {
      await saveSaleToCloud(updated, { previousSale: returnFor, operation: "return", actor: session?.username });
    } catch (error) {
      restoreSalesState(snapshot);
      toast.error(error instanceof Error ? error.message : "Cloud database save failed");
      return;
    }
    toast.success("Return recorded");
    setReturnFor(null);
  }

  return (
    <>
      <SectionHeader title="Orders" />

      <div className="mb-6 grid grid-cols-1 gap-px bg-foreground/10 md:grid-cols-4">
        <Stat label="Invoices" value={String(stats.count)} accent="bg-accent" />
        <Stat label="Items sold" value={String(stats.items)} accent="bg-bauhaus-yellow" />
        <Stat label="Revenue" value={fmtMoney(stats.total)} accent="bg-bauhaus-red" />
        <Stat label="Outstanding" value={fmtMoney(stats.outstanding)} accent="bg-foreground" />
      </div>

      <div className="mb-4 inline-flex border-2 border-foreground">
        {([
          { id: "INVOICE", label: "Invoices" },
          { id: "DELIVERY_NOTE", label: "Delivery notes" },
          { id: "RECEIPT", label: "Receipts" },
          { id: "PROFORMA", label: "Proformas" },
          { id: "PENDING", label: "Pending payment" },
          { id: "PENDING_PREP", label: "Pending prep" },
        ] as { id: SaleDocumentType | "PENDING" | "PENDING_PREP"; label: string }[]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "px-4 py-2 text-xs uppercase tracking-[0.2em] transition-colors",
              tab === t.id ? "bg-foreground text-primary-foreground" : "bg-background hover:bg-secondary",
            )}
          >
            {t.label}
            <span className="ml-2 font-mono-tabular opacity-70">
              {t.id === "PENDING"
                ? pendingCount
                : t.id === "PENDING_PREP"
                ? pendingPrepCount
                : counts[t.id as SaleDocumentType]}
            </span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-3 border-2 border-foreground bg-background px-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by invoice, customer, VAT…"
          className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No sales yet" description="Generate an invoice from Point of sale to see it here." />
      ) : (
        <div className="border-2 border-foreground">
          <table className="w-full table-fixed text-xs">
            <thead className="bg-foreground text-primary-foreground">
              <tr className="text-left">
                <th className="px-2 py-3 text-[10px] uppercase tracking-wider w-[11%]">Invoice</th>
                <th className="px-2 py-3 text-[10px] uppercase tracking-wider w-[8%]">Date</th>
                <th className="px-2 py-3 text-[10px] uppercase tracking-wider w-[8%]">Due</th>
                <th className="px-2 py-3 text-[10px] uppercase tracking-wider w-[16%]">Customer</th>
                <th className="px-2 py-3 text-[10px] uppercase tracking-wider w-[10%]">VAT</th>
                <th className="px-2 py-3 text-right text-[10px] uppercase tracking-wider w-[5%]">Items</th>
                <th className="px-2 py-3 text-right text-[10px] uppercase tracking-wider w-[9%]">Total</th>
                <th className="px-2 py-3 text-[10px] uppercase tracking-wider w-[9%]">Payment</th>
                <th className="px-2 py-3 text-[10px] uppercase tracking-wider w-[10%]">Preparation</th>
                <th className="px-2 py-3 w-[14%]" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const status = statusOf(s);
                const paid = s.amountPaid ?? (status === "PAID" ? s.total : 0);
                const due = s.amountDue ?? (s.total - paid);
                const isPending = pendingDeletes.sales.has(s.id);
                const docStatus = docStatusOf(s);
                const delivery = deliveryStatusOf(s);
                const isDraft = (s.invoiceNumber ?? "").startsWith("DRAFT-");
                return (
                <tr
                  key={s.id}
                  onClick={() => setViewSale(s)}
                  className={cn(
                    "border-t border-foreground/10 hover:bg-secondary cursor-pointer",
                    isPending && "opacity-50 bg-muted/30",
                    docStatus === "cancelled" && "opacity-60 line-through",
                  )}
                >
                  <td className="px-2 py-2 font-mono-tabular truncate">{s.invoiceNumber}</td>
                  <td className="px-2 py-2 text-muted-foreground">{fmtDate(s.createdAt)}</td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {s.dueDate ? fmtDate(s.dueDate) : "—"}
                  </td>
                  <td className="px-2 py-2">
                    <div className="font-medium truncate">{s.customerSnapshot.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{s.customerSnapshot.phone}</div>
                  </td>
                  <td className="px-2 py-2 font-mono-tabular text-muted-foreground truncate">
                    {s.customerSnapshot.vatNumber || "—"}
                  </td>
                  <td className="px-2 py-2 text-right font-mono-tabular">{s.lines.reduce((a, l) => a + l.quantity, 0)}</td>
                  <td className="px-2 py-2 text-right font-mono-tabular font-semibold">{fmtMoney(s.total)}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={status} />
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      <DocBadge status={docStatus} />
                      <DeliveryBadge status={delivery} />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {status !== "PAID" && !isPending && docStatus !== "cancelled" && (
                        <Button size="icon" variant="ghost" onClick={() => openPay(s)} title="Record payment">
                          <Wallet />
                        </Button>
                      )}
                      {status === "PAID" && docStatus === "open" && docOf(s) !== "PROFORMA" && !isPending && (
                        <Button size="icon" variant="ghost" onClick={() => openReturn(s)} title="Record a return / refund">
                          <Undo2 />
                        </Button>
                      )}
                      {docOf(s) === "PROFORMA" && status === "PAID" && docStatus === "open" && !isPending && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => void convertProformaToInvoice(s)}
                          title="Generate invoice from proforma"
                        >
                          <FileText />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => generateInvoicePdf(s, { allowDraft: true, action: "preview" })}
                        disabled={isPending || docStatus === "cancelled"}
                        title={docStatus === "cancelled" ? "Cancelled documents cannot be previewed" : "Preview invoice"}
                      >
                        <Eye />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => generateInvoicePdf(s, { allowDraft: true, action: "print" })}
                        disabled={isPending || docStatus === "cancelled"}
                        title={docStatus === "cancelled" ? "Cancelled documents cannot be printed" : "Print invoice"}
                      >
                        <Printer />
                      </Button>
                      {s.transport?.method === "DELIVERY" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => generateShippingLabelPdf(s, { action: "print" })}
                          disabled={isPending || docStatus === "cancelled"}
                          title="Print shipping label"
                        >
                          <Truck />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => generateInvoicePdf(s, { allowDraft: true })}
                        disabled={isPending || docStatus === "cancelled"}
                        title={
                          docStatus === "cancelled"
                            ? "Cancelled documents cannot be re-issued"
                            : "Download PDF"
                        }
                      >
                        <FileText />
                      </Button>
                      <span className="mx-1 h-5 w-px bg-foreground/20" aria-hidden />
                      {isPending ? (
                        <span className="px-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground" title="Awaiting developer approval">
                          Pending
                        </span>
                      ) : !isDraft && docStatus !== "cancelled" ? (
                        <Button size="icon" variant="ghost" onClick={() => removeOrCancelSale(s)} title="Cancel sale">
                          <Ban />
                        </Button>
                      ) : (
                        <Button size="icon" variant="ghost" onClick={() => removeOrCancelSale(s)} title="Delete draft">
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!payFor} onOpenChange={(o) => !o && setPayFor(null)}>
        <DialogContent className="max-w-md rounded-none border-2 border-foreground">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Record payment</DialogTitle>
          </DialogHeader>
          {payFor && (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Invoice</span><span className="font-mono-tabular">{payFor.invoiceNumber}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-mono-tabular">{fmtMoney(payFor.total)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Already paid</span><span className="font-mono-tabular">{fmtMoney(payFor.amountPaid ?? 0)}</span></div>
              <div className="flex justify-between border-t-2 border-foreground pt-2"><span className="font-display">Pending</span><span className="font-mono-tabular font-semibold">{fmtMoney(payFor.amountDue ?? payFor.total)}</span></div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount</label>
                <input
                  type="number" step="0.01" min="0"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="h-10 w-full bg-transparent font-mono-tabular outline-none border-b border-foreground/30 focus:border-foreground"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Method</label>
                <Select value={payMethod} onValueChange={(v) => setPayMethod(v as PaymentMethod)}>
                  <SelectTrigger className="rounded-none border-2 border-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CARD">Card</SelectItem>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="TRANSFER">Bank transfer</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Payment date</label>
                  <input
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="h-10 w-full bg-transparent font-mono-tabular outline-none border-b border-foreground/30 focus:border-foreground"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Reference</label>
                  <input
                    type="text"
                    value={payReference}
                    onChange={(e) => setPayReference(e.target.value)}
                    placeholder="Bank / card ref"
                    className="h-10 w-full bg-transparent font-mono-tabular outline-none border-b border-foreground/30 focus:border-foreground"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayFor(null)}>Cancel</Button>
            <Button onClick={submitPay}><Wallet /> Record payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Return / refund modal */}
      <Dialog open={!!returnFor} onOpenChange={(o) => !o && setReturnFor(null)}>
        <DialogContent className="max-w-lg rounded-none border-2 border-foreground">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Return / refund</DialogTitle>
          </DialogHeader>
          {returnFor && (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Document</span>
                <span className="font-mono-tabular">{returnFor.invoiceNumber}</span>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Line</label>
                <Select value={returnLineId} onValueChange={(v) => {
                  setReturnLineId(v);
                  const line = returnFor.lines.find((l) => l.productId === v);
                  if (line) setReturnRefund((line.unitPrice * (1 - (line.discountPct ?? 0) / 100)).toFixed(2));
                }}>
                  <SelectTrigger className="rounded-none border-2 border-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {returnFor.lines.map((l) => (
                      <SelectItem key={l.productId} value={l.productId}>
                        {l.name} · {l.barcode} · qty {l.quantity}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Quantity</label>
                  <input
                    type="number" min="1" step="1"
                    value={returnQty}
                    onChange={(e) => setReturnQty(e.target.value)}
                    className="h-10 w-full bg-transparent font-mono-tabular outline-none border-b border-foreground/30 focus:border-foreground"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Refund amount</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={returnRefund}
                    onChange={(e) => setReturnRefund(e.target.value)}
                    className="h-10 w-full bg-transparent font-mono-tabular outline-none border-b border-foreground/30 focus:border-foreground"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Reason</label>
                  <Select value={returnReason} onValueChange={(v) => setReturnReason(v as typeof returnReason)}>
                    <SelectTrigger className="rounded-none border-2 border-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="customer_changed_mind">Customer changed mind</SelectItem>
                      <SelectItem value="defective">Defective</SelectItem>
                      <SelectItem value="wrong_size">Wrong size</SelectItem>
                      <SelectItem value="wrong_item">Wrong item</SelectItem>
                      <SelectItem value="damaged">Damaged</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Condition</label>
                  <Select value={returnCondition} onValueChange={(v) => setReturnCondition(v as typeof returnCondition)}>
                    <SelectTrigger className="rounded-none border-2 border-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="resellable">Resellable</SelectItem>
                      <SelectItem value="damaged">Damaged</SelectItem>
                      <SelectItem value="repair_needed">Needs repair</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Stock action</label>
                <Select value={returnStockAction} onValueChange={(v) => setReturnStockAction(v as typeof returnStockAction)}>
                  <SelectTrigger className="rounded-none border-2 border-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="back_to_stock">Back to stock</SelectItem>
                    <SelectItem value="repair">Send to repair</SelectItem>
                    <SelectItem value="discard">Discard</SelectItem>
                    <SelectItem value="no_stock_change">No stock change</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnFor(null)}>Cancel</Button>
            <Button onClick={submitReturn}><Undo2 /> Record return</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewSale} onOpenChange={(o) => !o && setViewSale(null)}>
        <DialogContent className="max-w-3xl rounded-none border-2 border-foreground max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl flex items-center gap-3">
              <span>{viewSale?.invoiceNumber}</span>
              {viewSale && <StatusBadge status={statusOf(viewSale)} />}
            </DialogTitle>
          </DialogHeader>
          {viewSale && (
            <div className="space-y-5 text-sm">
              <div className="grid grid-cols-2 gap-4 border-2 border-foreground p-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Customer</div>
                  <div className="font-medium">{viewSale.customerSnapshot.name}</div>
                  {viewSale.customerSnapshot.phone && (
                    <div className="text-xs text-muted-foreground">{viewSale.customerSnapshot.phone}</div>
                  )}
                  {viewSale.customerSnapshot.email && (
                    <div className="text-xs text-muted-foreground">{viewSale.customerSnapshot.email}</div>
                  )}
                  {viewSale.customerSnapshot.vatNumber && (
                    <div className="text-xs text-muted-foreground">VAT: {viewSale.customerSnapshot.vatNumber}</div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Date</div>
                  <div className="font-mono-tabular">{fmtDate(viewSale.createdAt)}</div>
                  <div className="mt-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Document</div>
                  <div className="font-mono-tabular">{viewSale.documentType ?? "INVOICE"}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-2 border-foreground p-4">
                <div>
                  <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Payment status</div>
                  <Select
                    value={statusOf(viewSale)}
                    onValueChange={(v) => {
                      void (async () => {
                      const s = viewSale;
                      if (!s) return;
                      const next = v as PaymentStatus;
                      const cur = statusOf(s);
                      if (next === cur) return;
                      if (next === "PAID") {
                        const due = s.amountDue ?? Math.max(0, s.total - (s.amountPaid ?? 0));
                        if (due > 0) {
                          let invoiceNumber: string | undefined;
                          if (cloudSalesAvailable() && s.invoiceNumber.startsWith("DRAFT-")) {
                            try {
                              invoiceNumber = await allocateDocumentSerial(s.documentType ?? "INVOICE") ?? undefined;
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : "Could not allocate cloud document number");
                              return;
                            }
                          }
                          const snapshot = snapshotSalesState();
                          const updated = salesStore.recordPaymentDetailed(s.id, {
                            amount: due,
                            method: "CASH",
                            note: "Marked as paid",
                            invoiceNumber,
                          });
                          if (updated) {
                            try {
                              await saveSaleToCloud(updated, { previousSale: s, operation: "payment", actor: session?.username });
                            } catch (error) {
                              restoreSalesState(snapshot);
                              toast.error(error instanceof Error ? error.message : "Cloud database save failed");
                              return;
                            }
                            if ((updated.documentType ?? "INVOICE") === "PROFORMA") {
                              const invoice = await convertProformaToInvoice(updated);
                              setViewSale(invoice ?? updated);
                            } else {
                              setViewSale(updated);
                            }
                          }
                        }
                        toast.success("Marked as paid");
                      } else {
                        toast.info("To revert payment, record a refund/return.");
                      }
                      })();
                    }}
                  >
                    <SelectTrigger className="rounded-none border-2 border-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OPEN" disabled={statusOf(viewSale) !== "OPEN"}>Open</SelectItem>
                      <SelectItem value="PARTIAL" disabled={statusOf(viewSale) !== "PARTIAL"}>Partial</SelectItem>
                      <SelectItem value="PAID">Paid</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    Pending: <span className="font-mono-tabular">{fmtMoney(viewSale.amountDue ?? 0)}</span>
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Preparation status</div>
                  <Select
                    value={deliveryStatusOf(viewSale)}
                    onValueChange={(v) => {
                      const s = viewSale;
                      if (!s) return;
                      const updated = salesStore.setDeliveryStatus(s.id, v as DeliveryStatus);
                      if (updated) {
                        setViewSale(updated);
                        toast.success("Preparation status updated");
                      }
                    }}
                  >
                    <SelectTrigger className="rounded-none border-2 border-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(() => {
                        const cur = deliveryStatusOf(viewSale);
                        const opts = deliveryOptionsFor(viewSale);
                        const list: DeliveryStatus[] = opts.includes(cur) ? opts : [cur, ...opts];
                        return list.map((s) => (
                          <SelectItem key={s} value={s}>{DELIVERY_LABELS[s]}</SelectItem>
                        ));
                      })()}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {isEditable && (
                <form
                  onSubmit={(e) => { e.preventDefault(); editAddByBarcode(scanCode); }}
                  className="flex items-center gap-3 border-2 border-foreground bg-background px-3"
                >
                  <Barcode className="h-4 w-4 text-accent" />
                  <input
                    autoFocus
                    value={scanCode}
                    onChange={(e) => setScanCode(e.target.value)}
                    placeholder="Scan or type barcode to add a product"
                    className="h-10 w-full bg-transparent font-mono-tabular text-sm outline-none placeholder:font-sans placeholder:text-muted-foreground"
                  />
                  <Button type="submit" size="sm">Add</Button>
                </form>
              )}

              <div className="border-2 border-foreground">
                <div className="grid grid-cols-[1fr_104px_88px_112px_40px] items-center gap-3 bg-foreground px-4 py-2 text-[10px] uppercase tracking-wider text-primary-foreground">
                  <div>Item</div>
                  <div className="text-center">Qty</div>
                  <div className="text-center">Disc %</div>
                  <div className="text-right">Amount</div>
                  <div />
                </div>
                {(isEditable ? (editLines ?? []) : viewSale.lines).map((l) => {
                  const lineTotal = l.unitPrice * l.quantity * (1 - (l.discountPct ?? 0) / 100);
                  return (
                    <div
                      key={l.productId}
                      className="grid grid-cols-[1fr_104px_88px_112px_40px] items-center gap-3 border-t border-foreground/10 px-4 py-3"
                    >
                      <div>
                        <div className="font-medium">{l.name}</div>
                        <div className="text-xs text-muted-foreground font-mono-tabular">
                          {l.barcode}
                          {l.size || l.color ? ` · ${[l.size, l.color].filter(Boolean).join(" / ")}` : ""}
                          {" · "}{fmtMoney(l.unitPrice)}
                        </div>
                      </div>
                      {isEditable ? (
                        <div className="flex items-center justify-center border border-foreground">
                          <button type="button" className="flex h-8 w-8 items-center justify-center hover:bg-foreground hover:text-primary-foreground" onClick={() => editUpdateQty(l.productId, -1)}><Minus className="h-3 w-3" /></button>
                          <div className="w-8 text-center font-mono-tabular text-sm">{l.quantity}</div>
                          <button type="button" className="flex h-8 w-8 items-center justify-center hover:bg-foreground hover:text-primary-foreground" onClick={() => editUpdateQty(l.productId, 1)}><Plus className="h-3 w-3" /></button>
                        </div>
                      ) : (
                        <div className="text-center font-mono-tabular text-sm">{l.quantity}</div>
                      )}
                      {isEditable ? (
                        <div className="flex items-center justify-center border border-foreground">
                          <input
                            type="number" min={0} max={100} step={1}
                            value={l.discountPct ?? 0}
                            onChange={(e) => editUpdateDiscount(l.productId, e.target.value)}
                            className="h-8 w-12 bg-transparent text-center font-mono-tabular text-sm outline-none"
                          />
                          <span className="pr-1 font-mono-tabular text-xs text-muted-foreground">%</span>
                        </div>
                      ) : (
                        <div className="text-center font-mono-tabular text-sm">{l.discountPct ? `${l.discountPct}%` : "—"}</div>
                      )}
                      <div className="text-right font-mono-tabular font-semibold">
                        {fmtMoney(lineTotal)}
                        {(l.discountPct ?? 0) > 0 && (
                          <div className="text-[10px] font-normal text-muted-foreground line-through">
                            {fmtMoney(l.unitPrice * l.quantity)}
                          </div>
                        )}
                      </div>
                      {isEditable ? (
                        <Button size="icon" variant="ghost" className="justify-self-end" onClick={() => editRemoveLine(l.productId)}><Trash2 /></Button>
                      ) : (
                        <div />
                      )}
                    </div>
                  );
                })}
              </div>

              {isEditable && dirtyLines && (
                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={discardLineEdits}>Discard changes</Button>
                  <Button size="sm" onClick={saveLineEdits}>Save changes</Button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  {isEditable ? (
                    <div className="border-2 border-foreground p-3">
                      <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Transport</div>
                      <Select
                        value={editTransport?.method ?? undefined}
                        onValueChange={(v) => setTransportMethod(v as "PICKUP" | "DELIVERY")}
                      >
                        <SelectTrigger className="h-10 rounded-none border-2 border-foreground">
                          <SelectValue placeholder="Select transport method" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PICKUP">Collect in store · No transport fee</SelectItem>
                          <SelectItem value="DELIVERY" disabled={!deliveryAvailable}>
                            {deliveryAvailable
                              ? `${logisticsCountry.toUpperCase()} transport · ${fmtMoney(transportFee)} fee`
                              : "Transport · Add a logistics address to enable"}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : viewSale.transport ? (
                    <div className="flex justify-between"><span className="text-muted-foreground">Transport ({viewSale.transport.label})</span><span className="font-mono-tabular">{fmtMoney(viewSale.transport.fee)}</span></div>
                  ) : null}
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mt-3">Payments</div>
                  {viewSale.payments && viewSale.payments.length > 0 ? (
                    viewSale.payments.map((p) => (
                      <div key={p.id} className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{fmtDate(p.createdAt)} · {p.method}</span>
                        <span className="font-mono-tabular">{fmtMoney(p.amount)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-muted-foreground">No payments recorded</div>
                  )}
                </div>
                {(() => {
                  const useEdit = isEditable && !!editLines;
                  const subtotal = useEdit
                    ? (editLines ?? []).reduce((a, l) => a + l.unitPrice * l.quantity * (1 - (l.discountPct ?? 0) / 100), 0)
                    : viewSale.subtotal;
                  const tax = useEdit ? subtotal * (viewSale.taxRate ?? 0) : viewSale.tax;
                  const tFee = useEdit
                    ? (editTransport?.fee ?? 0)
                    : (viewSale.transport?.fee ?? 0);
                  const total = useEdit ? subtotal + tax + tFee : viewSale.total;
                  const amountPaid = Math.min(total, viewSale.amountPaid ?? 0);
                  const amountDue = Math.max(0, total - amountPaid);
                  return (
                    <div className="space-y-1 border-2 border-foreground p-4">
                      <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-mono-tabular">{fmtMoney(subtotal)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Tax ({(viewSale.taxRate * 100).toFixed(1)}%)</span><span className="font-mono-tabular">{fmtMoney(tax)}</span></div>
                      {(useEdit ? !!editTransport : !!viewSale.transport) && (
                        <div className="flex justify-between text-xs"><span className="text-muted-foreground">Transport</span><span className="font-mono-tabular">{fmtMoney(tFee)}</span></div>
                      )}
                      <div className="flex justify-between border-t-2 border-foreground pt-2 font-display text-lg"><span>Total</span><span className="font-mono-tabular">{fmtMoney(total)}</span></div>
                      <div className="flex justify-between text-xs"><span className="text-muted-foreground">Paid</span><span className="font-mono-tabular">{fmtMoney(amountPaid)}</span></div>
                      <div className="flex justify-between text-xs"><span className="text-muted-foreground">Pending</span><span className={cn("font-mono-tabular", amountDue > 0 && "text-bauhaus-red font-semibold")}>{fmtMoney(amountDue)}</span></div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
          <DialogFooter>
            {viewSale && statusOf(viewSale) !== "PAID" && (
              <Button variant="outline" onClick={() => { const s = viewSale; setViewSale(null); openPay(s); }}><Wallet /> Pay</Button>
            )}
            <Button
              variant="outline"
              onClick={() => viewSale && generateInvoicePdf(viewSale, { allowDraft: true, action: "preview" })}
              disabled={!viewSale || docStatusOf(viewSale) === "cancelled"}
            ><Eye /> Preview</Button>
            <Button
              variant="outline"
              onClick={() => viewSale && generateInvoicePdf(viewSale, { allowDraft: true, action: "print" })}
              disabled={!viewSale || docStatusOf(viewSale) === "cancelled"}
            ><Printer /> Print</Button>
            {viewSale?.transport?.method === "DELIVERY" && (
              <Button
                variant="outline"
                onClick={() => generateShippingLabelPdf(viewSale, { action: "print" })}
                disabled={docStatusOf(viewSale) === "cancelled"}
              ><Truck /> Label</Button>
            )}
            {viewSale &&
              (viewSale.documentType ?? "INVOICE") === "PROFORMA" &&
              statusOf(viewSale) === "PAID" &&
              docStatusOf(viewSale) === "open" && (
                <Button
                  variant="outline"
                  onClick={() => void (async () => {
                    const invoice = await convertProformaToInvoice(viewSale);
                    if (invoice) setViewSale(invoice);
                  })()}
                >
                  <FileText /> Generate invoice
                </Button>
              )}
            <Button
              onClick={() => viewSale && generateInvoicePdf(viewSale, { allowDraft: true })}
              disabled={!viewSale || docStatusOf(viewSale) === "cancelled"}
              title={viewSale && docStatusOf(viewSale) === "cancelled" ? "Cancelled documents cannot be re-issued" : undefined}
            ><FileText /> PDF</Button>
            <Button variant="outline" onClick={() => setViewSale(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="relative bg-background p-6">
      <div className={`absolute left-0 top-0 h-1 w-12 ${accent}`} />
      <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</div>
      <div className="mt-3 font-display text-3xl font-mono-tabular">{value}</div>
    </div>
  );
}
