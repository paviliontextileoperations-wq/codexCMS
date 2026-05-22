/**
 * SEUR transport rates encoded from the customer's tariffs:
 *   - National S-1 24h tariff (provincial / corto / largo / Baleares)
 *   - International NETEXPRESS by zone (1-6)
 *
 * Source: TARIFA_T07_NACIONAL and TARIFA_INTERNACIONAL PDFs.
 * Origin warehouse: San Lorenzo 10H · 28947 Fuenlabrada (Madrid) · Spain.
 */

export const PICKUP_ADDRESS = {
  line: "San Lorenzo 10H",
  postalCode: "28947",
  city: "Fuenlabrada",
  province: "Madrid",
  country: "Spain",
} as const;

export type NationalBracket =
  | "PROVINCIAL"
  | "CORTO_PENINSULAR"
  | "LARGO_PEN_PORTUGAL"
  | "LARGO_BALEARES";

export type RateRow = { uptoKg: number; price: number };
/** A rate table: ascending kg brackets + a per-kg overflow above the last bracket. */
export type RateTable = {
  rows: RateRow[];
  /** Base price reused above the last bracket. */
  overflowBase: number;
  /** € per kg added per kg over `overflowFromKg`. */
  overflowPerKg: number;
  overflowFromKg: number;
};

/** SEUR S-1 24h national tariff. */
export const NATIONAL_RATES: Record<NationalBracket, RateTable> = {
  PROVINCIAL: {
    rows: [
      { uptoKg: 1, price: 3.71 }, { uptoKg: 3, price: 4.30 },
      { uptoKg: 5, price: 4.86 }, { uptoKg: 10, price: 5.97 },
      { uptoKg: 15, price: 7.13 }, { uptoKg: 20, price: 9.04 },
      { uptoKg: 25, price: 11.06 }, { uptoKg: 30, price: 13.17 },
      { uptoKg: 40, price: 17.20 }, { uptoKg: 50, price: 20.90 },
    ],
    overflowBase: 20.90, overflowPerKg: 0.36, overflowFromKg: 50,
  },
  CORTO_PENINSULAR: {
    rows: [
      { uptoKg: 1, price: 4.13 }, { uptoKg: 3, price: 4.76 },
      { uptoKg: 5, price: 5.39 }, { uptoKg: 10, price: 6.64 },
      { uptoKg: 15, price: 7.94 }, { uptoKg: 20, price: 10.05 },
      { uptoKg: 25, price: 12.28 }, { uptoKg: 30, price: 14.63 },
      { uptoKg: 40, price: 19.12 }, { uptoKg: 50, price: 23.22 },
    ],
    overflowBase: 23.22, overflowPerKg: 0.42, overflowFromKg: 50,
  },
  LARGO_PEN_PORTUGAL: {
    rows: [
      { uptoKg: 1, price: 4.13 }, { uptoKg: 3, price: 4.76 },
      { uptoKg: 5, price: 5.39 }, { uptoKg: 10, price: 7.42 },
      { uptoKg: 15, price: 9.41 }, { uptoKg: 20, price: 12.19 },
      { uptoKg: 25, price: 15.29 }, { uptoKg: 30, price: 18.38 },
      { uptoKg: 40, price: 25.56 }, { uptoKg: 50, price: 30.86 },
    ],
    overflowBase: 30.86, overflowPerKg: 0.53, overflowFromKg: 50,
  },
  LARGO_BALEARES: {
    rows: [
      { uptoKg: 1, price: 5.89 }, { uptoKg: 3, price: 7.62 },
      { uptoKg: 5, price: 8.92 }, { uptoKg: 10, price: 13.97 },
      { uptoKg: 15, price: 17.64 }, { uptoKg: 20, price: 22.17 },
      { uptoKg: 25, price: 27.28 }, { uptoKg: 30, price: 32.73 },
      { uptoKg: 40, price: 40.45 }, { uptoKg: 50, price: 47.04 },
    ],
    overflowBase: 47.04, overflowPerKg: 0.67, overflowFromKg: 50,
  },
};

const NATIONAL_LABEL: Record<NationalBracket, string> = {
  PROVINCIAL: "Provincial (Madrid)",
  CORTO_PENINSULAR: "Corto España Peninsular",
  LARGO_PEN_PORTUGAL: "Largo España Pen. / Portugal",
  LARGO_BALEARES: "Largo Baleares",
};

