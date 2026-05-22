## Goal

Replace the flat €12 transport fee with the actual SEUR rate sheets you uploaded (national S‑1 24h tariff + international NETEXPRESS / CLASSIC TERRESTRE), and expose a calculator in **Settings › Transport** so anyone can quote a shipment from your Fuenlabrada warehouse.

## What gets built

### 1. New data module: `src/lib/transportRates.ts`

Encodes three rate tables straight from the PDFs, plus helpers:

- **National S‑1 (24h)** — kg brackets × 4 destination types: `PROVINCIAL`, `CORTO_PENINSULAR`, `LARGO_PEN_PORTUGAL`, `LARGO_BALEARES`. Includes the "from 50 kg" per‑kg overflow rate.
- **International NETEXPRESS** — by zone (1–6), kg brackets, with "from 400 kg" overflow.
- **International CLASSIC TERRESTRE** — by zone (1–8), kg brackets, with "from 32 kg" overflow.
- **Country → zone map** for both international services (FR=1, DE=2, BE/NL/IT/UK/LU/SM=2, etc., as listed on pages 10–11).
- **Province → national bracket map** for Spain (Madrid province = `PROVINCIAL`, peninsular regions = `CORTO`/`LARGO`, Balears = `LARGO_BALEARES`, Canarias/Ceuta/Melilla flagged as not covered by these tariffs).
- `quoteTransport({ countryCode, province?, weightKg })` returning an array `{ service, label, etaDays, price }` for every applicable service, sorted cheapest first.
- Origin constant: `PICKUP_ADDRESS = { line: "San Lorenzo 10H", postalCode: "28947", city: "Fuenlabrada", province: "Madrid", country: "Spain" }`.

### 2. Settings › Transport — calculator UI

Replaces the current "default fee" card with three blocks:

```text
┌─ Pickup origin ───────────────────────────┐
│ San Lorenzo 10H · 28947 Fuenlabrada       │
│ Madrid · Spain                            │
└───────────────────────────────────────────┘

┌─ Shipping calculator ─────────────────────┐
│ Destination country  [Spain ▾]            │
│ ─ if Spain: Province [Madrid ▾]           │
│ Weight (kg) [____]                        │
│                                            │
│ Service           ETA       Price          │
│ S‑1 24h Provincial  24 h    € 4,30         │
│ (or NETEXPRESS / CLASSIC TERRESTRE rows)   │
└───────────────────────────────────────────┘

┌─ Default fee fallback ────────────────────┐
│ Used when calculator can't quote (e.g.    │
│ unknown destination). [12.00 €]           │
└───────────────────────────────────────────┘
```

The default‑fee field stays so existing POS flow keeps working.

### 3. POS integration

- `POSView.tsx` computes the shipment weight = Σ `product.weight (g) × line.quantity` over the cart (skipping lines whose product has no weight; if any line is missing weight, fall back to the default fee).
- Calls `quoteTransport` with the customer's logistics address (country + province parsed from `provinceState`).
- The "Transport" select now lists every viable service returned by the quote (e.g. "S‑1 24h Corto Peninsular · 24 h · € 5,39"), plus the existing PICKUP option.
- Selected service's price + label flows into `sale.transport.fee` / `.label`, so the invoice PDF already shows it correctly.

### 4. Edge cases

- Unknown country / Canarias / Ceuta / Melilla → calculator shows "Tariff not available — using default fee" and POS falls back to `getDefaultTransportFee()`.
- Weight = 0 or missing → POS falls back to default fee with a small "estimate" badge.
- Decimal kg accepted; brackets are upper bounds (≤ 1, ≤ 3, ≤ 5 …).

## Out of scope (ask if you want them)

- Multi‑bulto UK supplement table, customs fees, fuel surcharge, IVA on transport.
- Per‑customer carrier overrides.
- Editing the rate tables from the UI (they live in code; updating means a code change).
