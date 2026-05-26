import { useMemo, useRef, useState } from "react";
import { Check, Plus, Search, Trash2, Upload, Download, Wrench } from "lucide-react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useProducts } from "@/hooks/useStore";
import { productsStore } from "@/lib/storage";
import type { Product } from "@/types";
import { SectionHeader } from "./SectionHeader";
import { EmptyState } from "./EmptyState";
import { fmtMoney } from "@/lib/format";
import { toast } from "sonner";
import { useSession } from "@/lib/auth";
import { approvalsStore, usePendingDeletes } from "@/lib/approvals";
import { ProductForm } from "./ProductForm";
import { getColours } from "@/lib/colourSettings";
import { getB2cUnitPrice, getDefaultB2cMarkupPercent } from "@/lib/productSettings";
import { normalizeProductCode } from "@/lib/productCodes";
import { ProductMaintenanceView } from "./ProductMaintenanceView";
import { useMaintenance } from "@/lib/maintenanceStore";

type ProductStatus = "complete" | "missing_picture" | "incomplete" | "temporary" | "pending_approval";
const SKU_SIZE_CODES = ["XXL", "XXS", "XL", "XS", "L", "M", "S", "U"] as const;

function getProductStatus(p: Product): ProductStatus {
  if (p.maintenanceStatus === "pending_approval") return "pending_approval";
  if (p.temporaryProduct || p.maintenanceStatus === "open") return "temporary";
  const required: Array<unknown> = [
    p.barcode, p.name, p.sku, p.category, p.fineCategory, p.description,
    p.size, p.color, p.price, p.b2cMarkup,
    p.weight, p.lengthA, p.lengthB, p.lengthC, p.lengthD,
    p.lengthE, p.lengthF, p.lengthG, p.lengthH,
  ];
  const fieldsFilled = required.every((v) => {
    if (v === undefined || v === null) return false;
    if (typeof v === "string" && v.trim() === "") return false;
    return true;
  });
  const priceOk = typeof p.price === "number" && p.price > 0;
  const comp = p.composition ?? [];
  const compTotal = comp.reduce((s, c) => s + (c.percentage || 0), 0);
  const compOk = comp.length > 0 && Math.round(compTotal * 100) / 100 === 100;
  if (!fieldsFilled || !priceOk || !compOk) return "incomplete";
  const hasMain = !!p.mainImage && p.mainImage.trim() !== "";
  const hasVariation = !!p.image && p.image.trim() !== "";
  if (!hasMain || !hasVariation) return "missing_picture";
  return "complete";
}

const STATUS_META: Record<ProductStatus, { label: string; title: string; className: string }> = {
  complete: {
    label: "Completed",
    title: "All required fields filled and pictures uploaded",
    className: "border-green-700 bg-green-600 text-white",
  },
  missing_picture: {
    label: "Missing picture",
    title: "Required fields filled but main or variation picture is missing",
    className: "border-yellow-600 bg-yellow-400 text-black",
  },
  incomplete: {
    label: "Incomplete",
    title: "Some required fields are missing",
    className: "border-bauhaus-red bg-bauhaus-red text-primary-foreground",
  },
  temporary: {
    label: "Maintenance",
    title: "Temporary POS product pending product maintenance",
    className: "border-bauhaus-yellow bg-bauhaus-yellow text-foreground",
  },
  pending_approval: {
    label: "Pending approval",
    title: "Awaiting developer approval",
    className: "border-foreground bg-secondary text-foreground",
  },
};

const empty: Omit<Product, "id" | "createdAt"> = {
  barcode: "", name: "", sku: "", category: "", size: "", color: "",
  price: 0, cost: 0, b2cMarkup: 0, stock: 0, lowStockThreshold: 5, weight: "",
};