const NATIONAL_ETA: Record<NationalBracket, string> = {
  PROVINCIAL: "24 h",
  CORTO_PENINSULAR: "24 h",
  LARGO_PEN_PORTUGAL: "24-48 h",
  LARGO_BALEARES: "48-72 h",
};

/** Spanish province → national bracket. */
const ES_PROVINCE_BRACKET: Record<string, NationalBracket | "NOT_COVERED"> = {
  // Provincial (Madrid only, since pickup is in Fuenlabrada/Madrid)
  "madrid": "PROVINCIAL",
  // Corto peninsular: provinces neighbouring/near Madrid
  "toledo": "CORTO_PENINSULAR",
  "guadalajara": "CORTO_PENINSULAR",
  "cuenca": "CORTO_PENINSULAR",
  "segovia": "CORTO_PENINSULAR",
  "avila": "CORTO_PENINSULAR",
  "ávila": "CORTO_PENINSULAR",
  "ciudad real": "CORTO_PENINSULAR",
  "caceres": "CORTO_PENINSULAR",
  "cáceres": "CORTO_PENINSULAR",
  // Baleares
  "balearic islands": "LARGO_BALEARES",
  "baleares": "LARGO_BALEARES",
  "illes balears": "LARGO_BALEARES",
  // Not covered by S-1 24h (overseas territories)
  "las palmas": "NOT_COVERED",
  "santa cruz de tenerife": "NOT_COVERED",
  "ceuta": "NOT_COVERED",
  "melilla": "NOT_COVERED",
};

function bracketForSpanishProvince(province?: string): NationalBracket | "NOT_COVERED" {
  if (!province) return "LARGO_PEN_PORTUGAL";
  const key = province.trim().toLowerCase();
  return ES_PROVINCE_BRACKET[key] ?? "LARGO_PEN_PORTUGAL";
}

/** International NETEXPRESS — country zones (page 10). */
export type IntlZone = 1 | 2 | 3 | 4 | 5 | 6;

const COUNTRY_ZONE: Record<string, IntlZone | "NATIONAL"> = {
  // Spain handled by national table
  "es": "NATIONAL", "spain": "NATIONAL", "españa": "NATIONAL", "espana": "NATIONAL",
  // Portugal uses national LARGO_PEN_PORTUGAL
  "pt": "NATIONAL", "portugal": "NATIONAL",
  // Zone 1
  "fr": 1, "france": 1, "francia": 1,
  // Zone 2
  "de": 2, "germany": 2, "alemania": 2,
  "be": 2, "belgium": 2, "bélgica": 2, "belgica": 2,
  "nl": 2, "netherlands": 2, "holanda": 2, "países bajos": 2, "paises bajos": 2,
  "it": 2, "italy": 2, "italia": 2,
  "lu": 2, "luxembourg": 2, "luxemburgo": 2,
  "gb": 2, "uk": 2, "united kingdom": 2, "reino unido": 2,
  "sm": 2, "san marino": 2,
  // Zone 3
  "at": 3, "austria": 3,
  "dk": 3, "denmark": 3, "dinamarca": 3,
  "ie": 3, "ireland": 3, "irlanda": 3,
  "ch": 3, "switzerland": 3, "suiza": 3,
  // Zone 4
  "bg": 4, "bulgaria": 4,
  "ee": 4, "estonia": 4,
  "fi": 4, "finland": 4, "finlandia": 4,
  "lv": 4, "latvia": 4, "letonia": 4,
  "lt": 4, "lithuania": 4, "lituania": 4,
  "no": 4, "norway": 4, "noruega": 4,
  "ro": 4, "romania": 4, "rumania": 4, "rumanía": 4,
  "se": 4, "sweden": 4, "suecia": 4,
  // Zone 5
  "si": 5, "slovenia": 5, "eslovenia": 5,
  "hu": 5, "hungary": 5, "hungria": 5, "hungría": 5,
  "pl": 5, "poland": 5, "polonia": 5,
  "cz": 5, "czech republic": 5, "czechia": 5, "rep. checa": 5, "republica checa": 5,
  // Zone 6
  "hr": 6, "croatia": 6, "croacia": 6,
  "sk": 6, "slovakia": 6, "eslovaquia": 6,
};

/**
 * NETEXPRESS rates per zone (representative country per zone from page 1).
 * Zone 3 is not in page 1 of the parsed PDF; approximated as Zone 2 * 1.1.
 */
