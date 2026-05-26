import { useEffect, useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronsUpDown } from "lucide-react";
import { getColours, subscribeColours, type Colour } from "@/lib/colourSettings";
import { productsStore } from "@/lib/storage";
import { toast } from "sonner";
import { useSession } from "@/lib/auth";
import type { Product } from "@/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { galleryStore, type GalleryImage } from "@/lib/imageGallery";
import { CATEGORY_NAMES, getFineCategories, getMeasurementLabels } from "@/lib/categoryMeasurements";
import { FINE_CATEGORY_WEIGHT_KG, FALLBACK_WEIGHT_KG } from "@/lib/productWeight";
import { findDuplicateProductCode, normalizeProductCode } from "@/lib/productCodes";
import { getDefaultB2cMarkupPercent } from "@/lib/productSettings";

const SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "U"] as const;

function getSizeOrder(sizeName: string) {
  const index = SIZES.findIndex((size) => size === sizeName);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

const MATERIALS = [
  "Cotton", "Linen", "Wool", "Silk", "Polyester", "Nylon", "Acrylic",
  "Viscose", "Rayon", "Cashmere", "Leather", "Elastane", "Spandex",
  "Modal", "Tencel", "Hemp", "Bamboo", "Polyamide",
] as const;

type CompositionEntry = { id: string; material: string; percentage: string };

function newComposition(): CompositionEntry {
  return { id: Math.random().toString(36).slice(2, 9), material: "", percentage: "" };
}

type Variation = {
  id: string;
  size: string;
  sizeCode: string;
  colour: string;
  colourCode: string;
  quantity: string;
  otherSku: string;
};

function blankVariation(over: Partial<Variation> = {}): Variation {
  return {
    id: Math.random().toString(36).slice(2, 9),
    size: "", sizeCode: "", colour: "", colourCode: "", quantity: "", otherSku: "",
    ...over,
  };
}

function buildSku(model: string, colourCode: string, sizeCode: string) {
  if (!model || !colourCode || !sizeCode) return "";
  return `${model}${colourCode}${sizeCode}`;
}

type ColourSel = { name: string; code: string };
type SizeSel = { name: string; code: string };

const MEASURE_KEYS = ["weight","lengthA","lengthB","lengthC","lengthD","lengthE","lengthF","lengthG","lengthH"] as const;
type MeasureKey = typeof MEASURE_KEYS[number];
type SizeMeasurements = Partial<Record<MeasureKey, string>>;

function nextModelNumber(): string {
  const existing = productsStore.all();
  let max = 0;
  for (const p of existing) {
    const m = (p.barcode || "").match(/^P(\d{3,})$/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `P${String(max + 1).padStart(3, "0")}`;
}

export function ProductForm({
  onBack,
  initial,
  mode = "single",
}: {
  onBack: (openProduct?: Product) => void;
  initial?: Product;
  mode?: "single" | "custom";
}) {
  const session = useSession();
  const role = String(session?.role ?? "").trim().toLowerCase();
  const isOperator = role === "operator";
  const isDeveloper = !isOperator;
  const requiresFullProduct = isOperator;
  const [colours, setColoursState] = useState<Colour[]>(() => getColours());
  const [submitted, setSubmitted] = useState(false);
  const [conflictProduct, setConflictProduct] = useState<Product | null>(null);
  const defaultB2cMarkupPercent = getDefaultB2cMarkupPercent();
  useEffect(() => {
    const update = () => setColoursState(getColours());
    const unsub = subscribeColours(update);
    return () => { unsub(); };
  }, []);

  // Panel 1 — General (required)
  const [model, setModel] = useState<string>(() =>
    normalizeProductCode(initial?.barcode || (mode === "custom" ? "" : nextModelNumber())),
  );
  const modelLocked = Boolean(initial?.barcode) || mode !== "custom";
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [fineCategory, setFineCategory] = useState(initial?.fineCategory ?? "");
  const [category2, setCategory2] = useState(initial?.category2 ?? "");
  const [category3, setCategory3] = useState(initial?.category3 ?? "");
  const [b2bPrice, setB2bPrice] = useState(initial ? String(initial.price ?? "") : "");
  const [b2cMarkup, setB2cMarkup] = useState(
    initial
      ? String(Math.round((initial.b2cMarkup ?? defaultB2cMarkupPercent / 100) * 100))
      : String(defaultB2cMarkupPercent),
  );
  // B2C price is derived from B2B price + markup %
  const b2cPriceNum = (() => {
    const base = parseFloat(b2bPrice);
    const pct = parseFloat(b2cMarkup);
    if (isNaN(base) || isNaN(pct)) return NaN;
    return Math.round(base * (1 + pct / 100) * 100) / 100;
  })();
  const b2cPrice = isNaN(b2cPriceNum) ? "" : String(b2cPriceNum);

  const [composition, setComposition] = useState<CompositionEntry[]>(() => {
    const init = initial?.composition;
    if (init && init.length) {
      return init.map((c) => ({
        id: Math.random().toString(36).slice(2, 9),
        material: c.material,
        percentage: String(c.percentage),
      }));
    }
    return [newComposition()];
  });
  const compositionTotal = composition.reduce(
    (sum, c) => sum + (parseFloat(c.percentage) || 0),
    0,
  );

  // Panel 2 — Variations (required) — load ALL products sharing this model
  const [variations, setVariations] = useState<Variation[]>(() => {
    if (!initial) return [];
    const cols = getColours();
    const siblings = productsStore.all().filter((p) => p.barcode === initial.barcode);
    const list = siblings.length ? siblings : [initial];
    return list.map((p) => blankVariation({
      id: p.id,
      size: p.size ?? "",
      sizeCode: p.size ?? "",
      colour: p.color ?? "",
      colourCode: cols.find((c) => c.name === p.color)?.code ?? "",
      quantity: String(p.stock ?? ""),
      otherSku: p.otherSku ?? "",
    }));
  });

  // Measurements keyed by size code (shared across all colours of that size)
  const [sizeMeasurements, setSizeMeasurements] = useState<Record<string, SizeMeasurements>>(() => {
    if (!initial) return {};
    const map: Record<string, SizeMeasurements> = {};
    productsStore.all().filter((p) => p.barcode === initial.barcode).forEach((p) => {
      const key = p.size ?? "";
      if (!key || map[key]) return;
      map[key] = {
        weight: p.weight ?? "",
        lengthA: p.lengthA ?? "",
        lengthB: p.lengthB ?? "",
        lengthC: p.lengthC ?? "",
        lengthD: p.lengthD ?? "",
        lengthE: p.lengthE ?? "",
        lengthF: p.lengthF ?? "",
        lengthG: p.lengthG ?? "",
        lengthH: p.lengthH ?? "",
      };
    });
    return map;
  });
  function updateSizeMeasurement(sizeCode: string, key: MeasureKey, value: string) {
    setSizeMeasurements((m) => ({ ...m, [sizeCode]: { ...(m[sizeCode] || {}), [key]: value } }));
  }

  // Selectors used to drive the Cartesian generation
  const [selColours, setSelColours] = useState<ColourSel[]>(() => {
    if (!initial) return [];
    const cols = getColours();
    const seen = new Set<string>();
    const out: ColourSel[] = [];
    productsStore.all().filter((p) => p.barcode === initial.barcode).forEach((p) => {
      const code = cols.find((c) => c.name === p.color)?.code ?? "";
      if (p.color && code && !seen.has(code)) {
        seen.add(code);
        out.push({ name: p.color, code });
      }
    });
    return out;
  });
  const [selSizes, setSelSizes] = useState<SizeSel[]>(() => {
    if (!initial) return [];
    const seen = new Set<string>();
    const out: SizeSel[] = [];
    productsStore.all().filter((p) => p.barcode === initial.barcode).forEach((p) => {
      if (p.size && !seen.has(p.size)) {
        seen.add(p.size);
        out.push({ name: p.size, code: p.size });
      }
    });
    return out;
  });
  const [pickColour, setPickColour] = useState("");
  const [pickSize, setPickSize] = useState("");
  const [colourPickerOpen, setColourPickerOpen] = useState(false);

  // Panel 3 — SHEIN
  const [sheinOn, setSheinOn] = useState(false);
  const [sheinName, setSheinName] = useState("");
  const [sheinDescription, setSheinDescription] = useState("");
  const [sheinPrice, setSheinPrice] = useState("");

  // Pictures
  const [mainImage, setMainImage] = useState<string>(() => {
    if (!initial) return "";
    const sibling = productsStore
      .all()
      .find((p) => p.barcode === initial.barcode && p.mainImage);
    return sibling?.mainImage ?? initial.mainImage ?? "";
  });
  const [variationImages, setVariationImages] = useState<Record<string, string>>(() => {
    if (!initial) return {};
    const map: Record<string, string> = {};
    productsStore
      .all()
      .filter((p) => p.barcode === initial.barcode)
      .forEach((p) => {
        if (p.image) map[p.id] = p.image;
      });
    return map;
  });
  // Per-colour images (multiple per colour), keyed by colour code.
  const [colourImages, setColourImages] = useState<Record<string, string[]>>(() => {
    if (!initial) return {};
    const cols = getColours();
    const map: Record<string, string[]> = {};
    productsStore.all().filter((p) => p.barcode === initial.barcode).forEach((p) => {
      const code = cols.find((c) => c.name === p.color)?.code ?? "";
      if (code && p.image) {
        if (!map[code]) map[code] = [];
        if (!map[code].includes(p.image)) map[code].push(p.image);
      }
    });
    return map;
  });

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  // Panel 4 — Manufacturer
  const [orderId, setOrderId] = useState("");

  // Tag (general sub-panel)
  const [tag, setTag] = useState("");

  function updateVariation(id: string, patch: Partial<Variation>) {
    setVariations((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }
  function removeVariation(id: string) {
    setVariations((vs) => vs.filter((v) => v.id !== id));
    setVariationImages((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
  }

  function addColour(name: string) {
    const found = colours.find((c) => c.name === name);
    if (!found) return;
    if (selColours.some((c) => c.code === found.code)) return;
    setSelColours((arr) => [...arr, { name: found.name, code: found.code }]);
    setPickColour("");
  }
  function removeColour(code: string) {
    setSelColours((arr) => arr.filter((c) => c.code !== code));
    setColourImages((m) => {
      const next = { ...m };
      delete next[code];
      return next;
    });
  }
  function addSize(name: string) {
    if (!name) return;
    if (selSizes.some((s) => s.name === name)) return;
    setSelSizes((arr) =>
      [...arr, { name, code: name }].sort(
        (a, b) => getSizeOrder(a.name) - getSizeOrder(b.name),
      ),
    );
    setPickSize("");
  }
  function removeSize(name: string) {
    setSelSizes((arr) => arr.filter((s) => s.name !== name));
  }
  function updateSizeCode(name: string, code: string) {
    setSelSizes((arr) => arr.map((s) => (s.name === name ? { ...s, code } : s)));
  }

  function createVariations() {
    if (selColours.length === 0 || selSizes.length === 0) {
      toast.error("Select at least one colour and one size");
      return;
    }
    // Preserve existing variations matching same (colourCode, sizeCode)
    const byKey = new Map<string, Variation>();
    variations.forEach((v) => byKey.set(`${v.colourCode}|${v.sizeCode}`, v));
    const next: Variation[] = [];
    for (const c of selColours) {
      for (const s of selSizes) {
        const key = `${c.code}|${s.code}`;
        const existing = byKey.get(key);
        if (existing) {
          next.push({ ...existing, colour: c.name, colourCode: c.code, size: s.name, sizeCode: s.code });
        } else {
          next.push(blankVariation({
            colour: c.name, colourCode: c.code,
            size: s.name, sizeCode: s.code,
          }));
        }
      }
    }
    setVariations(next);
    toast.success(`Generated ${next.length} variation${next.length === 1 ? "" : "s"}`);
  }

  function save() {
    setSubmitted(true);
    // General — all required
    const modelCode = normalizeProductCode(model);
    if (!modelCode) return toast.error("Model is required");
    // Uniqueness check: model code must not collide with an existing different product.
    {
      const exclude = new Set<string>();
      if (initial?.barcode) {
        productsStore
          .all()
          .filter((p) => p.barcode === initial.barcode)
          .forEach((p) => exclude.add(p.id));
      }
      const conflict = findDuplicateProductCode(modelCode, productsStore.all(), exclude);
      if (conflict) {
        setConflictProduct(conflict);
        return;
      }
    }
    if (!isOperator) {
      if (!category.trim()) return toast.error("Category is required");
      if (!fineCategory.trim()) return toast.error("Fine-Category is required");
      if (!b2bPrice.trim()) return toast.error("B2B Price is required");
    } else {
      if (!name.trim()) return toast.error("Name is required");
      if (!description.trim()) return toast.error("Description is required");
      if (!category.trim()) return toast.error("Category is required");
      if (!fineCategory.trim()) return toast.error("Fine-Category is required");
      if (!b2bPrice.trim()) return toast.error("B2B Price is required");
      if (!b2cMarkup.trim()) return toast.error("B2C Mark up is required");
      if (!b2cPrice) return toast.error("B2C Price is required");
      // Composition
      const filledComp = composition.filter((c) => c.material && c.percentage.trim());
      if (filledComp.length === 0) return toast.error("Composition is required");
      const partial = composition.find((c) => (!!c.material) !== (!!c.percentage.trim()));
      if (partial) return toast.error("Complete every composition row");
      const total = filledComp.reduce((s, c) => s + (parseFloat(c.percentage) || 0), 0);
      if (Math.round(total * 100) / 100 !== 100) {
        return toast.error(`Composition must add up to 100% (currently ${total}%)`);
      }
      if (variations.length === 0) return toast.error("At least one variation is required");
      for (let i = 0; i < variations.length; i++) {
        const v = variations[i];
        const missingBase = !v.size || !v.sizeCode || !v.colour || !v.colourCode || !v.quantity.trim();
        if (missingBase) return toast.error(`Complete every field on Variation #${i + 1}`);
      }
      // Weight is optional: empty falls back to the fine-category average.
    }
    const filledComposition = composition.filter((c) => c.material && c.percentage.trim());
    const price = parseFloat(b2bPrice) || 0;
    const markupPct = parseFloat(b2cMarkup) || 0;
    const compositionPayload = filledComposition.map((c) => ({
      material: c.material,
      percentage: parseFloat(c.percentage) || 0,
    }));
    try {
      // collect existing siblings to detect deletions on edit
      const existingIds = initial
        ? productsStore.all().filter((p) => p.barcode === modelCode).map((p) => p.id)
        : [];
      const keptIds = new Set<string>();
      const variationsToSave = variations.length > 0
        ? variations
        : [blankVariation()];
      variationsToSave.forEach((v) => {
        const existing = initial
          ? productsStore.all().find((p) => p.id === v.id)
          : undefined;
        // Fall back to deriving codes from the names so saving never fails just
        // because a colour was renamed/removed from the palette settings.
        const colourCode = (v.colourCode || v.colour.slice(0, 3).toUpperCase()).trim();
        const sizeCode = (v.sizeCode || v.size).trim();
        const meas = sizeMeasurements[sizeCode] || sizeMeasurements[v.sizeCode] || {};
        const saved = productsStore.upsert({
          ...(existing ? { id: existing.id } : {}),
          barcode: modelCode,
          name,
          description,
          sku: buildSku(modelCode, colourCode, sizeCode) || modelCode,
          category,
          fineCategory,
          category2: category2 || undefined,
          category3: category3 || undefined,
          size: v.size,
          color: v.colour,
          price,
          cost: 0,
          b2cMarkup: markupPct / 100,
          b2cPrice: isNaN(b2cPriceNum) ? undefined : b2cPriceNum,
          composition: compositionPayload,
          stock: parseInt(v.quantity) || 0,
          lowStockThreshold: 5,
          otherSku: normalizeProductCode(v.otherSku) || undefined,
          weight: meas.weight ?? "",
          lengthA: meas.lengthA ?? "",
          lengthB: meas.lengthB ?? "",
          lengthC: meas.lengthC ?? "",
          lengthD: meas.lengthD ?? "",
          lengthE: meas.lengthE ?? "",
          lengthF: meas.lengthF ?? "",
          lengthG: meas.lengthG ?? "",
          lengthH: meas.lengthH ?? "",
          mainImage: mainImage || undefined,
          image: (colourImages[v.colourCode]?.[0]) || (colourImages[colourCode]?.[0]) || variationImages[v.id] || undefined,
        });
        keptIds.add(saved.id);
      });
      // remove siblings the user deleted from the form
      existingIds.filter((id) => !keptIds.has(id)).forEach((id) => productsStore.remove(id));
      toast.success("Product saved");
      onBack();
    } catch (e) {
      console.error("Failed to save product", e);
      toast.error("Failed to save product", { description: (e as Error)?.message });
    }
  }

  const errCls = "border-destructive focus-visible:border-destructive focus-visible:ring-destructive";
  const showErr = (cond: boolean) => (submitted && cond ? errCls : "");
  const compositionInvalid =
    submitted &&
    requiresFullProduct &&
    (composition.length === 0 ||
      Math.round(compositionTotal * 100) / 100 !== 100);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => onBack()}
          className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="font-display text-3xl uppercase tracking-wide">{initial ? "Edit product" : "New product"}</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => onBack()}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </div>
      </div>

      {/* Panel 1 — General */}
      <Panel title="General" required>
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <Field
              label="Model (P number) *"
              full
              hint={modelLocked ? "Generated product model. Existing product model numbers are locked." : "Custom model. Input is saved in uppercase."}
              invalid={submitted && !model.trim()}
            >
              <Input
                className={showErr(!model.trim())}
                value={model}
                onChange={(e) => setModel(normalizeProductCode(e.target.value))}
                placeholder="P001"
                readOnly={modelLocked}
              />
            </Field>
            <Field label={`Name${requiresFullProduct ? " *" : ""}`} full invalid={requiresFullProduct && submitted && !name.trim()}>
              <Input className={showErr(requiresFullProduct && !name.trim())} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={`Description${requiresFullProduct ? " *" : ""}`} full invalid={requiresFullProduct && submitted && !description.trim()}>
              <Textarea className={showErr(requiresFullProduct && !description.trim())} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </Field>
            <Field label="Main Category *" full invalid={submitted && !category.trim()}>
              <Select
                value={category}
                onValueChange={(val) => {
                  setCategory(val);
                  // Reset fine category if it doesn't belong to the new category
                  if (!getFineCategories(val).some((f) => f.name === fineCategory)) {
                    setFineCategory("");
                  }
                }}
              >
                <SelectTrigger className={showErr(!category.trim())}>
                  <SelectValue placeholder="Select main category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_NAMES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fine-Category *" full invalid={submitted && !fineCategory.trim()}>
              <Select
                value={fineCategory}
                onValueChange={setFineCategory}
                disabled={!category}
              >
                <SelectTrigger className={showErr(!fineCategory.trim())}>
                  <SelectValue placeholder={category ? "Select fine-category" : "Select category first"} />
                </SelectTrigger>
                <SelectContent>
                  {getFineCategories(category).map((f) => (
                    <SelectItem key={f.name} value={f.name}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Category 2 (optional)" full>
              <Select value={category2 || "__none__"} onValueChange={(v) => setCategory2(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category 2" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {CATEGORY_NAMES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Category 3 (optional)" full>
              <Select value={category3 || "__none__"} onValueChange={(v) => setCategory3(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category 3" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {CATEGORY_NAMES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="B2B Price *" full invalid={submitted && !b2bPrice.trim()}>
              <Input className={showErr(!b2bPrice.trim())} type="number" step="0.01" value={b2bPrice} onChange={(e) => setB2bPrice(e.target.value)} />
            </Field>
            <Field label={`B2C Mark up (%)${requiresFullProduct ? " *" : ""}`} full invalid={requiresFullProduct && submitted && !b2cMarkup.trim()}>
              <Input className={showErr(requiresFullProduct && !b2cMarkup.trim())} type="number" step="1" value={b2cMarkup} onChange={(e) => setB2cMarkup(e.target.value)} />
            </Field>
            <Field label={`B2C Price${requiresFullProduct ? " *" : ""}`} full invalid={requiresFullProduct && submitted && !b2cPrice}>
              <Input
                className={showErr(requiresFullProduct && !b2cPrice)}
                type="number"
                step="0.01"
                value={b2cPrice}
                readOnly
                placeholder="auto"
              />
            </Field>
          </div>

          <div className="space-y-6">
            {/* Composition mini-panel */}
            <div className={"border-2 " + (compositionInvalid ? "border-destructive" : "border-foreground/30")}>
          <header className={"flex items-center justify-between border-b-2 bg-muted px-3 py-2 " + (compositionInvalid ? "border-destructive" : "border-foreground/30")}>
            <h4 className={"font-display text-xs uppercase tracking-[0.2em] " + (compositionInvalid ? "text-destructive" : "")}>Composition{requiresFullProduct ? " *" : ""}</h4>
            <span
              className={
                "text-[10px] uppercase tracking-[0.2em] " +
                (Math.round(compositionTotal * 100) / 100 === 100
                  ? "text-muted-foreground"
                  : "text-destructive")
              }
            >
              Total: {compositionTotal}% / 100%
            </span>
          </header>
          <div className="space-y-2 p-4">
            {composition.map((c, idx) => (
              <div key={c.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Select
                  value={c.material}
                  onValueChange={(val) =>
                    setComposition((cs) =>
                      cs.map((x) => (x.id === c.id ? { ...x, material: val } : x)),
                    )
                  }
                >
                  <SelectTrigger className={showErr(requiresFullProduct && !c.material)}><SelectValue placeholder="Material" /></SelectTrigger>
                  <SelectContent>
                    {MATERIALS.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className={showErr(requiresFullProduct && !c.percentage.trim())}
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="Percentage"
                  value={c.percentage}
                  onChange={(e) =>
                    setComposition((cs) =>
                      cs.map((x) => (x.id === c.id ? { ...x, percentage: e.target.value } : x)),
                    )
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    setComposition((cs) =>
                      cs.length > 1 ? cs.filter((x) => x.id !== c.id) : cs,
                    )
                  }
                  disabled={composition.length === 1}
                  className="inline-flex items-center justify-center px-2 text-muted-foreground hover:text-destructive disabled:opacity-30"
                  aria-label={`Remove composition row ${idx + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setComposition((cs) => [...cs, newComposition()])}
            >
              <Plus /> Add material
            </Button>
          </div>
            </div>

            {/* Tag mini-panel (disabled) */}
            <div className="border-2 border-foreground/30 opacity-50 pointer-events-none select-none" aria-disabled="true">
              <header className="flex items-center justify-between border-b-2 border-foreground/30 bg-muted px-3 py-2">
                <h4 className="font-display text-xs uppercase tracking-[0.2em]">Tag</h4>
                <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Coming soon</span>
              </header>
              <div className="p-4">
                <Input value={tag} disabled placeholder="Add a tag" />
              </div>
            </div>
          </div>
        </div>
      </Panel>

      {/* Panel 2 — Variations */}
      <Panel title="Variations" required={!isDeveloper}>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
          {/* Colour selector */}
          <div className="border-2 border-foreground/30">
            <header className="flex items-center justify-between border-b-2 border-foreground/30 bg-muted px-3 py-2">
              <h4 className="font-display text-xs uppercase tracking-[0.2em]">Colours</h4>
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {selColours.length} selected
              </span>
            </header>
            <div className="space-y-3 p-4">
              <Popover open={colourPickerOpen} onOpenChange={setColourPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-10 w-full items-center justify-between rounded-none border border-input bg-background px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                  >
                    Select a colour to add
                    <ChevronsUpDown className="h-4 w-4 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command
                    filter={(value, search) =>
                      value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
                    }
                  >
                    <CommandInput placeholder="Type colour name or code…" />
                    <CommandList>
                      <CommandEmpty>No colour found.</CommandEmpty>
                      <CommandGroup>
                        {colours
                          .filter((c) => !selColours.some((x) => x.code === c.code))
                          .map((c) => (
                            <CommandItem
                              key={c.code}
                              value={`${c.code} ${c.name}`}
                              onSelect={() => {
                                addColour(c.name);
                                setColourPickerOpen(false);
                              }}
                            >
                              {c.code} — {c.name}
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selColours.length > 0 && (
                <div className="space-y-3">
                  {selColours.map((c) => {
                    return (
                      <div key={c.code} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3 border border-foreground/20 p-3">
                        <Field label="Colour name">
                          <Input value={c.name} readOnly />
                        </Field>
                        <Field label="Colour code">
                          <Input value={c.code} readOnly />
                        </Field>
                        <button
                          type="button"
                          onClick={() => removeColour(c.code)}
                          className="inline-flex items-center justify-center px-2 pb-3 text-muted-foreground hover:text-destructive"
                          aria-label={`Remove colour ${c.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Size selector */}
          <div className="border-2 border-foreground/30">
            <header className="flex items-center justify-between border-b-2 border-foreground/30 bg-muted px-3 py-2">
              <h4 className="font-display text-xs uppercase tracking-[0.2em]">Sizes</h4>
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {selSizes.length} selected
              </span>
            </header>
            <div className="space-y-3 p-4">
              <Select value="" onValueChange={addSize}>
                <SelectTrigger><SelectValue placeholder="Select a size to add" /></SelectTrigger>
                <SelectContent>
                  {SIZES
                    .filter((s) => !selSizes.some((x) => x.name === s))
                    .map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {selSizes.length > 0 && (
                <div className="space-y-2">
                  {selSizes.map((s) => (
                     <div key={s.name} className="grid grid-cols-[1fr_auto] items-end gap-3 border border-foreground/20 p-3">
                       <Field label="Size">
                         <Input value={s.name} readOnly />
                       </Field>
                      <button
                        type="button"
                        onClick={() => removeSize(s.name)}
                        className="inline-flex items-center justify-center px-2 pb-3 text-muted-foreground hover:text-destructive"
                        aria-label={`Remove size ${s.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          </div>

          {/* Generate */}
          <div className="flex items-center justify-between gap-4">
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {selColours.length} × {selSizes.length} = {selColours.length * selSizes.length} SKU
              {selColours.length * selSizes.length === 1 ? "" : "s"} will be generated
            </p>
            <Button onClick={createVariations} disabled={selColours.length === 0 || selSizes.length === 0}>
              Create Variations
            </Button>
          </div>

          {/* Generated SKU rows */}
          {variations.length > 0 && (
            <div className="space-y-4">
              {variations.map((v, idx) => (
            <div key={v.id} className="border-2 border-foreground/30 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Variation #{idx + 1} — {v.colour} / {v.size}
                </span>
                <button
                    onClick={() => removeVariation(v.id)}
                    className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-bauhaus-red"
                  >
                    <Trash2 className="h-3 w-3" /> Remove
                  </button>
              </div>
              {(() => {
              return (
              <div className="grid gap-2 grid-cols-5">
                <Field label="SKU (auto)">
                  <Input value={buildSku(model, v.colourCode, v.sizeCode)} readOnly placeholder="auto" />
                </Field>
                <Field label="Other SKU">
                  <Input
                    value={v.otherSku}
                    onChange={(e) => updateVariation(v.id, { otherSku: e.target.value })}
                    placeholder="source product ID"
                  />
                </Field>
                <Field label="Size">
                  <Input value={v.size} readOnly />
                </Field>
                <Field label="Colour">
                  <Input value={v.colour} readOnly />
                </Field>
                <Field label="Quantity *" invalid={submitted && !v.quantity.trim()}>
                  <Input
                    className={showErr(!v.quantity.trim())}
                    type="number"
                    min="0"
                    step="1"
                    value={v.quantity}
                    onChange={(e) => updateVariation(v.id, { quantity: e.target.value })}
                  />
                </Field>
              </div>
              );
              })()}
            </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      {/* Panel — Pictures */}
      <Panel title="Pictures">
        <div className="space-y-6">
          <div>
            <Label className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Main picture
            </Label>
            <ImagePicker
              value={mainImage}
              onChange={setMainImage}
              onClear={() => setMainImage("")}
            />
          </div>
          {selColours.length > 0 ? (
            <div className="space-y-4">
              <Label className="block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Pictures per colour
              </Label>
              {selColours.map((c) => {
                const baseFilename = model && c.code ? `${model}-${c.code}` : "";
                const imgs = colourImages[c.code] || [];
                return (
                  <div key={c.code} className="border border-foreground/20 p-3 space-y-3">
                    <div className="flex items-baseline justify-between">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        {c.code} — {c.name}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {baseFilename ? `${baseFilename}.jpeg` : "set model first"}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-start gap-3">
                      {imgs.map((url, i) => (
                        <div key={i} className="space-y-1">
                          <ImagePicker
                            value={url}
                            onChange={(next) =>
                              setColourImages((m) => {
                                const arr = [...(m[c.code] || [])];
                                arr[i] = next;
                                return { ...m, [c.code]: arr };
                              })
                            }
                            onClear={() =>
                              setColourImages((m) => {
                                const arr = [...(m[c.code] || [])];
                                arr.splice(i, 1);
                                return { ...m, [c.code]: arr };
                              })
                            }
                          />
                          {baseFilename && (
                            <div className="text-[9px] text-muted-foreground">
                              {`${baseFilename}-${i + 1}.jpeg`}
                            </div>
                          )}
                        </div>
                      ))}
                      <ImagePicker
                        value=""
                        onChange={(url) =>
                          setColourImages((m) => ({
                            ...m,
                            [c.code]: [...(m[c.code] || []), url],
                          }))
                        }
                        onClear={() => {}}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Add colours in the Variations panel to upload per-colour images.
            </p>
          )}
        </div>
      </Panel>

      {/* Panel — Sizes (measurements per size) */}
      <Panel title="Sizes" required={!isDeveloper}>
        {selSizes.length === 0 ? (
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Add sizes in the Variations panel to enter measurements.
          </p>
        ) : (
          <div className="space-y-4">
            {selSizes.map((s) => {
              const meas = sizeMeasurements[s.code] || {};
              const dynLabels = getMeasurementLabels(category, fineCategory);
              const labels: Record<MeasureKey, string> = {
                weight: "Weight (g)",
                lengthA: dynLabels[0],
                lengthB: dynLabels[1],
                lengthC: dynLabels[2],
                lengthD: dynLabels[3],
                lengthE: dynLabels[4],
                lengthF: dynLabels[5],
                lengthG: dynLabels[6],
                lengthH: dynLabels[7],
              };
              const weightVal = meas.weight ?? "";
              const manualGrams = parseFloat(weightVal);
              const hasManualWeight = Number.isFinite(manualGrams) && manualGrams > 0;
              const fallbackKg =
                FINE_CATEGORY_WEIGHT_KG[fineCategory] ?? FALLBACK_WEIGHT_KG;
              return (
                <div key={s.code} className="border-2 border-foreground/30 p-4">
                  <div className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    <span>Size {s.name}</span>
                    <span>
                      {hasManualWeight ? (
                        <>
                          <span className="text-foreground">Manual</span> ·{" "}
                          {(manualGrams / 1000).toFixed(2)} kg
                        </>
                      ) : (
                        <>
                          <span className="text-accent">Estimated</span> ·{" "}
                          {fallbackKg.toFixed(2)} kg
                          {!FINE_CATEGORY_WEIGHT_KG[fineCategory] && " (fallback)"}
                        </>
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-9 gap-2 items-end">
                    {MEASURE_KEYS.map((k) => {
                      const val = meas[k] ?? "";
                      return (
                        <Field key={k} label={labels[k]}>
                          <Input
                            value={val}
                            onChange={(e) => updateSizeMeasurement(s.code, k, e.target.value)}
                          />
                        </Field>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Panel 3 — SHEIN */}
      <Panel title="SHEIN">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              SHEIN Toggle
            </Label>
            <Switch checked={sheinOn} onCheckedChange={setSheinOn} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="SHEIN Name">
              <Input value={sheinName} onChange={(e) => setSheinName(e.target.value)} disabled={!sheinOn} />
            </Field>
            <Field label="SHEIN Price">
              <Input type="number" step="0.01" value={sheinPrice} onChange={(e) => setSheinPrice(e.target.value)} disabled={!sheinOn} />
            </Field>
            <Field label="SHEIN Description" full>
              <Textarea value={sheinDescription} onChange={(e) => setSheinDescription(e.target.value)} rows={3} disabled={!sheinOn} />
            </Field>
          </div>
        </div>
      </Panel>

      {/* Panel 4 — Manufacturer */}
      <Panel title="Manufacturer">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Order ID">
            <Input value={orderId} onChange={(e) => setOrderId(e.target.value)} />
          </Field>
        </div>
      </Panel>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => onBack()}>Cancel</Button>
        <Button onClick={save}>Save</Button>
      </div>

      <Dialog open={!!conflictProduct} onOpenChange={(open) => !open && setConflictProduct(null)}>
        <DialogContent className="max-w-md rounded-none border-2 border-foreground">
          <DialogHeader>
            <DialogTitle>Product already exists</DialogTitle>
            <DialogDescription>
              {conflictProduct
                ? `Model or SKU "${model}" already exists as ${conflictProduct.sku || conflictProduct.barcode}.`
                : "This product already exists."}
            </DialogDescription>
          </DialogHeader>
          <div className="border-2 border-foreground/10 p-3 text-sm">
            <div className="font-medium">{conflictProduct?.name}</div>
            <div className="font-mono-tabular text-xs text-muted-foreground">
              {conflictProduct?.barcode} / {conflictProduct?.sku}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onBack()}>Go to Products</Button>
            <Button onClick={() => conflictProduct && onBack(conflictProduct)}>Open existing</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Panel({
  title,
  required,
  children,
}: {
  title: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="border-2 border-foreground bg-background">
      <header className="flex items-center justify-between border-b-2 border-foreground bg-foreground px-4 py-2 text-primary-foreground">
        <h3 className="font-display text-sm uppercase tracking-[0.2em]">{title}</h3>
        {required && (
          <span className="text-[10px] uppercase tracking-[0.2em] opacity-70">Required</span>
        )}
      </header>
      <div className="p-6">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
  full,
  invalid,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  full?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className={full ? "col-span-full" : ""}>
      <Label className={"mb-1.5 block text-[10px] uppercase tracking-[0.2em] " + (invalid ? "text-destructive" : "text-muted-foreground")}>
        {label}
      </Label>
      {children}
      {hint && <p className="mt-1 text-[10px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

function ImagePicker({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (url: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [gallery, setGallery] = useState<GalleryImage[]>(() => galleryStore.all());
  const [query, setQuery] = useState("");

  useEffect(() => {
    const sync = () => setGallery(galleryStore.all());
    const onForm = (e: Event) => {
      const ev = e as CustomEvent<{ key: string }>;
      if (ev.detail?.key === galleryStore.KEY) sync();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === galleryStore.KEY) sync();
    };
    window.addEventListener("form-storage", onForm as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("form-storage", onForm as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const q = query.trim().toUpperCase();
  const filtered = q
    ? gallery.filter(
        (g) => g.prefix.includes(q) || g.fileName.toUpperCase().includes(q),
      )
    : gallery;

  return (
    <div className="space-y-2">
      {value ? (
        <div className="relative inline-block">
          <img
            src={value}
            alt="preview"
            className="h-32 w-32 border-2 border-foreground/30 object-cover"
          />
          <button
            type="button"
            onClick={onClear}
            className="absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center border-2 border-foreground bg-background text-muted-foreground hover:text-destructive"
            aria-label="Remove image"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-32 w-32 cursor-pointer items-center justify-center border-2 border-dashed border-foreground/30 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-foreground hover:text-foreground"
        >
          + Select from gallery
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Select from gallery</DialogTitle>
            <DialogDescription>
              Pick an image previously uploaded in the Images section.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Search by prefix or filename"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {gallery.length === 0
                ? "Gallery is empty. Upload images in the Images section."
                : "No matches."}
            </p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-4 gap-3">
                {filtered.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      onChange(g.dataUrl);
                      setOpen(false);
                    }}
                    className="group space-y-1 text-left"
                  >
                    <img
                      src={g.dataUrl}
                      alt={g.fileName}
                      className="h-28 w-full border-2 border-foreground/20 object-cover group-hover:border-foreground"
                    />
                    <div className="truncate text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                      {g.fileName}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
