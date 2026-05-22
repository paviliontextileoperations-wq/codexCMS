export const TRANSPORT_KEYS = {
  defaultFee: "app.transport.defaultFee",
} as const;

export const DEFAULT_TRANSPORT_FEE = 12;

export function getDefaultTransportFee(): number {
  if (typeof window === "undefined") return DEFAULT_TRANSPORT_FEE;
  const raw = localStorage.getItem(TRANSPORT_KEYS.defaultFee);
  if (raw == null) return DEFAULT_TRANSPORT_FEE;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TRANSPORT_FEE;
}