const NETEXPRESS_RATES: Record<IntlZone, RateTable> = {
  1: {
    rows: [
      { uptoKg: 5, price: 17.51 }, { uptoKg: 10, price: 21.21 },
      { uptoKg: 15, price: 27.58 }, { uptoKg: 20, price: 33.44 },
      { uptoKg: 25, price: 39.22 }, { uptoKg: 30, price: 44.57 },
      { uptoKg: 35, price: 52.29 }, { uptoKg: 40, price: 58.48 },
      { uptoKg: 45, price: 64.97 }, { uptoKg: 50, price: 71.10 },
      { uptoKg: 60, price: 83.37 }, { uptoKg: 70, price: 96.44 },
      { uptoKg: 80, price: 109.01 }, { uptoKg: 90, price: 117.12 },
      { uptoKg: 100, price: 130.40 }, { uptoKg: 125, price: 158.51 },
      { uptoKg: 150, price: 190.15 }, { uptoKg: 175, price: 221.44 },
      { uptoKg: 200, price: 252.73 }, { uptoKg: 250, price: 315.99 },
      { uptoKg: 300, price: 378.58 }, { uptoKg: 350, price: 430.62 },
      { uptoKg: 400, price: 491.62 },
    ],
    overflowBase: 491.62, overflowPerKg: 1.31, overflowFromKg: 400,
  },
  2: {
    rows: [
      { uptoKg: 5, price: 20.65 }, { uptoKg: 10, price: 26.53 },
      { uptoKg: 15, price: 34.64 }, { uptoKg: 20, price: 42.73 },
      { uptoKg: 25, price: 50.19 }, { uptoKg: 30, price: 57.43 },
      { uptoKg: 35, price: 67.55 }, { uptoKg: 40, price: 75.72 },
      { uptoKg: 45, price: 84.19 }, { uptoKg: 50, price: 92.28 },
      { uptoKg: 60, price: 108.28 }, { uptoKg: 70, price: 124.85 },
      { uptoKg: 80, price: 141.03 }, { uptoKg: 90, price: 156.38 },
      { uptoKg: 100, price: 172.59 }, { uptoKg: 125, price: 206.12 },
      { uptoKg: 150, price: 245.79 }, { uptoKg: 175, price: 285.13 },
      { uptoKg: 200, price: 323.97 }, { uptoKg: 250, price: 402.69 },
      { uptoKg: 300, price: 479.56 }, { uptoKg: 350, price: 541.55 },
      { uptoKg: 400, price: 615.64 },
    ],
    overflowBase: 615.64, overflowPerKg: 1.54, overflowFromKg: 400,
  },
  // Zone 3: approximated as Zone 2 × 1.10 (PDF detail table not in our extract).
  3: {
    rows: [
      { uptoKg: 5, price: 22.72 }, { uptoKg: 10, price: 29.18 },
      { uptoKg: 15, price: 38.10 }, { uptoKg: 20, price: 47.00 },
      { uptoKg: 25, price: 55.21 }, { uptoKg: 30, price: 63.17 },
      { uptoKg: 35, price: 74.31 }, { uptoKg: 40, price: 83.29 },
      { uptoKg: 45, price: 92.61 }, { uptoKg: 50, price: 101.51 },
      { uptoKg: 60, price: 119.11 }, { uptoKg: 70, price: 137.34 },
      { uptoKg: 80, price: 155.13 }, { uptoKg: 90, price: 172.02 },
      { uptoKg: 100, price: 189.85 }, { uptoKg: 125, price: 226.73 },
      { uptoKg: 150, price: 270.37 }, { uptoKg: 175, price: 313.64 },
      { uptoKg: 200, price: 356.37 }, { uptoKg: 250, price: 442.96 },
      { uptoKg: 300, price: 527.52 }, { uptoKg: 350, price: 595.71 },
      { uptoKg: 400, price: 677.20 },
    ],
    overflowBase: 677.20, overflowPerKg: 1.69, overflowFromKg: 400,
  },
  4: {
    rows: [
      { uptoKg: 5, price: 38.90 }, { uptoKg: 10, price: 46.89 },
      { uptoKg: 15, price: 54.37 }, { uptoKg: 20, price: 61.20 },
      { uptoKg: 25, price: 68.39 }, { uptoKg: 30, price: 75.24 },
      { uptoKg: 35, price: 90.84 }, { uptoKg: 40, price: 103.92 },
      { uptoKg: 45, price: 117.34 }, { uptoKg: 50, price: 130.41 },
      { uptoKg: 60, price: 151.88 }, { uptoKg: 70, price: 173.72 },
      { uptoKg: 80, price: 195.21 }, { uptoKg: 90, price: 217.04 },
      { uptoKg: 100, price: 238.51 }, { uptoKg: 125, price: 273.15 },
      { uptoKg: 150, price: 311.72 }, { uptoKg: 175, price: 349.95 },
      { uptoKg: 200, price: 388.19 }, { uptoKg: 250, price: 465.34 },
      { uptoKg: 300, price: 548.69 }, { uptoKg: 350, price: 618.03 },
      { uptoKg: 400, price: 700.64 },
    ],
    overflowBase: 700.64, overflowPerKg: 1.75, overflowFromKg: 400,
  },
  5: {
    rows: [
      { uptoKg: 5, price: 19.34 }, { uptoKg: 10, price: 28.69 },
      { uptoKg: 15, price: 38.30 }, { uptoKg: 20, price: 47.51 },
      { uptoKg: 25, price: 57.06 }, { uptoKg: 30, price: 66.64 },
      { uptoKg: 35, price: 79.55 }, { uptoKg: 40, price: 90.19 },
      { uptoKg: 45, price: 101.17 }, { uptoKg: 50, price: 111.82 },
      { uptoKg: 60, price: 133.10 }, { uptoKg: 70, price: 154.73 },
      { uptoKg: 80, price: 176.02 }, { uptoKg: 90, price: 197.65 },
      { uptoKg: 100, price: 218.92 }, { uptoKg: 125, price: 268.29 },
      { uptoKg: 150, price: 321.29 }, { uptoKg: 175, price: 373.95 },
      { uptoKg: 200, price: 426.62 }, { uptoKg: 250, price: 532.63 },
      { uptoKg: 300, price: 637.96 }, { uptoKg: 350, price: 725.07 },
      { uptoKg: 400, price: 827.70 },
    ],
    overflowBase: 827.70, overflowPerKg: 2.06, overflowFromKg: 400,
  },
  6: {
    rows: [
      { uptoKg: 5, price: 24.86 }, { uptoKg: 10, price: 40.08 },
      { uptoKg: 15, price: 50.78 }, { uptoKg: 20, price: 71.95 },
      { uptoKg: 25, price: 82.42 }, { uptoKg: 30, price: 92.56 },
      { uptoKg: 35, price: 112.11 }, { uptoKg: 40, price: 128.53 },
      { uptoKg: 45, price: 139.37 }, { uptoKg: 50, price: 149.85 },
      { uptoKg: 60, price: 183.46 }, { uptoKg: 70, price: 204.77 },
      { uptoKg: 80, price: 237.14 }, { uptoKg: 90, price: 258.46 },
      { uptoKg: 100, price: 279.41 }, { uptoKg: 125, price: 351.03 },
      { uptoKg: 150, price: 403.24 }, { uptoKg: 175, price: 473.44 },
      { uptoKg: 200, price: 525.30 }, { uptoKg: 250, price: 635.38 },
      { uptoKg: 300, price: 733.79 }, { uptoKg: 350, price: 839.12 },
      { uptoKg: 400, price: 935.06 },
    ],
    overflowBase: 935.06, overflowPerKg: 2.37, overflowFromKg: 400,
  },
};