export function ProductsView() {
  const [products] = useProducts();
  const [q, setQ] = useState("");
  const [chooserOpen, setChooserOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [formMode, setFormMode] = useState<"single" | "custom">("single");
  const [maintenanceView, setMaintenanceView] = useState(false);
  const session = useSession();
  const pendingDeletes = usePendingDeletes();
  const maintenanceItems = useMaintenance();
  const openMaintenanceCount = maintenanceItems.filter((item) => !item.resolved).length;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return products;
    return products.filter((p) =>
      [p.name, p.barcode, p.sku, p.otherSku, p.category, p.color, p.size].filter(Boolean).join(" ").toLowerCase().includes(t),
    );
  }, [products, q]);

  function openNew() { setChooserOpen(true); }

  function downloadTemplate() {
    const defaultMarkup = getDefaultB2cMarkupPercent();
    const headers = [
      "AUTO_SKU", "OTHER_SKU", "MODEL_NUMBER", "NAME", "DESCRIPTION", "CATEGORY", "FINE_CATEGORY",
      "B2B_PRICE", "B2C_MARKUP_PERCENT", "B2C_PRICE_AUTO", "COMPOSITION", "TAGS",
      "MAIN_PICTURE", "SHEIN_ENABLED", "SHEIN_NAME", "SHEIN_PRICE", "SHEIN_DESCRIPTION",
      "MANUFACTURER_ORDER_ID", "COLOUR_NAME", "COLOUR_CODE", "SIZE", "QUANTITY",
      "PICTURE_PER_COLOUR", "WEIGHT_G",
      "LENGTH_A", "LENGTH_B", "LENGTH_C", "LENGTH_D",
      "LENGTH_E", "LENGTH_F", "LENGTH_G", "LENGTH_H",
    ];
    const sample = [{
      AUTO_SKU: "P001BS", OTHER_SKU: "SOURCE-12345", MODEL_NUMBER: "P001", NAME: "Long Coat Premium",
      DESCRIPTION: "Premium long coat", CATEGORY: "COAT", FINE_CATEGORY: "LONG_COAT",
      B2B_PRICE: 45.9, B2C_MARKUP_PERCENT: defaultMarkup, B2C_PRICE_AUTO: "=H2*(1+I2/100)",
      COMPOSITION: "80% POLYESTER, 20% WOOL", TAGS: "WINTER,PREMIUM",
      MAIN_PICTURE: "P001-main.jpeg", SHEIN_ENABLED: "TRUE", SHEIN_NAME: "Shein Long Coat",
      SHEIN_PRICE: 79.99, SHEIN_DESCRIPTION: "Shein listing description",
      MANUFACTURER_ORDER_ID: "ORDER-2026-001",
      COLOUR_NAME: "WHITE", COLOUR_CODE: "B", SIZE: "S", QUANTITY: 15,
      PICTURE_PER_COLOUR: "P001-B.jpeg", WEIGHT_G: 850,
      LENGTH_A: 120, LENGTH_B: 45, LENGTH_C: 30, LENGTH_D: 55,
      LENGTH_E: 22, LENGTH_F: 60, LENGTH_G: 18, LENGTH_H: 10,
    }];
    const ws = XLSX.utils.json_to_sheet(sample, { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    XLSX.writeFile(wb, "products-template.xlsx");
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      if (!rows.length) {
        toast.error("The file is empty");
        return;
      }
      let created = 0;
      let updated = 0;
      const skipReasons: string[] = [];
      const existing = productsStore.all();
      const colours = getColours();
      const colourByCode = new Map(colours.map((c) => [c.code.toUpperCase(), c.name]));
      const colourCodesByLength = [...colourByCode.keys()].sort((a, b) => b.length - a.length);
      const parseCompactSku = (sku: string) => {
        const normalized = normalizeProductCode(sku);
        for (const size of SKU_SIZE_CODES) {
          if (!normalized.endsWith(size)) continue;
          const withoutSize = normalized.slice(0, -size.length);
          for (const code of colourCodesByLength) {
            if (!withoutSize.endsWith(code)) continue;
            const model = withoutSize.slice(0, -code.length);
            if (model) return { model, colourCode: code, sizeCode: size };
          }
        }
        return null;
      };

      // Pre-pass: parse colour/size from SKU when missing, and combine
      // duplicate rows that share the same SKU (or same model+colour+size).
      type Parsed = Record<string, unknown> & { __rowNum: number };
      const findKey = (r: Record<string, unknown>, k: string) =>
        Object.keys(r).find((x) => x.toLowerCase().trim() === k.toLowerCase());
      const readRaw = (r: Record<string, unknown>, ...keys: string[]) => {
        for (const k of keys) {
          const rk = findKey(r, k);
          if (rk !== undefined) {
            const v = r[rk];
            if (v !== undefined && v !== null && String(v).trim() !== "") return v;
          }
        }
        return undefined;
      };
      const setVal = (r: Record<string, unknown>, k: string, v: unknown) => {
        const rk = findKey(r, k) ?? k;
        r[rk] = v;
      };

      const parsedRows: Parsed[] = [];
      const dedupe = new Map<string, number>();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as Parsed;
        row.__rowNum = i + 2;
        const barcodePreInitial = String(readRaw(row, "MODEL_NUMBER", "barcode") ?? "").trim();
        const skuPre = String(readRaw(row, "AUTO_SKU", "NEW_SKU", "VARIANT_SKU", "sku") ?? "").trim();
        if (skuPre) {
          const parts = skuPre.split("-").map((s) => s.trim()).filter(Boolean);
          if (parts.length >= 3) {
            const sizeFromSku = parts[parts.length - 1];
            const codeFromSku = parts[parts.length - 2];
            if (!readRaw(row, "SIZE", "size") && sizeFromSku) {
              setVal(row, "SIZE", sizeFromSku);
            }
            if (!readRaw(row, "COLOUR_NAME", "color") && codeFromSku) {
              const cname = colourByCode.get(codeFromSku.toUpperCase());
              setVal(row, "COLOUR_NAME", cname ?? codeFromSku.toUpperCase());
              if (!readRaw(row, "COLOUR_CODE")) setVal(row, "COLOUR_CODE", codeFromSku.toUpperCase());
            }
          }
          const compact = parseCompactSku(skuPre);
          if (compact) {
            if (!readRaw(row, "MODEL_NUMBER", "barcode")) setVal(row, "MODEL_NUMBER", compact.model);
            if (!readRaw(row, "SIZE", "size")) setVal(row, "SIZE", compact.sizeCode);
            if (!readRaw(row, "COLOUR_NAME", "color")) {
              setVal(row, "COLOUR_NAME", colourByCode.get(compact.colourCode) ?? compact.colourCode);
            }
            if (!readRaw(row, "COLOUR_CODE")) setVal(row, "COLOUR_CODE", compact.colourCode);
          }
        }
        const barcodePre = String(readRaw(row, "MODEL_NUMBER", "barcode") ?? barcodePreInitial).trim();
        if (!barcodePre) {
          skipReasons.push(`Row ${row.__rowNum}: missing MODEL_NUMBER`);
          continue;
        }
        const cKey = String(readRaw(row, "COLOUR_NAME", "color") ?? "").trim().toUpperCase();
        const sKey = String(readRaw(row, "SIZE", "size") ?? "").trim().toUpperCase();
        const dKey = skuPre
          ? `SKU:${skuPre.toUpperCase()}`
          : `M:${barcodePre.toUpperCase()}|C:${cKey}|S:${sKey}`;
        const existingIdx = dedupe.get(dKey);
        if (existingIdx !== undefined) {
          const target = parsedRows[existingIdx];
          const qa = Number(String(readRaw(target, "QUANTITY", "stock") ?? "0").replace(",", ".")) || 0;
          const qb = Number(String(readRaw(row, "QUANTITY", "stock") ?? "0").replace(",", ".")) || 0;
          setVal(target, "QUANTITY", qa + qb);
          for (const rk of Object.keys(row)) {
            if (rk === "__rowNum") continue;
            const cur = target[rk];
            const next = row[rk];
            const empty = cur === undefined || cur === null || String(cur).trim() === "";
            if (empty && next !== undefined && next !== null && String(next).trim() !== "") {
              target[rk] = next;
            }
          }
          continue;
        }
        dedupe.set(dKey, parsedRows.length);
        parsedRows.push(row);
      }

      for (let i = 0; i < parsedRows.length; i++) {
        const row = parsedRows[i];
        const rowNum = row.__rowNum;
        const get = (k: string) => {
          const key = Object.keys(row).find((x) => x.toLowerCase().trim() === k.toLowerCase());
          return key ? row[key] : undefined;
        };
        const pick = (...keys: string[]) => {
          for (const k of keys) {
            const v = get(k);
            if (v !== undefined && v !== null && String(v).trim() !== "") return v;
          }
          return undefined;
        };
        const name = String(pick("NAME", "name") ?? "").trim();
        const barcode = normalizeProductCode(String(pick("MODEL_NUMBER", "barcode") ?? ""));
        const sku = normalizeProductCode(String(pick("AUTO_SKU", "NEW_SKU", "VARIANT_SKU", "sku") ?? ""));
        const num = (v: unknown) => {
          const n = Number(String(v ?? "").replace(",", "."));
          return Number.isFinite(n) ? n : 0;
        };
        const rawMarkup = pick("B2C_MARKUP_PERCENT", "b2cMarkup");
        const defaultMarkup = getDefaultB2cMarkupPercent();
        const markupNum = rawMarkup === undefined ? defaultMarkup : num(rawMarkup);
        const b2cMarkup = rawMarkup === undefined || get("B2C_MARKUP_PERCENT") !== undefined
          ? markupNum / 100
          : markupNum;
        const compRaw = String(pick("COMPOSITION") ?? "").trim();
        const composition = compRaw
          ? compRaw.split(",").map((s) => {
              const m = s.trim().match(/^(\d+(?:[.,]\d+)?)\s*%?\s*(.*)$/);
              if (!m) return null;
              return { percentage: Number(m[1].replace(",", ".")) || 0, material: m[2].trim() };
            }).filter((x): x is { material: string; percentage: number } => !!x && !!x.material)
          : undefined;
        const lenStr = (k: string) => {
          const v = pick(k);
          return v === undefined || v === null || String(v).trim() === "" ? undefined : String(v).trim();
        };
        try {
          const payload: Omit<Product, "id" | "createdAt"> = {
          barcode,
          name,
          sku,
          otherSku: String(pick("OTHER_SKU", "OLD_SKU", "otherSku") ?? "").trim() || undefined,
          category: String(pick("CATEGORY", "category") ?? "").trim(),
          fineCategory: String(pick("FINE_CATEGORY") ?? "").trim() || undefined,
          size: String(pick("SIZE", "size") ?? "").trim(),
          color: String(pick("COLOUR_NAME", "color") ?? "").trim(),
          description: String(pick("DESCRIPTION", "description") ?? "").trim() || undefined,
          price: num(pick("B2B_PRICE", "price")),
          cost: num(pick("cost")),
          b2cMarkup,
          composition,
          stock: Math.max(0, Math.floor(num(pick("QUANTITY", "stock")))),
          lowStockThreshold: Math.max(0, Math.floor(num(pick("lowStockThreshold")) || 5)),
          weight: String(pick("WEIGHT_G", "weight") ?? "").trim() || undefined,
          lengthA: lenStr("LENGTH_A"),
          lengthB: lenStr("LENGTH_B"),
          lengthC: lenStr("LENGTH_C"),
          lengthD: lenStr("LENGTH_D"),
          lengthE: lenStr("LENGTH_E"),
          lengthF: lenStr("LENGTH_F"),
          lengthG: lenStr("LENGTH_G"),
          lengthH: lenStr("LENGTH_H"),
          };
          const match = sku
            ? existing.find((p) => p.sku && p.sku.trim() === sku)
            : existing.find((p) => p.barcode === barcode && !p.sku);
          if (match) {
            productsStore.upsert({ ...match, ...payload });
            updated++;
          } else {
            productsStore.upsert(payload);
            created++;
          }
        } catch (rowErr) {
          console.error("Import row error", rowNum, rowErr);
          skipReasons.push(`Row ${rowNum}: ${(rowErr as Error)?.message ?? "unknown error"}`);
        }
      }
      if (skipReasons.length) {
        const preview = skipReasons.slice(0, 5).join("\n");
        const more = skipReasons.length > 5 ? `\n…and ${skipReasons.length - 5} more` : "";
        toast.error(`Skipped ${skipReasons.length} row(s)`, { description: preview + more });
      }
      if (created || updated) {
        toast.success(`Import done: ${created} created, ${updated} updated`);
      } else if (!skipReasons.length) {
        toast.message("No rows imported");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to import file", { description: (err as Error)?.message });
    }
  }

  function startNew(kind: "variation" | "single" | "custom") {
    setChooserOpen(false);
    setEditing(null);
    setFormMode(kind === "custom" ? "custom" : "single");
    setFormOpen(true);
  }
  function openEdit(p: Product) { setEditing(p); setFormMode("single"); setFormOpen(true); }

  function approveTemporary(p: Product) {
    if (!session) return;
    if (session.role === "developer") {
      productsStore.upsert({
        ...p,
        temporaryProduct: false,
        maintenanceStatus: "approved",
        maintenanceApprovedAt: Date.now(),
        maintenanceApprovedBy: session.username,
      });
      toast.success("Temporary product approved");
      return;
    }
    if (pendingDeletes.temporaryProducts.has(p.id)) {
      toast.message("Approval request already pending");
      return;
    }
    approvalsStore.request(
      { type: "approve_temporary_product", productId: p.id, productName: p.name },
      session.username,
    );
    productsStore.upsert({ ...p, maintenanceStatus: "pending_approval" });
    toast.success("Approval request submitted");
  }

  function remove(p: Product) {
    if (!session) return;
    if (session.role === "developer") {
      if (!confirm(`Delete "${p.name}"?`)) return;
      productsStore.remove(p.id);
      toast.success("Product removed");
      return;
    }
    if (!confirm(`Request deletion of "${p.name}"? A developer must approve.`)) return;
    approvalsStore.request(
      { type: "delete_product", productId: p.id, productName: p.name },
      session.username,
    );
    toast.success("Approval request submitted");
  }

  if (formOpen) {
    return (
      <ProductForm
        onBack={(openProduct?: Product) => {
          setFormOpen(false);
          setEditing(null);
          if (openProduct) {
            setTimeout(() => openEdit(openProduct), 0);
          }
        }}
        initial={editing ?? undefined}
        mode={formMode}
      />
    );
  }

  if (maintenanceView) {
    return <ProductMaintenanceView onBack={() => setMaintenanceView(false)} />;
  }

  return (
    <>
      <SectionHeader
        title="Products"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setMaintenanceView(true)} title="Product maintenance">
              <Wrench /> Maintenance
              {openMaintenanceCount > 0 && (
                <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center bg-bauhaus-red px-1.5 text-[10px] font-semibold leading-none text-primary-foreground">
                  {openMaintenanceCount}
                </span>
              )}
            </Button>
            <Button variant="outline" onClick={downloadTemplate} title="Download Excel template">
              <Download /> Template
            </Button>
            <Button variant="outline" onClick={handleImportClick} title="Import products from Excel">
              <Upload /> Import Excel
            </Button>
            <Button onClick={openNew}><Plus /> New product</Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleImportFile}
            />
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-3 border-2 border-foreground bg-background px-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, model, SKU, other SKU..."
          className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No products yet" description="Add your first product to start selling." action={<Button onClick={openNew}><Plus /> New product</Button>} />
      ) : (
        <div className="border-2 border-foreground bg-background">
          <div className="max-h-[calc(100vh-300px)] min-h-[520px] overflow-auto">
          <table className="w-full min-w-[1440px] table-fixed text-sm">
            <thead className="sticky top-0 z-10 bg-foreground text-primary-foreground shadow-[0_1px_0_0_hsl(var(--foreground))]">
              <tr className="text-left">
                <th className="w-[140px] px-4 py-4 font-semibold uppercase tracking-wider text-[11px]">SKU</th>
                <th className="w-[170px] px-4 py-4 font-semibold uppercase tracking-wider text-[11px]">Other SKU</th>
                <th className="w-[130px] px-4 py-4 font-semibold uppercase tracking-wider text-[11px]">Status</th>
                <th className="w-[160px] px-4 py-4 font-semibold uppercase tracking-wider text-[11px]">Model</th>
                <th className="w-[230px] px-4 py-4 font-semibold uppercase tracking-wider text-[11px]">Name</th>
                <th className="w-[140px] px-4 py-4 font-semibold uppercase tracking-wider text-[11px]">Category</th>
                <th className="w-[120px] px-4 py-4 font-semibold uppercase tracking-wider text-[11px]">Colour</th>
                <th className="w-[90px] px-4 py-4 font-semibold uppercase tracking-wider text-[11px]">Size</th>
                <th className="w-[120px] px-4 py-4 text-right font-semibold uppercase tracking-wider text-[11px]">B2B price</th>
                <th className="w-[120px] px-4 py-4 text-right font-semibold uppercase tracking-wider text-[11px]">B2C price</th>
                <th className="w-[100px] px-4 py-4 text-right font-semibold uppercase tracking-wider text-[11px]">Quantity</th>
                <th className="w-[70px] px-4 py-4" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const isPending = pendingDeletes.products.has(p.id);
                const status = getProductStatus(p);
                const meta = STATUS_META[status];
                return (
                <tr
                  key={p.id}
                  onDoubleClick={() => !isPending && openEdit(p)}
                  className={`h-[66px] border-t border-foreground/10 hover:bg-secondary cursor-pointer select-none ${isPending ? "opacity-50 bg-muted/30 pointer-events-none" : ""}`}
                >
                  <td className="truncate px-4 py-3 font-mono-tabular text-xs">{p.sku || "—"}</td>
                  <td className="truncate px-4 py-3 font-mono-tabular text-xs text-muted-foreground">{p.otherSku || "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] border whitespace-nowrap ${meta.className}`}
                      title={meta.title}
                    >
                      {meta.label}
                    </span>
                  </td>
                  <td className="truncate px-4 py-3 font-mono-tabular text-xs">{p.barcode}</td>
                  <td className="truncate px-4 py-3 font-medium" title={p.name}>{p.name}</td>
                  <td className="px-4 py-3">{p.category}</td>
                  <td className="truncate px-4 py-3 text-muted-foreground">{p.color || "—"}</td>
                  <td className="truncate px-4 py-3 text-muted-foreground">{p.size || "—"}</td>
                  <td className="px-4 py-3 text-right font-mono-tabular whitespace-nowrap">{fmtMoney(p.price)}</td>
                  <td className="px-4 py-3 text-right font-mono-tabular whitespace-nowrap">
                    {fmtMoney(getB2cUnitPrice(p.price, p.b2cMarkup, p.b2cPrice))}
                  </td>
                  <td className="px-4 py-3 text-right font-mono-tabular">
                    <span className={p.stock <= p.lowStockThreshold ? "inline-flex items-center gap-1 text-bauhaus-red" : ""}>
                      {p.stock <= p.lowStockThreshold && <span className="h-2 w-2 bg-bauhaus-red" />}
                      {p.stock}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1 pointer-events-auto">
                      {(p.temporaryProduct || p.maintenanceStatus === "open") && !pendingDeletes.temporaryProducts.has(p.id) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); approveTemporary(p); }}
                          title={session?.role === "developer" ? "Approve temporary product" : "Request developer approval"}
                        >
                          <Check />
                        </Button>
                      )}
                      {isPending || pendingDeletes.temporaryProducts.has(p.id) || p.maintenanceStatus === "pending_approval" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled
                          title="Awaiting developer approval"
                          className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground"
                        >
                          Pending
                        </Button>
                      ) : (
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); remove(p); }} title="Delete">
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
        </div>
      )}

      <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
        <DialogContent className="max-w-2xl rounded-none border-2 border-foreground">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">New product</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            {([
              { kind: "single", label: "New" },
              { kind: "custom", label: "Custom" },
            ] as const).map((opt) => (
              <button
                key={opt.kind}
                onClick={() => startNew(opt.kind)}
                className="flex h-32 items-center justify-center border-2 border-foreground bg-background px-4 py-6 text-center transition-colors hover:bg-foreground hover:text-primary-foreground"
              >
                <span className="font-display text-lg">{opt.label}</span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChooserOpen(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <Label className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
