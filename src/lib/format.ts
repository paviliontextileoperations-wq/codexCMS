export const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(n);

export const fmtDate = (ts: number) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(ts);

export const fmtDateOnly = (ts: number) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(ts);