const ZONE_ETA: Record<IntlZone, string> = {
  1: "2-3 days", 2: "3 days", 3: "3-4 days",
  4: "4-5 days", 5: "4-5 days", 6: "6-7 days",
};

function priceFromTable(t: RateTable, weightKg: number): number {
  for (const row of t.rows) {
    if (weightKg <= row.uptoKg) return row.price;
  }
  const extra = Math.max(0, weightKg - t.overflowFromKg) * t.overflowPerKg;
  return t.overflowBase + extra;
}

export type TransportQuote = {
  service: "S1_NATIONAL" | "NETEXPRESS";
  bracket?: NationalBracket;
  zone?: IntlZone;
  label: string;
  eta: string;
  price: number;
};

export type QuoteInput = {
  country?: string;
  province?: string;
  weightKg: number;
};

function normCountry(c?: string): string {
  return (c ?? "").trim().toLowerCase();
}

/**
 * Returns all viable transport quotes for a given destination + weight.
 * Empty array means "no tariff available — fall back to default fee".
 */
export function quoteTransport(input: QuoteInput): TransportQuote[] {
  const w = Math.max(0, input.weightKg || 0);
  if (w <= 0) return [];

  const country = normCountry(input.country);
  const zone = COUNTRY_ZONE[country];

  // Spain → national tariff
  if (zone === "NATIONAL" && (country === "es" || country === "spain" || country === "españa" || country === "espana")) {
    const bracket = bracketForSpanishProvince(input.province);
    if (bracket === "NOT_COVERED") return [];
    const t = NATIONAL_RATES[bracket];
    return [{
      service: "S1_NATIONAL",
      bracket,
      label: `SEUR S-1 24h · ${NATIONAL_LABEL[bracket]}`,
      eta: NATIONAL_ETA[bracket],
      price: priceFromTable(t, w),
    }];
  }

  // Portugal → national LARGO_PEN_PORTUGAL
  if (zone === "NATIONAL" && (country === "pt" || country === "portugal")) {
    const t = NATIONAL_RATES.LARGO_PEN_PORTUGAL;
    return [{
      service: "S1_NATIONAL",
      bracket: "LARGO_PEN_PORTUGAL",
      label: `SEUR S-1 24h · ${NATIONAL_LABEL.LARGO_PEN_PORTUGAL}`,
      eta: NATIONAL_ETA.LARGO_PEN_PORTUGAL,
      price: priceFromTable(t, w),
    }];
  }

  if (typeof zone === "number") {
    const t = NETEXPRESS_RATES[zone];
    return [{
      service: "NETEXPRESS",
      zone,
      label: `SEUR NETEXPRESS · Zone ${zone}`,
      eta: ZONE_ETA[zone],
      price: priceFromTable(t, w),
    }];
  }

  return [];
}

