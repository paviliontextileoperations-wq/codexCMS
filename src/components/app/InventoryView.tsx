import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  MapPin,
  PackageCheck,
  RefreshCw,
  Search,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SectionHeader } from "./SectionHeader";
import { EmptyState } from "./EmptyState";
import { inventoryLocationStore, inventoryStore } from "@/lib/inventoryStore";
import { productsStore } from "@/lib/storage";
import { fmtDate, fmtMoney } from "@/lib/format";
import { useInventoryLocations, useInventoryMovements, useProducts } from "@/hooks/useStore";
import type { InventoryMovement, InventoryMovementType, InventoryReasonCategory, Product } from "@/types";
import { toast } from "sonner";
import { adjustProductInventoryInCloud, productInventorySku } from "@/lib/cloudInventory";

type StockFilter = "all" | "low" | "out" | "available";
type Operation = Extract<
  InventoryMovementType,
  "inbound" | "outbound" | "stocktake" | "return" | "adjustment" | "transfer"
>;

const WAREHOUSE_OPTIONS = ["Main Warehouse", "Shop Floor", "Returns Area"];
const LOCATION_OPTIONS = ["A-01-01", "A-01-02", "B-01-01", "RET-01", "SHOWROOM-01"];

const OPERATIONS: Array<{ value: Operation; label: string; icon: typeof ArrowDownToLine }> = [
  { value: "inbound", label: "Receive stock", icon: ArrowDownToLine },
  { value: "outbound", label: "Remove stock", icon: ArrowUpFromLine },
  { value: "stocktake", label: "Stock count", icon: PackageCheck },
  { value: "return", label: "Return", icon: RefreshCw },
  { value: "adjustment", label: "Correction", icon: AlertTriangle },
  { value: "transfer", label: "Transfer location", icon: Warehouse },
];

const REASONS: Array<{ value: InventoryReasonCategory; label: string }> = [
  { value: "purchase_inbound", label: "Purchase inbound" },
  { value: "supplier_arrival", label: "Supplier arrival" },
  { value: "customer_return", label: "Customer return" },
  { value: "sales_outbound", label: "Sales outbound" },
  { value: "supplier_return", label: "Supplier return" },
  { value: "stocktake_correction", label: "Stocktake correction" },
  { value: "damaged_or_lost", label: "Damaged or lost" },
  { value: "sample_or_internal", label: "Sample or internal use" },
  { value: "warehouse_transfer", label: "Warehouse transfer" },
  { value: "custom", label: "Custom reason" },
];

const DEFAULT_REASON_BY_OPERATION: Record<Operation, InventoryReasonCategory> = {
  inbound: "purchase_inbound",
  outbound: "sales_outbound",
  stocktake: "stocktake_correction",
  return: "customer_return",
  adjustment: "custom",
  transfer: "warehouse_transfer",
};

function retailPrice(product: Product) {
  return product.b2cPrice ?? product.price * (1 + (product.b2cMarkup ?? 0));
}

