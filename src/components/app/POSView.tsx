import { useEffect, useMemo, useRef, useState } from "react";
import { Barcode, Check, FileText, List, Minus, PackagePlus, Pencil, Plus, Printer, Search, Trash2, Truck, UserPlus, Wallet, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCustomers, useProducts } from "@/hooks/useStore";
import { customersStore, productsStore, salesStore } from "@/lib/storage";
import type { ClientType, Customer, PaymentEntry, PaymentMethod, PaymentStatus, Product, Sale, SaleDocumentType, SaleLine } from "@/types";
import { ProductMaintenanceView } from "./ProductMaintenanceView";
import { fmtMoney } from "@/lib/format";
import { toast } from "sonner";
import { generateInvoicePdf } from "@/lib/invoicePdf";
import { cn } from "@/lib/utils";
import { SectionHeader } from "./SectionHeader";
import { CustomerForm, composeCustomer, emptyCustomer, type CustomerDraft } from "./CustomerForm";
import { nanoid } from "nanoid";
import { getEffectiveTaxRate, getTaxBreakdown } from "@/lib/taxSettings";
import { getDefaultTransportFee } from "@/lib/transportSettings";
import { quoteTransport, type TransportQuote } from "@/lib/transportRates";
import { getCartWeightKg } from "@/lib/productWeight";
import { getB2cUnitPrice, getDefaultB2cMarkupPercent } from "@/lib/productSettings";
import { normalizeProductCode } from "@/lib/productCodes";
import { generateShippingLabelPdf } from "@/lib/shippingLabelPdf";
import { deliverySourceSuffix, getCustomerDeliveryAddress } from "@/lib/customerAddress";
import { maintenanceStore, useMaintenance } from "@/lib/maintenanceStore";
import { pushCustomersToCloud } from "@/lib/cloudCustomers";
import {
  allocateDocumentSerial,
  cloudSalesAvailable,
  restoreSalesState,
  saveSaleToCloud,
  snapshotSalesState,
} from "@/lib/cloudSales";

type PaymentChoice = "FULL" | "PARTIAL" | "OPEN";

const POS_DRAFT_KEY = "form.posDraft.v5";

type PriceMode = "B2B" | "B2C" | "NOTE" | "PROFORMA";

const MODE_DOC: Record<PriceMode, SaleDocumentType> = {
  B2B: "INVOICE",
  NOTE: "DELIVERY_NOTE",
  B2C: "RECEIPT",
  PROFORMA: "PROFORMA",
};

const MODE_LABEL: Record<PriceMode, string> = {
  B2B: "Invoice",
  NOTE: "Delivery note",
  B2C: "Receipt",
  PROFORMA: "Proforma",
};
type PosDraft = {
  customer: Customer | null;
  lines: SaleLine[];
  priceMode: PriceMode;
  customerQuery: string;
  transportMethod: "PICKUP" | "DELIVERY" | null;
};

function loadDraft(): PosDraft {
  try {
    const raw = localStorage.getItem(POS_DRAFT_KEY);
    if (!raw) return { customer: null, lines: [], priceMode: "B2B", customerQuery: "", transportMethod: null };
    const parsed = JSON.parse(raw);
    return {
      customer: parsed.customer ?? null,
      lines: Array.isArray(parsed.lines) ? parsed.lines : [],
      priceMode:
        parsed.priceMode === "B2C"
          ? "B2C"
          : parsed.priceMode === "PROFORMA"
          ? "PROFORMA"
          : parsed.priceMode === "NOTE" || parsed.priceMode === "NOTA"
          ? "NOTE"
          : "B2B",
      customerQuery: typeof parsed.customerQuery === "string" ? parsed.customerQuery : "",
      transportMethod:
        parsed.transportMethod === "PICKUP" || parsed.transportMethod === "DELIVERY"
          ? parsed.transportMethod
          : null,
    };
  } catch {
    return { customer: null, lines: [], priceMode: "B2B", customerQuery: "", transportMethod: null };
  }
}