/** Spanish provinces present in the bracket map, for the Settings calculator UI. */
export const ES_PROVINCE_OPTIONS = [
  { label: "Madrid", value: "Madrid" },
  { label: "Toledo", value: "Toledo" },
  { label: "Guadalajara", value: "Guadalajara" },
  { label: "Cuenca", value: "Cuenca" },
  { label: "Segovia", value: "Segovia" },
  { label: "Ávila", value: "Ávila" },
  { label: "Ciudad Real", value: "Ciudad Real" },
  { label: "Cáceres", value: "Cáceres" },
  { label: "Balearic Islands", value: "Balearic Islands" },
  { label: "Other peninsular province", value: "_OTHER_" },
  { label: "Las Palmas (not covered)", value: "Las Palmas" },
  { label: "Santa Cruz de Tenerife (not covered)", value: "Santa Cruz de Tenerife" },
  { label: "Ceuta (not covered)", value: "Ceuta" },
  { label: "Melilla (not covered)", value: "Melilla" },
];

/** Country list shown in the calculator (in addition to Spain). */
export const INTL_COUNTRY_OPTIONS = [
  { label: "Portugal", value: "Portugal" },
  { label: "France", value: "France" },
  { label: "Germany", value: "Germany" },
  { label: "Belgium", value: "Belgium" },
  { label: "Netherlands", value: "Netherlands" },
  { label: "Italy", value: "Italy" },
  { label: "Luxembourg", value: "Luxembourg" },
  { label: "United Kingdom", value: "United Kingdom" },
  { label: "San Marino", value: "San Marino" },
  { label: "Austria", value: "Austria" },
  { label: "Denmark", value: "Denmark" },
  { label: "Ireland", value: "Ireland" },
  { label: "Switzerland", value: "Switzerland" },
  { label: "Bulgaria", value: "Bulgaria" },
  { label: "Estonia", value: "Estonia" },
  { label: "Finland", value: "Finland" },
  { label: "Latvia", value: "Latvia" },
  { label: "Lithuania", value: "Lithuania" },
  { label: "Norway", value: "Norway" },
  { label: "Romania", value: "Romania" },
  { label: "Sweden", value: "Sweden" },
  { label: "Slovenia", value: "Slovenia" },
  { label: "Hungary", value: "Hungary" },
  { label: "Poland", value: "Poland" },
  { label: "Czech Republic", value: "Czech Republic" },
  { label: "Croatia", value: "Croatia" },
  { label: "Slovakia", value: "Slovakia" },
];