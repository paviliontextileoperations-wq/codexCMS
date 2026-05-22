import type { BusinessType, ClientType, Customer } from "@/types";

export const TAX_KEYS = {
  b2b: "app.tax.b2bDefault",
  b2c: "app.tax.b2cDefault",
} as const;

/** Defaults if nothing has been saved yet. */
export const DEFAULT_TAX = { b2b: 21, b2c: 21 } as const;

/**
 * Per-business-type default tax rates (percentages).
 * `surcharge` is the Spanish "recargo de equivalencia" added on top of VAT,
 * which currently only applies to ESP AUTONOMO.
 */
export const BUSINESS_TYPE_TAX: Record<BusinessType, { vat: number; surcharge: number }> = {
  "ESP AUTONOMO": { vat: 21, surcharge: 5.2 },
  "ESP EMPRESA": { vat: 21, surcharge: 0 },
  "EU VAT": { vat: 0, surcharge: 0 },
  "EU LOCAL": { vat: 21, surcharge: 0 },
  "INTERNATIONAL": { vat: 0, surcharge: 0 },
};

function readNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Reads the saved default tax rates (as percentages, 0-100). */
export function getDefaultTaxRates(): { b2b: number; b2c: number } {
  return {
    b2b: readNumber(TAX_KEYS.b2b, DEFAULT_TAX.b2b),
    b2c: readNumber(TAX_KEYS.b2c, DEFAULT_TAX.b2c),
  };
}

/** Effective tax rate (as a decimal, e.g. 0.21) for a given customer + sale mode. */
export function getEffectiveTaxRate(
  customer: Pick<Customer, "taxRate" | "clientType" | "businessType"> | null | undefined,
  mode: ClientType,
): number {
  const defaults = getDefaultTaxRates();
  if (customer && typeof customer.taxRate === "number" && Number.isFinite(customer.taxRate)) {
    return customer.taxRate / 100;
  }
  if (mode === "B2B" && customer?.businessType) {
    const b = BUSINESS_TYPE_TAX[customer.businessType];
    return (b.vat + b.surcharge) / 100;
  }
  return (mode === "B2C" ? defaults.b2c : defaults.b2b) / 100;
}

/**
 * Returns a breakdown of the effective tax: base VAT and (optional) recargo surcharge.
 * Useful for displaying "21% VAT + 5.2% Recargo" in UI/receipts.
 */
export function getTaxBreakdown(
  customer: Pick<Customer, "taxRate" | "clientType" | "businessType"> | null | undefined,
  mode: ClientType,
): { vat: number; surcharge: number; total: number } {
  // Manual per-customer override wins, no surcharge inferred.
  if (customer && typeof customer.taxRate === "number" && Number.isFinite(customer.taxRate)) {
    const v = customer.taxRate / 100;
    return { vat: v, surcharge: 0, total: v };
  }
  if (mode === "B2B" && customer?.businessType) {
    const b = BUSINESS_TYPE_TAX[customer.businessType];
    return { vat: b.vat / 100, surcharge: b.surcharge / 100, total: (b.vat + b.surcharge) / 100 };
  }
  const defaults = getDefaultTaxRates();
  const v = (mode === "B2C" ? defaults.b2c : defaults.b2b) / 100;
  return { vat: v, surcharge: 0, total: v };
}