export function POSView() {
  const [products] = useProducts();
  const [customers] = useCustomers();
  const maintenanceItems = useMaintenance();
  const openMaintenanceCount = maintenanceItems.filter((item) => !item.resolved).length;

  const initial = useRef<PosDraft>(loadDraft());
  const [customer, setCustomer] = useState<Customer | null>(initial.current.customer);
  const [customerQuery, setCustomerQuery] = useState(initial.current.customerQuery);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState<CustomerDraft>(emptyCustomer);
  const [showSelectCustomer, setShowSelectCustomer] = useState(false);
  const [selectQuery, setSelectQuery] = useState("");
  const [priceMode, setPriceMode] = useState<PriceMode>(initial.current.priceMode);

  const [lines, setLines] = useState<SaleLine[]>(initial.current.lines);
  const [scan, setScan] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);
  const [showTempProduct, setShowTempProduct] = useState(false);
  const [tempName, setTempName] = useState("");
  const [tempPrice, setTempPrice] = useState("");
  const [tempReason, setTempReason] = useState("not_found");
  const [tempAssociatedCode, setTempAssociatedCode] = useState("");
  const [tempNote, setTempNote] = useState("");
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);

  const [transportMethod, setTransportMethod] = useState<"PICKUP" | "DELIVERY" | null>(initial.current.transportMethod);
  const fallbackTransportFee = getDefaultTransportFee();
  const [manualTransportFee, setManualTransportFee] = useState("");
  const [manualTransportTouched, setManualTransportTouched] = useState(false);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>("FULL");
  const [partialAmount, setPartialAmount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CARD");
  const [createdSale, setCreatedSale] = useState<Sale | null>(null);

  // Persist draft so switching tabs doesn't lose work in progress.
  useEffect(() => {
    try {
      localStorage.setItem(
        POS_DRAFT_KEY,
        JSON.stringify({ customer, lines, priceMode, customerQuery, transportMethod }),
      );
    } catch {
      // ignore quota errors
    }
  }, [customer, lines, priceMode, customerQuery, transportMethod]);

  // Keep scanner input ready; checkout still requires a customer.
  useEffect(() => {
    if (!paymentOpen && !showNewCustomer && !showSelectCustomer) {
      scanRef.current?.focus();
    }
  }, [paymentOpen, showNewCustomer, showSelectCustomer, lines.length]);

  useEffect(() => {
    if (customer && lines.length > 0 && !transportMethod) {
      setTransportMethod("PICKUP");
    }
  }, [customer, lines.length, transportMethod]);

  const customerMatches = useMemo(() => {
    if (!customerQuery.trim()) return [];
    return customersStore
      .search(customerQuery)
      .filter((c) => {
        const ct: ClientType = c.clientType ?? "B2B";
        if (priceMode === "NOTE" || priceMode === "PROFORMA") return ct === "B2B";
        return ct === priceMode;
      })
      .slice(0, 6);
  }, [customerQuery, customers, priceMode]);

  const selectableCustomers = useMemo(() => {
    const t = selectQuery.trim().toLowerCase();
    return customers
      .filter((c) => {
        const ct: ClientType = c.clientType ?? "B2B";
        if (priceMode === "NOTE" || priceMode === "PROFORMA") return ct === "B2B";
        return ct === priceMode;
      })
      .filter((c) =>
        !t ||
        [c.id, c.name, c.surname, c.businessName, c.phone, c.email, c.vatNumber]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(t),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, selectQuery, priceMode]);

  function addProductToCart(product: Product, unitPriceOverride?: number) {
    const unitPrice =
      unitPriceOverride ??
      (priceMode === "B2C"
        ? getB2cUnitPrice(product.price, product.b2cMarkup, product.b2cPrice)
        : product.price);
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.productId === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [
        ...prev,
        {
          productId: product.id,
          barcode: product.sku || product.barcode,
          name: product.name,
          size: product.size,
          color: product.color,
          unitPrice,
          quantity: 1,
          discountPct: 0,
        },
      ];
    });
  }

  function addByBarcode(code: string): boolean {
    const trimmed = code.trim();
    if (!trimmed) return false;
    const p = productsStore.byBarcode(trimmed);
    if (!p) {
      const normalized = normalizeProductCode(trimmed);
      const isModel = productsStore.all().some((x) => normalizeProductCode(x.barcode) === normalized);
      toast.error(
        isModel
          ? `"${trimmed}" is a model code. Enter the full SKU (Model + Colour + Size).`
          : `No product for "${trimmed}"`,
      );
      return false;
    }
    const unitPrice = priceMode === "B2C" ? getB2cUnitPrice(p.price, p.b2cMarkup, p.b2cPrice) : p.price;
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.productId === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [
        ...prev,
        {
          productId: p.id, barcode: p.sku || p.barcode, name: p.name,
          size: p.size, color: p.color, unitPrice, quantity: 1, discountPct: 0,
        },
      ];
    });
    toast.success(`Added · ${p.name}`);
    return true;
  }

  // When the price mode changes, re-price existing cart lines.
  useEffect(() => {
    setLines((prev) =>
      prev.map((l) => {
        const p = products.find((x) => x.id === l.productId);
        if (!p) return l;
        const unitPrice = priceMode === "B2C" ? getB2cUnitPrice(p.price, p.b2cMarkup, p.b2cPrice) : p.price;
        return { ...l, unitPrice };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceMode]);

  function onScanSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (addByBarcode(scan)) {
      setScan("");
    } else {
      setTempAssociatedCode(normalizeProductCode(scan));
    }
  }

  function updateQty(productId: string, delta: number) {
    setLines((prev) =>
      prev
        .map((l) => (l.productId === productId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  }
  function setQty(productId: string, raw: string) {
    const n = raw === "" ? 0 : parseInt(raw, 10);
    const quantity = Number.isFinite(n) ? Math.max(0, n) : 0;
    setLines((prev) =>
      prev
        .map((l) => (l.productId === productId ? { ...l, quantity } : l))
        .filter((l) => l.quantity > 0),
    );
  }
  function removeLine(productId: string) {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  }
  function updateDiscount(productId: string, raw: string) {
    const n = raw === "" ? 0 : parseFloat(raw);
    const clamped = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
    setLines((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, discountPct: clamped } : l)),
    );
  }

  const lineTotal = (l: SaleLine) =>
    l.unitPrice * l.quantity * (1 - (l.discountPct ?? 0) / 100);
  const grossSubtotal = lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
  const subtotal = lines.reduce((a, l) => a + lineTotal(l), 0);
  const totalDiscount = Math.max(0, grossSubtotal - subtotal);
  const b2bTaxMode = priceMode === "NOTE" || priceMode === "PROFORMA";
  const baseTaxRate = getEffectiveTaxRate(customer, b2bTaxMode ? "B2B" : priceMode);
  // Delivery notes (NOTE) are issued without tax.
  const taxRate = priceMode === "NOTE" ? 0 : baseTaxRate;
  const tax = subtotal * taxRate;
  const taxBreakdown =
    priceMode === "NOTE"
      ? { vat: 0, surcharge: 0, total: 0 }
      : getTaxBreakdown(customer, b2bTaxMode ? "B2B" : priceMode);
  const deliveryAddress = getCustomerDeliveryAddress(customer);
  const deliveryCountry = (deliveryAddress.address?.country || "").trim();
  const deliveryProvince = (deliveryAddress.address?.provinceState || "").trim();
  const deliveryAvailable = !!deliveryCountry;

  // Total order weight = Σ effective weight × qty + packaging.
  // Effective weight uses the manual product weight when present, otherwise
  // falls back to the fine-category default. See lib/productWeight.ts.
  const cartWeightKg = useMemo(() => {
    const b = getCartWeightKg(
      lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      products,
    );
    return { kg: b.totalKg, complete: b.totalKg > 0, allManual: b.allManual };
  }, [lines, products]);

  const transportQuote: TransportQuote | null = useMemo(() => {
    if (!deliveryAvailable || !cartWeightKg.complete) return null;
    const qs = quoteTransport({
      country: deliveryCountry,
      province: deliveryProvince,
      weightKg: cartWeightKg.kg,
    });
    return qs[0] ?? null;
  }, [deliveryAvailable, deliveryCountry, deliveryProvince, cartWeightKg]);

  const effectiveTransportMethod: "PICKUP" | "DELIVERY" | null =
    transportMethod === "DELIVERY" && deliveryAvailable
      ? "DELIVERY"
      : transportMethod === "PICKUP"
      ? "PICKUP"
      : null;
  const deliveryFee = transportQuote ? transportQuote.price : fallbackTransportFee;
  const manualTransportValue = Number(String(manualTransportFee).replace(",", "."));
  const effectiveDeliveryFee =
    manualTransportTouched && Number.isFinite(manualTransportValue) && manualTransportValue >= 0
      ? manualTransportValue
      : deliveryFee;
  const deliveryLabel = transportQuote
    ? `${transportQuote.label}${deliverySourceSuffix(deliveryAddress.source)}`
    : `${deliveryCountry.toUpperCase()} TRANSPORT${deliverySourceSuffix(deliveryAddress.source)}`;
  const transportLabel =
    effectiveTransportMethod === "DELIVERY"
      ? deliveryLabel
      : effectiveTransportMethod === "PICKUP"
      ? "Collect in store"
      : "-";
  const transportCost = effectiveTransportMethod === "DELIVERY" ? effectiveDeliveryFee : 0;
  const itemCount = lines.reduce((a, l) => a + l.quantity, 0);
  const total = subtotal + tax + transportCost;

  async function createNewCustomer() {
    if (!newCustomer.name) { toast.error("Name is required"); return; }
    if (!newCustomer.phoneNumber) { toast.error("Contact phone number is required"); return; }
    const c = customersStore.upsert(composeCustomer(newCustomer));
    try {
      await pushCustomersToCloud();
    } catch (error) {
      console.warn("Customer created locally but cloud push failed", error);
      toast.warning("Customer created locally. Cloud sync is pending.");
    }
    setCustomer(c);
    setCustomerQuery("");
    setNewCustomer(emptyCustomer);
    setShowNewCustomer(false);
    toast.success("Customer created");
  }

  function openTemporaryProduct() {
    setTempAssociatedCode(normalizeProductCode(scan));
    setShowTempProduct(true);
  }

  function createTemporaryProduct() {
    const name = tempName.trim();
    const price = Number(String(tempPrice).replace(",", "."));
    if (!name) {
      toast.error("Temporary product name is required");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      toast.error("Enter a valid price");
      return;
    }
    const code = normalizeProductCode(tempAssociatedCode);
    const modelCode = code || `TEMP-${Date.now().toString(36).toUpperCase()}`;
    const product = productsStore.upsert({
      barcode: modelCode,
      sku: modelCode,
      name,
      description: tempNote.trim() || "Temporary POS product",
      category: "TEMPORARY",
      fineCategory: "TEMPORARY",
      price,
      cost: 0,
      b2cMarkup: getDefaultB2cMarkupPercent() / 100,
      b2cPrice: priceMode === "B2C" ? price : undefined,
      stock: 0,
      lowStockThreshold: 0,
      temporaryProduct: true,
      maintenanceStatus: "open",
      maintenanceReason: tempReason,
      maintenanceNote: tempNote.trim() || undefined,
      associatedSku: code || undefined,
    });
    maintenanceStore.add({
      reason: tempReason === "not_found" ? "cannot_find_product" : "other",
      reasonOther: tempReason === "not_found" ? undefined : tempReason,
      associatedSku: code || undefined,
      note: [`${name} - ${price.toFixed(2)}`, tempNote.trim()].filter(Boolean).join(" | "),
      createdBy: "POS",
    });
    addProductToCart(product, price);
    setShowTempProduct(false);
    setTempName("");
    setTempPrice("");
    setTempReason("not_found");
    setTempAssociatedCode("");
    setTempNote("");
    setScan("");
    toast.success("Temporary product added");
  }

  function openPayment() {
    if (!customer || lines.length === 0) return;
    if (!effectiveTransportMethod) setTransportMethod("PICKUP");
    setPaymentChoice("FULL");
    setPartialAmount("");
    setPaymentMethod("CARD");
    setPaymentOpen(true);
  }

  async function finalize() {
    if (!customer || lines.length === 0) return;

    let amountPaid = 0;
    let paymentStatus: PaymentStatus = "OPEN";
    const payments: PaymentEntry[] = [];

    if (paymentChoice === "FULL") {
      amountPaid = total;
      paymentStatus = "PAID";
      payments.push({
        id: nanoid(8), amount: total, method: paymentMethod, createdAt: Date.now(),
      });
    } else if (paymentChoice === "PARTIAL") {
      const n = parseFloat(partialAmount);
      if (!Number.isFinite(n) || n <= 0) { toast.error("Enter a valid partial amount"); return; }
      if (n >= total) { toast.error("Partial amount must be less than total"); return; }
      amountPaid = n;
      paymentStatus = "PARTIAL";
      payments.push({
        id: nanoid(8), amount: n, method: paymentMethod, createdAt: Date.now(),
      });
    } else {
      // OPEN order — nothing paid
      amountPaid = 0;
      paymentStatus = "OPEN";
    }
    const amountDue = Math.max(0, total - amountPaid);
    const documentType = MODE_DOC[priceMode];
    let invoiceNumber: string | undefined;
    if (cloudSalesAvailable() && (paymentStatus === "PAID" || documentType === "PROFORMA")) {
      try {
        invoiceNumber = await allocateDocumentSerial(documentType) ?? undefined;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not allocate cloud document number");
        return;
      }
    }

    const snapshot = snapshotSalesState();
    const sale = salesStore.create({
      documentType,
      invoiceNumber,
      customerId: customer.id,
      customerSnapshot: {
        name: customer.name, phone: customer.phone, email: customer.email,
        vatNumber: customer.vatNumber, address: customer.address,
        businessName: customer.businessName,
        fiscalAddress: customer.fiscalAddress,
        logisticsAddress: customer.logisticsAddress,
      },
      lines,
      subtotal, taxRate, tax, total,
      taxBreakdown: taxBreakdown.surcharge > 0
        ? {
            vat: taxBreakdown.vat,
            surcharge: taxBreakdown.surcharge,
            vatAmount: subtotal * taxBreakdown.vat,
            surchargeAmount: subtotal * taxBreakdown.surcharge,
          }
        : undefined,
      transport: {
        method: effectiveTransportMethod ?? "PICKUP",
        label: transportLabel,
        fee: transportCost,
      },
      paymentStatus, amountPaid, amountDue, payments,
    });
    try {
      await saveSaleToCloud(sale, { operation: "create", actor: "pos" });
    } catch (error) {
      restoreSalesState(snapshot);
      toast.error(error instanceof Error ? error.message : "Cloud database save failed");
      return;
    }
    setCreatedSale(sale);
    setPaymentOpen(false);
    if (paymentStatus === "PAID") {
      generateInvoicePdf(sale);
      if (sale.transport?.method === "DELIVERY") {
        generateShippingLabelPdf(sale, { action: "cloud" });
      }
      toast.success(`${sale.invoiceNumber} · ${paymentStatus}`);
    } else {
      toast.success(
        `${sale.invoiceNumber} · ${paymentStatus} · document will be issued on full payment`,
      );
    }
    // reset
    setLines([]);
    setCustomer(null);
    setCustomerQuery("");
    setTransportMethod(null);
    setManualTransportFee("");
    setManualTransportTouched(false);
  }

  return (
    <>
      <div className="flex h-[calc(100vh-7rem)] flex-col overflow-hidden">
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-hidden bg-border lg:grid-cols-[72%_28%]">
          <section className="flex min-h-0 flex-col overflow-hidden bg-card">
            <header className="flex items-center justify-between border-b border-border px-8 py-6">
              <Step n="02" title="Scan products" done={lines.length > 0} />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-none"
                  onClick={() => setMaintenanceOpen(true)}
                >
                  <Wrench className="h-4 w-4" />
                  Maintenance
                  {openMaintenanceCount > 0 && (
                    <span className="ml-1 font-mono-tabular text-[10px] text-destructive">
                      {openMaintenanceCount}
                    </span>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-none"
                  onClick={openTemporaryProduct}
                >
                  <PackagePlus className="h-4 w-4" />
                  Temporal
                </Button>
              </div>
            </header>

            <form
              onSubmit={onScanSubmit}
              className="border-b border-border px-8 py-4"
            >
              <div className="flex items-center gap-3 border-2 border-foreground bg-background px-3">
                <Barcode className="h-5 w-5 text-accent" />
                <input
                  ref={scanRef}
                  autoFocus
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  placeholder="Scan or type barcode then press Enter"
                  className="h-12 w-full bg-transparent font-mono-tabular outline-none placeholder:font-sans placeholder:text-muted-foreground"
                />
                <Button type="submit" size="sm" className="rounded-none">
                  Add
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Hardware scanners auto-submit on Enter. Temporary products stay traceable in the maintenance log.
              </p>
            </form>

            <div className="min-h-0 flex-1 overflow-auto px-8 py-5">
              {lines.length === 0 ? (
                <div className="flex h-full min-h-[280px] items-center justify-center border-2 border-dashed border-border text-sm text-muted-foreground">
                  Cart is empty. Scan a product to begin.
                </div>
              ) : (
                <div className="min-w-[960px] border-2 border-foreground">
                  <div className="grid grid-cols-[90px_minmax(260px,1fr)_110px_90px_92px_104px_104px_120px_44px] items-center gap-3 bg-foreground px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-foreground">
                    <div>Ref</div>
                    <div>Product</div>
                    <div>Color</div>
                    <div>Size</div>
                    <div className="text-center">Qty</div>
                    <div className="text-right">Unit</div>
                    <div className="text-center">Disc.</div>
                    <div className="text-right">Total</div>
                    <div />
                  </div>
                  {lines.map((l) => (
                    <div
                      key={l.productId}
                      className="grid grid-cols-[90px_minmax(260px,1fr)_110px_90px_92px_104px_104px_120px_44px] items-center gap-3 border-t border-border px-4 py-4"
                    >
                      <div className="truncate font-mono-tabular text-xs">{l.barcode}</div>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{l.name}</div>
                        <div className="text-xs text-muted-foreground">{l.productId}</div>
                      </div>
                      <div className="truncate text-sm text-muted-foreground">{l.color || "-"}</div>
                      <div className="truncate font-mono-tabular text-sm">{l.size || "-"}</div>
                      <div className="flex h-9 items-center justify-center border border-foreground">
                        <button
                          type="button"
                          className="flex h-full w-8 items-center justify-center hover:bg-foreground hover:text-primary-foreground"
                          onClick={() => updateQty(l.productId, -1)}
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <input
                          type="number"
                          min={0}
                          value={l.quantity}
                          onChange={(e) => setQty(l.productId, e.target.value)}
                          className="h-full w-9 bg-transparent text-center font-mono-tabular text-sm outline-none"
                        />
                        <button
                          type="button"
                          className="flex h-full w-8 items-center justify-center hover:bg-foreground hover:text-primary-foreground"
                          onClick={() => updateQty(l.productId, 1)}
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="text-right font-mono-tabular text-sm">{fmtMoney(l.unitPrice)}</div>
                      <div className="flex h-9 items-center justify-center border border-foreground">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={l.discountPct ?? 0}
                          onChange={(e) => updateDiscount(l.productId, e.target.value)}
                          className="h-full w-12 bg-transparent text-center font-mono-tabular text-sm outline-none"
                        />
                        <span className="pr-1 font-mono-tabular text-xs text-muted-foreground">%</span>
                      </div>
                      <div className="text-right font-mono-tabular font-semibold">
                        {fmtMoney(lineTotal(l))}
                        {(l.discountPct ?? 0) > 0 && (
                          <div className="text-[10px] font-normal text-muted-foreground line-through">
                            {fmtMoney(l.unitPrice * l.quantity)}
                          </div>
                        )}
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="justify-self-end rounded-none"
                        onClick={() => removeLine(l.productId)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <aside className="flex min-h-0 flex-col overflow-hidden bg-card">
            <section className="border-b border-border px-6 py-5">
              <Step n="01" title="Identify customer" done={!!customer} />
              <div className="mt-3 flex flex-wrap gap-2">
                {(["B2B", "B2C"] as const).map((c) => {
                  const active =
                    c === "B2B"
                      ? priceMode === "B2B" || priceMode === "NOTE" || priceMode === "PROFORMA"
                      : priceMode === "B2C";
                  return (
                    <button
                      key={c}
                      type="button"
                      disabled={!!customer}
                      onClick={() => {
                        const next: PriceMode = c === "B2B" ? "B2B" : "B2C";
                        if (priceMode === next) return;
                        setPriceMode(next);
                        setCustomer(null);
                        setCustomerQuery("");
                        setLines([]);
                        setTransportMethod(null);
                        setManualTransportFee("");
                        setManualTransportTouched(false);
                      }}
                      className={cn(
                        "h-9 border-2 border-foreground px-4 font-mono-tabular text-xs uppercase tracking-[0.2em] transition-colors",
                        active ? "bg-foreground text-primary-foreground" : "bg-background hover:bg-secondary",
                        !!customer && "cursor-not-allowed opacity-50 hover:bg-background",
                      )}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
              {(priceMode === "B2B" || priceMode === "NOTE" || priceMode === "PROFORMA") && (
                <div className="mt-3 inline-flex border-2 border-foreground">
                  {([
                    { id: "B2B", label: "Invoice" },
                    { id: "NOTE", label: "Delivery note" },
                    { id: "PROFORMA", label: "Proforma" },
                  ] as { id: PriceMode; label: string }[]).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={!!customer}
                      onClick={() => {
                        if (priceMode === opt.id) return;
                        setPriceMode(opt.id);
                        setCustomer(null);
                        setCustomerQuery("");
                        setLines([]);
                        setTransportMethod(null);
                        setManualTransportFee("");
                        setManualTransportTouched(false);
                      }}
                      className={cn(
                        "h-9 px-3 font-mono-tabular text-[10px] uppercase tracking-[0.16em] transition-colors",
                        priceMode === opt.id ? "bg-foreground text-primary-foreground" : "bg-background hover:bg-secondary",
                        !!customer && "cursor-not-allowed opacity-50 hover:bg-background",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              {!customer ? (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2 border-2 border-foreground bg-background px-3">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <input
                      value={customerQuery}
                      onChange={(e) => setCustomerQuery(e.target.value)}
                      placeholder="ID, name, phone, VAT, email..."
                      className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-none"
                      onClick={() => {
                        const ct: ClientType = priceMode === "B2C" ? "B2C" : "B2B";
                        setNewCustomer({ ...emptyCustomer, clientType: ct });
                        setShowNewCustomer(true);
                      }}
                    >
                      <UserPlus className="h-4 w-4" />
                      New
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-none"
                      onClick={() => {
                        setSelectQuery("");
                        setShowSelectCustomer(true);
                      }}
                    >
                      <List className="h-4 w-4" />
                      Select
                    </Button>
                  </div>
                  {customerMatches.length > 0 && (
                    <div className="max-h-48 overflow-y-auto border-2 border-foreground bg-background">
                      {customerMatches.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setCustomer(c)}
                          className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-secondary"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{c.name}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {c.phone} / {c.vatNumber || "no VAT"}
                            </div>
                          </div>
                          <div className="font-mono-tabular text-[10px] uppercase tracking-wider text-muted-foreground">
                            {c.clientType ?? "B2B"}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-4 border-2 border-foreground bg-secondary p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        {customer.id} / {customer.clientType ?? "B2B"} / {MODE_LABEL[priceMode]}
                      </div>
                      <div className="mt-2 truncate font-display text-xl">
                        {[customer.name, customer.surname].filter(Boolean).join(" ")}
                      </div>
                      {customer.businessName && (
                        <div className="truncate text-sm text-muted-foreground">{customer.businessName}</div>
                      )}
                      <div className="mt-2 text-xs text-muted-foreground">
                        {customer.phone}
                        {customer.vatNumber && <> / VAT {customer.vatNumber}</>}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="outline"
                      className="rounded-none"
                      onClick={() => {
                        setCustomer(null);
                        setLines([]);
                        setCustomerQuery("");
                        setTransportMethod(null);
                        setManualTransportFee("");
                        setManualTransportTouched(false);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </section>

            <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5">
              <Step n="03" title="Checkout" done={false} disabled={!customer || lines.length === 0} />
              <div className={cn("mt-4 space-y-4", (!customer || lines.length === 0) && "pointer-events-none opacity-35")}>
                <div className="border-2 border-foreground p-4">
                  <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    Transport
                  </div>
                  <Select
                    value={effectiveTransportMethod ?? undefined}
                    onValueChange={(v) => {
                      if (v === "DELIVERY" && !deliveryAvailable) return;
                      setTransportMethod(v as "PICKUP" | "DELIVERY");
                      if (v !== "DELIVERY") {
                        setManualTransportTouched(false);
                        setManualTransportFee("");
                      }
                    }}
                  >
                    <SelectTrigger className="h-11 rounded-none border-2 border-foreground">
                      <SelectValue placeholder="Select transport method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PICKUP">Collect in store / No transport fee</SelectItem>
                      <SelectItem value="DELIVERY" disabled={!deliveryAvailable}>
                        {deliveryAvailable
                          ? `${deliveryLabel} / ${fmtMoney(deliveryFee)}${transportQuote ? "" : " estimate"}`
                          : "Transport / Add a fiscal or logistics address"}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {effectiveTransportMethod === "DELIVERY" && (
                    <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2">
                      <div>
                        <label className="mb-1 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                          Temporary transport fee
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={manualTransportTouched ? manualTransportFee : String(deliveryFee)}
                          onChange={(e) => {
                            setManualTransportTouched(true);
                            setManualTransportFee(e.target.value);
                          }}
                          className="h-10 w-full border-2 border-foreground bg-transparent px-3 font-mono-tabular text-sm outline-none"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-none"
                        onClick={() => {
                          setManualTransportTouched(false);
                          setManualTransportFee("");
                        }}
                      >
                        Reset
                      </Button>
                    </div>
                  )}
                </div>

                <div className="space-y-3 border-2 border-foreground p-5">
                  <ReceiptRow label="Items" value={String(itemCount)} />
                  <ReceiptRow label="Subtotal" value={fmtMoney(subtotal)} />
                  {totalDiscount > 0 && <ReceiptRow label="Discount" value={`-${fmtMoney(totalDiscount)}`} />}
                  {priceMode !== "NOTE" && taxBreakdown.surcharge > 0 ? (
                    <>
                      <ReceiptRow
                        label={`VAT ${(taxBreakdown.vat * 100).toFixed(2).replace(/\.?0+$/, "")}%`}
                        value={fmtMoney(subtotal * taxBreakdown.vat)}
                      />
                      <ReceiptRow
                        label={`Recargo ${(taxBreakdown.surcharge * 100).toFixed(2).replace(/\.?0+$/, "")}%`}
                        value={fmtMoney(subtotal * taxBreakdown.surcharge)}
                      />
                    </>
                  ) : (
                    <ReceiptRow
                      label={`Tax ${(taxRate * 100).toFixed(2).replace(/\.?0+$/, "")}%`}
                      value={fmtMoney(tax)}
                    />
                  )}
                  <ReceiptRow label={`Transport ${transportLabel}`} value={fmtMoney(transportCost)} />
                  <div className="border-t-2 border-foreground pt-3">
                    <div className="flex items-baseline justify-between">
                      <span className="font-display text-lg">Total</span>
                      <span className="font-display text-3xl font-mono-tabular">{fmtMoney(total)}</span>
                    </div>
                  </div>
                  <Button
                    className="w-full rounded-none"
                    size="lg"
                    disabled={!customer || lines.length === 0}
                    onClick={openPayment}
                  >
                    <Wallet className="h-4 w-4" />
                    Proceed to payment
                  </Button>
                  <Button
                    className="w-full rounded-none"
                    variant="outline"
                    disabled={lines.length === 0}
                    onClick={() => setLines([])}
                  >
                    Clear cart
                  </Button>
                </div>
              </div>

              <div className="mt-6 flex items-center gap-2 border-l-2 border-accent bg-accent-soft p-3 text-xs">
                <div className="h-2 w-2 bg-accent" />
                <span className="text-foreground/70">
                  Sale is saved in the sales database and attached to the customer's record.
                </span>
              </div>
            </section>
          </aside>
        </div>
      </div>

      {false && (
        <>
          <SectionHeader title="Customer Care System" />

      <div className="grid grid-cols-1 gap-px bg-foreground/10 lg:grid-cols-[1fr_420px]">
        {/* LEFT: customer + scanner + lines */}
        <div className="bg-background p-6">
          {/* STEP 1: customer */}
          <Step n="01" title="Identify customer" done={!!customer} />
          <div className="mb-2 inline-flex border-2 border-foreground">
              {(["B2B", "B2C"] as const).map((c) => {
                const active = c === "B2B" ? priceMode === "B2B" || priceMode === "NOTE" || priceMode === "PROFORMA" : priceMode === "B2C";
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={!!customer}
                    onClick={() => {
                      const next: PriceMode = c === "B2B" ? "B2B" : "B2C";
                      if (priceMode === next) return;
                      setPriceMode(next);
                      setCustomer(null);
                      setCustomerQuery("");
                      setLines([]);
                      setTransportMethod(null);
                      setManualTransportFee("");
                      setManualTransportTouched(false);
                    }}
                    className={cn(
                      "px-4 py-2 font-mono-tabular text-xs uppercase tracking-[0.2em] transition-colors",
                      active ? "bg-foreground text-primary-foreground" : "bg-background hover:bg-secondary",
                      !!customer && "cursor-not-allowed opacity-50 hover:bg-background",
                    )}
                  >
                    {c}
                  </button>
                );
              })}
          </div>
          <p className="mb-4 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Document · {MODE_LABEL[priceMode]}
            {priceMode === "NOTE" && " · No tax"}
          </p>
          <div className="mb-4 min-h-[44px] flex items-center">
            {(priceMode === "B2B" || priceMode === "NOTE" || priceMode === "PROFORMA") && (
              <div className="inline-flex border-2 border-foreground">
                {([
                  { id: "B2B", label: "INVOICE" },
                  { id: "NOTE", label: "NOTE" },
                  { id: "PROFORMA", label: "PROFORMA" },
                ] as { id: PriceMode; label: string }[]).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={!!customer}
                    onClick={() => {
                      if (priceMode === opt.id) return;
                      setPriceMode(opt.id);
                      setCustomer(null);
                      setCustomerQuery("");
                      setLines([]);
                      setTransportMethod(null);
                      setManualTransportFee("");
                      setManualTransportTouched(false);
                    }}
                    className={cn(
                      "px-4 py-2 font-mono-tabular text-xs uppercase tracking-[0.2em] transition-colors",
                      priceMode === opt.id ? "bg-foreground text-primary-foreground" : "bg-background hover:bg-secondary",
                      !!customer && "cursor-not-allowed opacity-50 hover:bg-background",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {!customer ? (
            <div className="mb-8">
              <div className="flex items-center gap-3 border-2 border-foreground bg-background px-3">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  autoFocus
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  placeholder="ID, name, phone, VAT, email…"
                  className="h-12 w-full bg-transparent outline-none placeholder:text-muted-foreground"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    // NOTE and PROFORMA modes still register a B2B client.
                    const ct: ClientType = priceMode === "B2C" ? "B2C" : "B2B";
                    setNewCustomer({ ...emptyCustomer, clientType: ct });
                    setShowNewCustomer(true);
                  }}
                ><UserPlus /> New</Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setSelectQuery(""); setShowSelectCustomer(true); }}
                ><List /> Select</Button>
              </div>
              {customerMatches.length > 0 && (
                <div className="mt-2 border-2 border-foreground bg-background">
                  {customerMatches.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setCustomer(c)}
                      className="flex w-full items-center justify-between border-b border-foreground/10 px-4 py-3 text-left last:border-b-0 hover:bg-secondary"
                    >
                      <div>
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{c.phone} · {c.vatNumber || "no VAT"}</div>
                      </div>
                      <div className="font-mono-tabular text-[10px] uppercase tracking-wider text-muted-foreground">{c.id}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="mb-8 flex items-start justify-between gap-4 border-2 border-foreground bg-secondary p-6">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Selling to · {customer.id} · {customer.clientType ?? "B2B"}
                </div>
                <div className="mt-1 font-display text-2xl leading-tight">
                  {[customer.name, customer.surname].filter(Boolean).join(" ")}
                </div>
                {customer.businessName && (
                  <div className="text-sm">{customer.businessName}</div>
                )}
                <div className="text-sm text-muted-foreground">
                  {customer.phone}
                  {customer.vatNumber && <> · VAT {customer.vatNumber}</>}
                </div>
                {customer.email && (
                  <div className="text-xs text-muted-foreground truncate">{customer.email}</div>
                )}
              </div>
              <Button size="icon" variant="ghost" onClick={() => { setCustomer(null); setLines([]); setCustomerQuery(""); setTransportMethod(null); setManualTransportFee(""); setManualTransportTouched(false); }}><X /></Button>
            </div>
          )}

          {/* STEP 2: scanner */}
          <Step n="02" title="Scan products" done={lines.length > 0} disabled={!customer} />
          <form onSubmit={onScanSubmit} className={cn("mb-4", !customer && "pointer-events-none opacity-25")}>
            <div className="flex items-center gap-3 border-2 border-foreground bg-background px-3">
              <Barcode className="h-5 w-5 text-accent" />
              <input
                ref={scanRef}
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                placeholder="Scan or type barcode then press Enter"
                className="h-12 w-full bg-transparent font-mono-tabular outline-none placeholder:font-sans placeholder:text-muted-foreground"
              />
              <Button type="submit" size="sm">Add</Button>
              <Button type="button" variant="outline" size="sm" onClick={openTemporaryProduct}>
                <PackagePlus /> Temporal
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Hardware scanners auto-submit on Enter. Click anywhere else and the field stays focused.</p>
          </form>

          {/* Lines */}
          {lines.length === 0 ? (
            <div className="border-2 border-dashed border-foreground/20 px-4 py-12 text-center text-sm text-muted-foreground">
              Cart is empty. Scan a product to begin.
            </div>
          ) : (
            <div className="border-2 border-foreground">
              <div className="grid grid-cols-[1fr_104px_88px_112px_40px] items-center gap-3 bg-foreground px-4 py-2 text-[10px] uppercase tracking-wider text-primary-foreground">
                <div>Item</div>
                <div className="text-center">Qty</div>
                <div className="text-center">Disc %</div>
                <div className="text-right">Amount</div>
                <div />
              </div>
              {lines.map((l) => (
                <div key={l.productId} className="grid grid-cols-[1fr_104px_88px_112px_40px] items-center gap-3 border-t border-foreground/10 px-4 py-3">
                  <div>
                    <div className="font-medium">{l.name}</div>
                    <div className="text-xs text-muted-foreground font-mono-tabular">
                      {l.barcode}{l.size || l.color ? ` · ${[l.size, l.color].filter(Boolean).join(" / ")}` : ""} · {fmtMoney(l.unitPrice)}
                    </div>
                  </div>
                  <div className="flex items-center justify-center border border-foreground">
                    <button className="flex h-8 w-8 items-center justify-center hover:bg-foreground hover:text-primary-foreground" onClick={() => updateQty(l.productId, -1)}><Minus className="h-3 w-3" /></button>
                    <div className="w-8 text-center font-mono-tabular text-sm">{l.quantity}</div>
                    <button className="flex h-8 w-8 items-center justify-center hover:bg-foreground hover:text-primary-foreground" onClick={() => updateQty(l.productId, 1)}><Plus className="h-3 w-3" /></button>
                  </div>
                  <div className="flex items-center justify-center border border-foreground">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={l.discountPct ?? 0}
                      onChange={(e) => updateDiscount(l.productId, e.target.value)}
                      className="h-8 w-12 bg-transparent text-center font-mono-tabular text-sm outline-none"
                    />
                    <span className="pr-1 font-mono-tabular text-xs text-muted-foreground">%</span>
                  </div>
                  <div className="text-right font-mono-tabular font-semibold">
                    {fmtMoney(lineTotal(l))}
                    {(l.discountPct ?? 0) > 0 && (
                      <div className="text-[10px] font-normal text-muted-foreground line-through">
                        {fmtMoney(l.unitPrice * l.quantity)}
                      </div>
                    )}
                  </div>
                  <Button size="icon" variant="ghost" className="justify-self-end" onClick={() => removeLine(l.productId)}><Trash2 /></Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: totals */}
        <aside className="bg-background p-6">
          <Step n="03" title="Checkout" done={false} disabled={!customer || lines.length === 0} />

          <div className={cn((!customer || lines.length === 0) && "pointer-events-none opacity-25")}>
          {/* Transport options */}
          <div className="mb-4 border-2 border-foreground p-4">
            <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Transport
            </div>
            <Select
              value={effectiveTransportMethod ?? undefined}
              onValueChange={(v) => {
                if (v === "DELIVERY" && !deliveryAvailable) return;
                setTransportMethod(v as "PICKUP" | "DELIVERY");
                if (v !== "DELIVERY") {
                  setManualTransportTouched(false);
                  setManualTransportFee("");
                }
              }}
            >
              <SelectTrigger className="h-11 rounded-none border-2 border-foreground">
                <SelectValue placeholder="Select transport method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PICKUP">
                  Collect in store · No transport fee
                </SelectItem>
                <SelectItem value="DELIVERY" disabled={!deliveryAvailable}>
                  {deliveryAvailable
                    ? `${deliveryLabel} · ${fmtMoney(deliveryFee)}${transportQuote ? "" : " (estimate)"}`
                    : "Transport · Add a fiscal or logistics address to enable"}
                </SelectItem>
              </SelectContent>
            </Select>
            {effectiveTransportMethod === "DELIVERY" && (
              <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2">
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    Temporary transport fee
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={manualTransportTouched ? manualTransportFee : String(deliveryFee)}
                    onChange={(e) => {
                      setManualTransportTouched(true);
                      setManualTransportFee(e.target.value);
                    }}
                    className="h-10 w-full border-2 border-foreground bg-transparent px-3 font-mono-tabular text-sm outline-none"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setManualTransportTouched(false);
                    setManualTransportFee("");
                  }}
                >
                  Reset
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-3 border-2 border-foreground p-5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Items</span>
              <span className="font-mono-tabular">{itemCount}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-mono-tabular">{fmtMoney(subtotal)}</span>
            </div>
            {priceMode !== "NOTE" && taxBreakdown.surcharge > 0 ? (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    VAT · {(taxBreakdown.vat * 100).toFixed(2).replace(/\.?0+$/, "")}%
                  </span>
                  <span className="font-mono-tabular">{fmtMoney(subtotal * taxBreakdown.vat)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Recargo · {(taxBreakdown.surcharge * 100).toFixed(2).replace(/\.?0+$/, "")}%
                  </span>
                  <span className="font-mono-tabular">
                    {fmtMoney(subtotal * taxBreakdown.surcharge)}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Tax · {(taxRate * 100).toFixed(2).replace(/\.?0+$/, "")}%
                </span>
                <span className="font-mono-tabular">{fmtMoney(tax)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Transport · {transportLabel}</span>
              <span className="font-mono-tabular">{fmtMoney(transportCost)}</span>
            </div>
            <div className="border-t-2 border-foreground pt-3" />
            <div className="flex items-baseline justify-between">
              <span className="font-display text-lg">Total</span>
              <span className="font-display text-3xl font-mono-tabular">{fmtMoney(total)}</span>
            </div>
            <Button
              className="w-full"
              size="lg"
              disabled={!customer || lines.length === 0}
              onClick={openPayment}
            >
              <Wallet /> Proceed to payment
            </Button>
            <Button
              className="w-full"
              variant="outline"
              disabled={lines.length === 0}
              onClick={() => setLines([])}
            >
              Clear cart
            </Button>
          </div>
          </div>

          <div className="mt-6 flex items-center gap-2 border-l-2 border-accent bg-accent-soft p-3 text-xs">
            <div className="h-2 w-2 bg-accent" />
            <span className="text-foreground/70">
              Sale is saved in the sales database and attached to the customer's record.
            </span>
          </div>
        </aside>
      </div>
        </>
      )}

      {/* New customer dialog */}
      <Dialog open={showNewCustomer} onOpenChange={setShowNewCustomer}>
        <DialogContent className="max-w-2xl rounded-none border-2 border-foreground max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">New customer</DialogTitle>
          </DialogHeader>
          <CustomerForm
            value={newCustomer}
            onChange={setNewCustomer}
            lockedClientType={priceMode === "B2C" ? "B2C" : "B2B"}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewCustomer(false)}>Cancel</Button>
            <Button onClick={createNewCustomer}>Create & select</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Select existing customer dialog */}
      <Dialog open={showSelectCustomer} onOpenChange={setShowSelectCustomer}>
        <DialogContent className="max-w-2xl rounded-none border-2 border-foreground max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              Select {priceMode === "B2C" ? "B2C" : "B2B"} customer
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-3 border-2 border-foreground bg-background px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={selectQuery}
              onChange={(e) => setSelectQuery(e.target.value)}
              placeholder="Search by ID, name, phone, VAT, email…"
              className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="mt-3 flex-1 overflow-y-auto border-2 border-foreground">
            {selectableCustomers.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                No customers found.
              </div>
            ) : (
              selectableCustomers.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setCustomer(c);
                    setShowSelectCustomer(false);
                    setCustomerQuery("");
                  }}
                  className="flex w-full items-start justify-between gap-4 border-b border-foreground/10 px-4 py-3 text-left last:border-b-0 hover:bg-secondary"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {[c.name, c.surname].filter(Boolean).join(" ")}
                      {c.businessName && (
                        <span className="text-muted-foreground"> · {c.businessName}</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.phone || "—"}
                      {c.email && <> · {c.email}</>}
                      {c.vatNumber && <> · VAT {c.vatNumber}</>}
                    </div>
                  </div>
                  <div className="font-mono-tabular text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                    {c.id}
                  </div>
                </button>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSelectCustomer(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Temporary product dialog */}
      <Dialog open={showTempProduct} onOpenChange={setShowTempProduct}>
        <DialogContent className="max-w-xl rounded-none border-2 border-foreground">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Temporal product</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Name</label>
                <input
                  autoFocus
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  className="h-10 w-full border-2 border-foreground bg-transparent px-2 outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Price</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={tempPrice}
                  onChange={(e) => setTempPrice(e.target.value)}
                  className="h-10 w-full border-2 border-foreground bg-transparent px-2 font-mono-tabular outline-none"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Reason</label>
                <Select value={tempReason} onValueChange={setTempReason}>
                  <SelectTrigger className="rounded-none border-2 border-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_found">SKU not found</SelectItem>
                    <SelectItem value="new_arrival">New arrival</SelectItem>
                    <SelectItem value="manual_sale">Manual sale</SelectItem>
                    <SelectItem value="barcode_missing">Barcode missing</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Associated SKU / P number</label>
                <input
                  value={tempAssociatedCode}
                  onChange={(e) => setTempAssociatedCode(normalizeProductCode(e.target.value))}
                  className="h-10 w-full border-2 border-foreground bg-transparent px-2 font-mono-tabular outline-none"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Note</label>
              <textarea
                value={tempNote}
                onChange={(e) => setTempNote(e.target.value)}
                rows={4}
                className="w-full border-2 border-foreground bg-transparent p-2 outline-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTempProduct(false)}>Cancel</Button>
            <Button onClick={createTemporaryProduct}><PackagePlus /> Add temporal product</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment step */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="max-w-lg rounded-none border-2 border-foreground">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Proceed to payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <Row label="Customer" value={customer?.name ?? ""} />
            <Row label="Total" value={fmtMoney(total)} highlight />

            <div className="grid grid-cols-3 gap-2">
              {([
                { id: "FULL", label: "Full payment", hint: "Mark as paid" },
                { id: "PARTIAL", label: "Partial payment", hint: "Pay part now" },
                { id: "OPEN", label: "Open order", hint: "Pay later" },
              ] as { id: PaymentChoice; label: string; hint: string }[]).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setPaymentChoice(o.id)}
                  className={cn(
                    "border-2 p-3 text-left transition-colors",
                    paymentChoice === o.id
                      ? "border-foreground bg-foreground text-primary-foreground"
                      : "border-foreground/20 hover:border-foreground",
                  )}
                >
                  <div className="font-display text-sm">{o.label}</div>
                  <div className={cn("text-[10px] uppercase tracking-wider mt-1",
                    paymentChoice === o.id ? "text-primary-foreground/70" : "text-muted-foreground")}>
                    {o.hint}
                  </div>
                </button>
              ))}
            </div>

            {paymentChoice === "PARTIAL" && (
              <div className="grid grid-cols-2 gap-3 border-2 border-foreground p-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount paid now</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={partialAmount}
                    onChange={(e) => setPartialAmount(e.target.value)}
                    placeholder="0.00"
                    className="h-10 w-full bg-transparent font-mono-tabular outline-none border-b border-foreground/30 focus:border-foreground"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Pending</label>
                  <div className="h-10 flex items-end font-mono-tabular text-base">
                    {fmtMoney(Math.max(0, total - (parseFloat(partialAmount) || 0)))}
                  </div>
                </div>
              </div>
            )}

            {paymentChoice !== "OPEN" && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Method</label>
                <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                  <SelectTrigger className="rounded-none border-2 border-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CARD">Card</SelectItem>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="TRANSFER">Bank transfer</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button>
            <Button onClick={finalize}><Check /> Confirm order</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createdSale} onOpenChange={(open) => !open && setCreatedSale(null)}>
        <DialogContent className="max-w-2xl rounded-none border-2 border-foreground max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Order detail</DialogTitle>
          </DialogHeader>
          {createdSale && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4 border-2 border-foreground p-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Document</div>
                  <div className="font-mono-tabular text-lg font-semibold">{createdSale.invoiceNumber}</div>
                  <div className="text-xs text-muted-foreground">{createdSale.documentType ?? "INVOICE"}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Customer</div>
                  <div className="font-semibold">{createdSale.customerSnapshot.name}</div>
                  <div className="text-xs text-muted-foreground">{createdSale.customerSnapshot.phone}</div>
                </div>
              </div>
              <div className="border-2 border-foreground">
                <div className="grid grid-cols-[1fr_72px_110px] bg-foreground px-3 py-2 text-[10px] uppercase tracking-wider text-primary-foreground">
                  <div>Item</div>
                  <div className="text-right">Qty</div>
                  <div className="text-right">Amount</div>
                </div>
                {createdSale.lines.map((line) => {
                  const amount = line.unitPrice * line.quantity * (1 - (line.discountPct ?? 0) / 100);
                  return (
                    <div key={line.productId} className="grid grid-cols-[1fr_72px_110px] border-t border-foreground/10 px-3 py-2">
                      <div>
                        <div className="font-medium">{line.name}</div>
                        <div className="font-mono-tabular text-xs text-muted-foreground">{line.barcode}</div>
                      </div>
                      <div className="text-right font-mono-tabular">{line.quantity}</div>
                      <div className="text-right font-mono-tabular">{fmtMoney(amount)}</div>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Row label="Items" value={String(createdSale.lines.reduce((sum, line) => sum + line.quantity, 0))} />
                <Row label="Total" value={fmtMoney(createdSale.total)} highlight />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => createdSale && generateInvoicePdf(createdSale, { allowDraft: true, action: "preview" })}
            >
              <FileText /> Preview invoice
            </Button>
            <Button
              variant="outline"
              onClick={() => createdSale && generateInvoicePdf(createdSale, { allowDraft: true, action: "print" })}
            >
              <Printer /> Print invoice
            </Button>
            {createdSale?.transport?.method === "DELIVERY" && (
              <Button
                variant="outline"
                onClick={() => createdSale && generateShippingLabelPdf(createdSale, { action: "preview" })}
              >
                <Truck /> Label
              </Button>
            )}
            <Button onClick={() => setCreatedSale(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={maintenanceOpen} onOpenChange={setMaintenanceOpen}>
        <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto p-0 sm:max-w-2xl">
          <ProductMaintenanceView onBack={() => setMaintenanceOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}

function Step({ n, title, done, disabled }: { n: string; title: string; done: boolean; disabled?: boolean }) {
  return (
    <div className={cn("mb-3 flex items-center gap-3", disabled && "opacity-25")}>
      <div className={cn("flex h-7 w-7 items-center justify-center font-mono-tabular text-xs",
        done ? "bg-accent text-accent-foreground" : "bg-foreground text-primary-foreground")}>
        {done ? <Check className="h-3.5 w-3.5" /> : n}
      </div>
      <h3 className="font-display text-lg">{title}</h3>
    </div>
  );
}
function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("flex justify-between border-b border-foreground/10 py-2", highlight && "border-b-0 bg-foreground px-3 py-3 text-primary-foreground")}>
      <span className={highlight ? "font-display" : "text-muted-foreground"}>{label}</span>
      <span className="font-mono-tabular font-semibold">{value}</span>
    </div>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-dashed border-border pb-1.5">
      <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
      <span className="font-mono-tabular text-xs">{value}</span>
    </div>
  );
}

function TransportOption({
  active,
  disabled,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center justify-between gap-3 border-2 bg-background px-3 py-2 text-left text-sm transition-colors",
        active
          ? "border-foreground bg-foreground text-primary-foreground"
          : "border-foreground hover:bg-secondary",
        disabled && "pointer-events-none opacity-25",
      )}
    >
      <span className="font-medium">{label}</span>
      <span className={cn("text-[10px] uppercase tracking-[0.2em]", active ? "opacity-80" : "text-muted-foreground")}>
        {hint}
      </span>
    </button>
  );
}
