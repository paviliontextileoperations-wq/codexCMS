export const PRODUCT_SETTING_KEYS = {
  defaultB2cMarkup: "app.products.defaultB2cMarkupPercent",
} as const;

export const DEFAULT_B2C_MARKUP_PERCENT = 30;

export function getDefaultB2cMarkupPercent(): number {
  const raw = localStorage.getItem(PRODUCT_SETTING_KEYS.defaultB2cMarkup);
  const value = Number(String(raw ?? "").replace(",", "."));
  return Number.isFinite(value) && value >= 0 && value <= 1000
    ? value
    : DEFAULT_B2C_MARKUP_PERCENT;
}

export function setDefaultB2cMarkupPercent(value: number) {
  const next = Number.isFinite(value)
    ? Math.max(0, Math.min(1000, Math.round(value * 100) / 100))
    : DEFAULT_B2C_MARKUP_PERCENT;
  localStorage.setItem(PRODUCT_SETTING_KEYS.defaultB2cMarkup, String(next));
  window.dispatchEvent(new StorageEvent("storage", { key: PRODUCT_SETTING_KEYS.defaultB2cMarkup }));
}

export function getB2cUnitPrice(price: number, markup?: number, override?: number): number {
  if (typeof override === "number" && Number.isFinite(override)) return override;
  return price * (1 + (markup ?? getDefaultB2cMarkupPercent() / 100));
}