function productSearchText(product: Product, warehouse: string, location: string) {
  return [
    product.sku,
    product.barcode,
    product.otherSku,
    product.name,
    product.category,
    product.fineCategory,
    product.color,
    product.size,
    warehouse,
    location,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function movementLabel(type: InventoryMovementType) {
  const labels: Record<InventoryMovementType, string> = {
    sale: "Sale",
    return: "Return",
    cancel_restore: "Cancel restore",
    adjustment: "Correction",
    initial_import: "Initial import",
    inbound: "Receive stock",
    outbound: "Remove stock",
    stocktake: "Stock count",
    transfer: "Transfer location",
  };
  return labels[type];
}

function reasonLabel(reason?: InventoryReasonCategory) {
  if (!reason) return "";
  return REASONS.find((item) => item.value === reason)?.label ?? reason;
}

export function InventoryView() {
  const [products] = useProducts();
  const [movements] = useInventoryMovements();
  const [locations] = useInventoryLocations();
  const [query, setQuery] = useState("");
  const [movementQuery, setMovementQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation>("stocktake");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<InventoryReasonCategory>("stocktake_correction");
  const [warehouse, setWarehouse] = useState("Main Warehouse");
  const [location, setLocation] = useState("A-01-01");
  const [note, setNote] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  const locationByProduct = useMemo(
    () => new Map(locations.map((item) => [item.productId, item])),
    [locations],
  );

  const summary = useMemo(() => {
    const totalUnits = products.reduce((sum, product) => sum + product.stock, 0);
    const costValue = products.reduce(
      (sum, product) => sum + (product.cost ?? 0) * product.stock,
      0,
    );
    const retailValue = products.reduce(
      (sum, product) => sum + retailPrice(product) * product.stock,
      0,
    );
    const lowStock = products.filter(
      (product) => product.stock > 0 && product.stock <= product.lowStockThreshold,
    ).length;
    const outOfStock = products.filter((product) => product.stock === 0).length;
    return { totalUnits, costValue, retailValue, lowStock, outOfStock };
  }, [products]);

  const filteredProducts = useMemo(() => {
    const text = query.trim().toLowerCase();
    return products
      .filter((product) => {
        if (filter === "low") return product.stock > 0 && product.stock <= product.lowStockThreshold;
        if (filter === "out") return product.stock === 0;
        if (filter === "available") return product.stock > 0;
        return true;
      })
      .filter((product) => {
        if (!text) return true;
        const loc = locationByProduct.get(product.id);
        return productSearchText(product, loc?.warehouse ?? "", loc?.location ?? "").includes(text);
      });
  }, [filter, locationByProduct, products, query]);

  const selected = useMemo(() => {
    if (!filteredProducts.length) return undefined;
    return filteredProducts.find((product) => product.id === selectedId) ?? filteredProducts[0];
  }, [filteredProducts, selectedId]);

  useEffect(() => {
    if (!selected) return;
    const savedLocation = locationByProduct.get(selected.id);
    setSelectedId(selected.id);
    setWarehouse(savedLocation?.warehouse ?? "Main Warehouse");
    setLocation(savedLocation?.location ?? "A-01-01");
    setQuantity(String(selected.stock));
    setNote("");
  }, [locationByProduct, selected]);

  useEffect(() => {
    setReason(DEFAULT_REASON_BY_OPERATION[operation]);
    if (selected) {
      setQuantity(operation === "stocktake" || operation === "adjustment" ? String(selected.stock) : "1");
    }
  }, [operation, selected]);

  const visibleMovements = useMemo(() => {
    const text = movementQuery.trim().toLowerCase();
    const productById = new Map(products.map((product) => [product.id, product]));
    return movements.filter((movement) => {
      if (!text) return true;
      const product = productById.get(movement.productId);
      return [
        movement.sku,
        movementLabel(movement.movementType),
        reasonLabel(movement.reason),
        movement.warehouse,
        movement.location,
        movement.notes,
        product?.name,
        product?.barcode,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(text);
    });
  }, [movementQuery, movements, products]);

  const projected = selected ? calculateStock(selected.stock, operation, quantity) : null;

  async function applyInventoryUpdate() {
    if (!selected || isUpdating) return;
    const result = calculateStock(selected.stock, operation, quantity);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }

    const movementId = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const trimmedWarehouse = warehouse.trim() || "Main Warehouse";
    const trimmedLocation = location.trim() || "A-01-01";
    let previousQty = selected.stock;
    let quantityChange = result.delta;
    let nextQty = result.nextQty;
    let remoteCreatedAt: number | undefined;

    setIsUpdating(true);
    try {
      const remote = await adjustProductInventoryInCloud({
        id: movementId,
        product: selected,
        movementType: operation,
        previousQty: selected.stock,
        quantityChange: result.delta,
        newQty: result.nextQty,
        reason,
        warehouse: trimmedWarehouse,
        location: trimmedLocation,
        notes: note.trim() || undefined,
        actor: "desktop",
      });
      if (remote?.ok) {
        previousQty = remote.previousQty ?? previousQty;
        quantityChange = remote.quantityChange ?? quantityChange;
        nextQty = remote.newQty ?? nextQty;
        remoteCreatedAt = remote.movement?.createdAt;
      }
    } catch (error) {
      console.warn("Cloud inventory transaction failed; keeping local fallback.", error);
      toast.warning("Cloud inventory transaction failed. Saved locally and queued for sync.");
    } finally {
      setIsUpdating(false);
    }

    const nextProduct = { ...selected, stock: nextQty };
    productsStore.upsert(nextProduct);
    inventoryLocationStore.set(selected.id, trimmedWarehouse, trimmedLocation);
    inventoryStore.log({
      id: movementId,
      productId: selected.id,
      sku: productInventorySku(selected),
      movementType: operation,
      previousQty,
      quantityChange,
      newQty: nextQty,
      reason,
      warehouse: trimmedWarehouse,
      location: trimmedLocation,
      notes: note.trim() || undefined,
      createdAt: remoteCreatedAt,
    });

    toast.success("Inventory updated");
    setNote("");
    setQuantity(operation === "stocktake" || operation === "adjustment" ? String(nextQty) : "1");
  }

  return (
    <>
      <SectionHeader
        eyebrow="Products / Stock"
        title="Inventory"
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Metric title="Stock units" value={String(summary.totalUnits)} accent="bg-bauhaus-blue" icon={<Boxes />} />
        <Metric title="Inventory cost value" value={fmtMoney(summary.costValue)} accent="bg-bauhaus-yellow" icon={<PackageCheck />} />
        <Metric title="Retail value" value={fmtMoney(summary.retailValue)} accent="bg-bauhaus-blue" icon={<Warehouse />} />
        <Metric
          title="Low / out of stock"
          value={`${summary.lowStock} / ${summary.outOfStock}`}
          accent="bg-bauhaus-red"
          icon={<AlertTriangle />}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-0">
        {([
          ["all", "All products", products.length],
          ["available", "In stock", products.filter((product) => product.stock > 0).length],
          ["low", "Low stock", summary.lowStock],
          ["out", "Out of stock", summary.outOfStock],
        ] as const).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`border-2 border-foreground px-4 py-2 text-sm ${
              filter === key ? "bg-foreground text-primary-foreground" : "bg-background hover:bg-secondary"
            }`}
          >
            {label} - {count}
          </button>
        ))}
      </div>

      <section className="mb-8 border-2 border-foreground">
        <div className="flex items-center justify-between bg-foreground px-4 py-3 text-primary-foreground">
          <h2 className="font-display text-sm uppercase tracking-[0.2em]">Inventory management</h2>
          <span className="text-[10px] uppercase tracking-[0.2em] text-primary-foreground/70">
            Query and update
          </span>
        </div>
        <div className="grid items-stretch gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="flex flex-col lg:h-[720px]">
            <div className="mb-4 flex items-center gap-3 border-2 border-foreground bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by model, SKU, name, colour, size, warehouse location..."
                className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>

            {filteredProducts.length === 0 ? (
              <div className="flex flex-1">
                <EmptyState title="No inventory results" description="Try another SKU, colour, size or location." />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto border-2 border-foreground">
                <table className="w-full table-fixed text-sm">
                  <thead className="sticky top-0 bg-foreground text-primary-foreground">
                    <tr className="text-left">
                      <th className="w-[120px] px-3 py-3 text-[11px] uppercase tracking-[0.16em]">SKU</th>
                      <th className="px-3 py-3 text-[11px] uppercase tracking-[0.16em]">Product</th>
                      <th className="w-[120px] px-3 py-3 text-[11px] uppercase tracking-[0.16em]">Colour</th>
                      <th className="w-[80px] px-3 py-3 text-[11px] uppercase tracking-[0.16em]">Size</th>
                      <th className="w-[90px] px-3 py-3 text-right text-[11px] uppercase tracking-[0.16em]">Stock</th>
                      <th className="w-[140px] px-3 py-3 text-[11px] uppercase tracking-[0.16em]">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((product) => {
                      const loc = locationByProduct.get(product.id);
                      const active = product.id === selected?.id;
                      return (
                        <tr
                          key={product.id}
                          onClick={() => setSelectedId(product.id)}
                          className={`cursor-pointer border-t border-foreground/10 ${
                            active ? "bg-secondary" : "hover:bg-secondary/50"
                          }`}
                        >
                          <td className="px-3 py-3 font-mono-tabular text-xs">{product.sku}</td>
                          <td className="px-3 py-3">
                            <div className="font-medium">{product.name}</div>
                            <div className="text-xs text-muted-foreground">{product.barcode}</div>
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">{product.color || "-"}</td>
                          <td className="px-3 py-3 text-muted-foreground">{product.size || "-"}</td>
                          <td className="px-3 py-3 text-right font-mono-tabular">
                            <span className={product.stock <= product.lowStockThreshold ? "text-bauhaus-red" : ""}>
                              {product.stock}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">
                            {loc?.location ?? "A-01-01"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex h-full flex-col overflow-y-auto border-2 border-foreground p-4 lg:h-[720px]">
            {selected ? (
              <>
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Selected SKU</Label>
                    <div className="mt-1 font-mono-tabular text-sm">{selected.sku}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{selected.name}</div>
                  </div>
                  <div className="text-right">
                    <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Current</Label>
                    <div className="font-display text-3xl">{selected.stock}</div>
                  </div>
                </div>

                <div className="grid gap-4">
                  <Field label="Warehouse">
                    <div className="relative">
                      <Warehouse className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <select
                        value={warehouse}
                        onChange={(event) => setWarehouse(event.target.value)}
                        className="h-10 w-full border-2 border-foreground bg-background pl-9 pr-3 text-sm outline-none"
                      >
                        {WAREHOUSE_OPTIONS.map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    </div>
                  </Field>

                  <Field label="Warehouse location">
                    <div className="relative">
                      <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={location}
                        onChange={(event) => setLocation(event.target.value)}
                        list="inventory-location-options"
                        className="pl-9"
                      />
                    </div>
                    <datalist id="inventory-location-options">
                      {LOCATION_OPTIONS.map((item) => (
                        <option key={item} value={item} />
                      ))}
                    </datalist>
                  </Field>

                  <Field label="Operation type">
                    <select
                      value={operation}
                      onChange={(event) => setOperation(event.target.value as Operation)}
                      className="h-10 w-full border-2 border-foreground bg-background px-3 text-sm outline-none"
                    >
                      {OPERATIONS.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label={operation === "stocktake" || operation === "adjustment" ? "New stock quantity" : operation === "transfer" ? "Transfer quantity" : "Quantity"}>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                    />
                  </Field>

                  <Field label="Reason category">
                    <select
                      value={reason}
                      onChange={(event) => setReason(event.target.value as InventoryReasonCategory)}
                      className="h-10 w-full border-2 border-foreground bg-background px-3 text-sm outline-none"
                    >
                      {REASONS.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Note">
                    <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
                  </Field>

                  <div className="grid grid-cols-3 border-2 border-foreground text-center text-sm">
                    <div className="border-r-2 border-foreground p-2">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Before</div>
                      <div className="font-display text-xl">{selected.stock}</div>
                    </div>
                    <div className="border-r-2 border-foreground p-2">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Change</div>
                      <div className="font-display text-xl">{projected?.ok ? projected.delta : "-"}</div>
                    </div>
                    <div className="p-2">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">After</div>
                      <div className="font-display text-xl">{projected?.ok ? projected.nextQty : "-"}</div>
                    </div>
                  </div>

                  <Button onClick={applyInventoryUpdate} className="w-full" disabled={isUpdating}>
                    {isUpdating ? "Updating..." : "Update inventory"}
                  </Button>
                </div>
              </>
            ) : (
              <EmptyState title="No SKU selected" description="Select a SKU from the table." />
            )}
          </div>
        </div>
      </section>

      <section className="border-2 border-foreground">
        <div className="flex flex-col gap-3 bg-foreground px-4 py-3 text-primary-foreground md:flex-row md:items-center md:justify-between">
          <h2 className="font-display text-sm uppercase tracking-[0.2em]">Inventory movements</h2>
          <div className="flex w-full max-w-sm items-center gap-2">
            <Input
              value={movementQuery}
              onChange={(event) => setMovementQuery(event.target.value)}
              placeholder="Search by order, SKU, reason..."
              className="h-9 border-primary-foreground/50 bg-foreground text-primary-foreground placeholder:text-primary-foreground/60"
            />
            <Button variant="secondary" size="sm">
              <Search /> Search
            </Button>
          </div>
        </div>
        {visibleMovements.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No inventory movements" description="Stock changes will appear here." />
          </div>
        ) : (
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-secondary">
                <tr className="border-b-2 border-foreground text-left">
                  <th className="px-3 py-3 text-[11px] uppercase tracking-[0.16em]">Time</th>
                  <th className="px-3 py-3 text-[11px] uppercase tracking-[0.16em]">SKU</th>
                  <th className="px-3 py-3 text-[11px] uppercase tracking-[0.16em]">Operation</th>
                  <th className="px-3 py-3 text-right text-[11px] uppercase tracking-[0.16em]">Before</th>
                  <th className="px-3 py-3 text-right text-[11px] uppercase tracking-[0.16em]">Change</th>
                  <th className="px-3 py-3 text-right text-[11px] uppercase tracking-[0.16em]">After</th>
                  <th className="px-3 py-3 text-[11px] uppercase tracking-[0.16em]">Location</th>
                  <th className="px-3 py-3 text-[11px] uppercase tracking-[0.16em]">Reason</th>
                  <th className="px-3 py-3 text-[11px] uppercase tracking-[0.16em]">Note</th>
                </tr>
              </thead>
              <tbody>
                {visibleMovements.map((movement) => (
                  <tr key={movement.id} className="border-b border-foreground/10">
                    <td className="px-3 py-3 text-xs text-muted-foreground">{fmtDate(movement.createdAt)}</td>
                    <td className="px-3 py-3 font-mono-tabular text-xs">{movement.sku ?? "-"}</td>
                    <td className="px-3 py-3">{movementLabel(movement.movementType)}</td>
                    <td className="px-3 py-3 text-right font-mono-tabular">{movement.previousQty ?? "-"}</td>
                    <td className={`px-3 py-3 text-right font-mono-tabular ${movement.quantityChange < 0 ? "text-bauhaus-red" : "text-green-700"}`}>
                      {movement.quantityChange > 0 ? "+" : ""}{movement.quantityChange}
                    </td>
                    <td className="px-3 py-3 text-right font-mono-tabular">{movement.newQty ?? "-"}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {[movement.warehouse, movement.location].filter(Boolean).join(" / ") || "-"}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{reasonLabel(movement.reason) || "-"}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{movement.notes || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function calculateStock(current: number, operation: Operation, rawQuantity: string) {
  const parsed = Number(rawQuantity);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false as const, message: "Enter a valid quantity" };
  }
  const qty = Math.floor(parsed);
  if (operation !== "stocktake" && operation !== "adjustment" && qty <= 0) {
    return { ok: false as const, message: "Quantity must be greater than 0" };
  }

  if (operation === "inbound" || operation === "return") {
    return { ok: true as const, delta: qty, nextQty: current + qty };
  }
  if (operation === "outbound") {
    if (qty > current) {
      return { ok: false as const, message: "Quantity cannot exceed current stock" };
    }
    return { ok: true as const, delta: -qty, nextQty: current - qty };
  }
  if (operation === "transfer") {
    return { ok: true as const, delta: 0, nextQty: current };
  }
  return { ok: true as const, delta: qty - current, nextQty: qty };
}

function Metric({
  title,
  value,
  accent,
  icon,
}: {
  title: string;
  value: string;
  accent: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="border-l border-foreground/15 px-4 py-4">
      <div className={`mb-4 h-1 w-10 ${accent}`} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-2 text-xs text-muted-foreground">{title}</div>
          <div className="font-display text-3xl">{value}</div>
        </div>
        <div className="text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{icon}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
