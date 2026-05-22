import type { Product } from "@/types";

/**
 * Default average weight (kg) per fine category, used when a product has no
 * manual weight entered. Source: agreed defaults from product team.
 */
export const FINE_CATEGORY_WEIGHT_KG: Record<string, number> = {
  "Long Coat": 1.5,
  "Short Coat": 1.0,
  "Trench Coat": 1.2,
  "Jacket": 0.85,
  "Blazer": 0.7,
  "T-Shirt": 0.2,
  "Short Sleeve Top": 0.18,
  "Long Sleeve Top": 0.28,
  "Shirt": 0.25,
  "Blouse": 0.2,
  "Mini Dress": 0.35,
  "Midi Dress": 0.5,
  "Long Dress": 0.7,
  "Short Skirt": 0.28,
  "Midi Skirt": 0.42,
  "Long Skirt": 0.6,
  "Long Pants": 0.55,
  "Short Pants": 0.35,
  "Jeans": 0.75,
  "Sweater": 0.6,
  "Cardigan": 0.7,
  "Knit Top": 0.35,
  "Knit Vest": 0.4,
  "Knit Dress": 0.8,
};

/** General fallback when fine category isn't mapped. */
export const FALLBACK_WEIGHT_KG = 0.5;

/** Packaging weight added per order. */
export const PACKAGING_WEIGHT_KG = 0.1;

export type WeightSource = "manual" | "estimated" | "fallback";

export type EffectiveWeight = {
  /** Effective weight in kilograms used for calculations. */
  kg: number;
  source: WeightSource;
  /** Fine category used for the estimate, when source !== "manual". */
  fineCategory?: string;
};

/**
 * Parse the manual weight stored on a product. Catalogue stores weight as a
 * string in GRAMS for legacy reasons; we convert to kilograms here.
 */
function parseManualWeightKg(p: Pick<Product, "weight">): number | null {
  const raw = (p.weight ?? "").trim();
  if (!raw) return null;
  const grams = parseFloat(raw);
  if (!Number.isFinite(grams) || grams <= 0) return null;
  return grams / 1000;
}

/**
 * Resolve the effective weight for a single product unit.
 * Rule: manual weight (>0) wins; otherwise fall back to fine-category average;
 * otherwise the general fallback.
 */
export function getEffectiveWeight(
  p: Pick<Product, "weight" | "fineCategory">,
): EffectiveWeight {
  const manual = parseManualWeightKg(p);
  if (manual !== null) return { kg: manual, source: "manual" };

  const fc = (p.fineCategory ?? "").trim();
  const estimate = fc ? FINE_CATEGORY_WEIGHT_KG[fc] : undefined;
  if (estimate && estimate > 0) {
    return { kg: estimate, source: "estimated", fineCategory: fc };
  }
  return { kg: FALLBACK_WEIGHT_KG, source: "fallback", fineCategory: fc || undefined };
}

/** Convenience: just the kg value. */
export function getEffectiveWeightKg(
  p: Pick<Product, "weight" | "fineCategory">,
): number {
  return getEffectiveWeight(p).kg;
}

export type CartLineLike = { productId: string; quantity: number };

export type CartWeightBreakdown = {
  /** Sum of effective weights × qty for every line, in kg. */
  productKg: number;
  /** Packaging weight applied (kg). */
  packagingKg: number;
  /** Total kg used for shipping calculations. */
  totalKg: number;
  /** True when every line resolved via a manual product weight. */
  allManual: boolean;
};

/**
 * Compute total order weight from cart lines + product catalogue.
 * Adds PACKAGING_WEIGHT_KG once per order when includePackaging is true (default).
 */
export function getCartWeightKg(
  lines: CartLineLike[],
  products: Pick<Product, "id" | "weight" | "fineCategory">[],
  opts: { includePackaging?: boolean } = {},
): CartWeightBreakdown {
  const includePackaging = opts.includePackaging ?? true;
  let productKg = 0;
  let allManual = lines.length > 0;
  for (const l of lines) {
    const p = products.find((x) => x.id === l.productId);
    if (!p) {
      allManual = false;
      productKg += FALLBACK_WEIGHT_KG * (l.quantity || 0);
      continue;
    }
    const eff = getEffectiveWeight(p);
    if (eff.source !== "manual") allManual = false;
    productKg += eff.kg * (l.quantity || 0);
  }
  const packagingKg = includePackaging && lines.length > 0 ? PACKAGING_WEIGHT_KG : 0;
  return {
    productKg,
    packagingKg,
    totalKg: productKg + packagingKg,
    allManual,
  };
}
