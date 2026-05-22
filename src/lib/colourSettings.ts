export type Colour = { code: string; name: string };

const KEY = "app.colours";

export const DEFAULT_COLOURS: Colour[] = [
  { code: "N", name: "BLACK" },
  { code: "B", name: "WHITE" },
  { code: "R", name: "RED" },
  { code: "F", name: "PINK" },
  { code: "FC", name: "LIGHT PINK" },
  { code: "FO", name: "DARK PINK" },
  { code: "V", name: "GREEN" },
  { code: "J", name: "ORANGE" },
  { code: "G", name: "GRAY" },
  { code: "A", name: "YELLOW" },
  { code: "W", name: "BROWN" },
  { code: "P", name: "PURPLE" },
  { code: "C", name: "UNIQUE" },
  { code: "Z", name: "BLUE" },
  { code: "BG", name: "BEIGE" },
  { code: "BGO", name: "DARK BEIGE" },
  { code: "GT", name: "MAROON" },
  { code: "ZM", name: "NAVY" },
  { code: "CM", name: "CAMEL" },
  { code: "VO", name: "OLIVE" },
  { code: "VC", name: "LIGHT GREEN" },
  { code: "GC", name: "LIGHT GRAY" },
  { code: "GO", name: "DARK GRAY" },
  { code: "Q", name: "TURQUOISE" },
  { code: "VK", name: "KAKHI" },
  { code: "VP", name: "PETROL GREEN" },
  { code: "JC", name: "LIGHT ORANGE" },
  { code: "ZC", name: "LIGHT BLUE" },
  { code: "VA", name: "WATER GREEN" },
  { code: "GM", name: "MEDIUM GREY" },
  { code: "DN", name: "DENIM" },
  { code: "CRA", name: "CORAL" },
  { code: "M", name: "MUSTARD" },
  { code: "MO", name: "DARK MUSTARD" },
  { code: "L", name: "LILAC" },
  { code: "PT", name: "PISTACHIO" },
  { code: "CR", name: "YVORY" },
  { code: "WO", name: "DARK BROWN" },
  { code: "D", name: "GOLDEN" },
  { code: "PL", name: "SILVER" },
];

const listeners = new Set<() => void>();

export function getColours(): Colour[] {
  if (typeof window === "undefined") return DEFAULT_COLOURS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_COLOURS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    return DEFAULT_COLOURS;
  }
  return DEFAULT_COLOURS;
}

export function setColours(colours: Colour[]) {
  localStorage.setItem(KEY, JSON.stringify(colours));
  listeners.forEach((l) => l());
}

export function subscribeColours(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Generate a unique uppercase code (max 3 chars) from a name. */
export function generateColourCode(name: string, existing: Colour[]): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "");
  if (!letters) return "";
  const taken = new Set(existing.map((c) => c.code));

  // 1-char, 2-char, 3-char prefixes from the name
  for (let len = 1; len <= 3; len++) {
    if (letters.length >= len) {
      const cand = letters.slice(0, len);
      if (!taken.has(cand)) return cand;
    }
  }
  // Try first letter + each subsequent letter (2-char combos)
  for (let i = 1; i < letters.length; i++) {
    const cand = letters[0] + letters[i];
    if (!taken.has(cand)) return cand;
  }
  // Try 3-char combos: first + two others
  for (let i = 1; i < letters.length; i++) {
    for (let j = i + 1; j < letters.length; j++) {
      const cand = letters[0] + letters[i] + letters[j];
      if (!taken.has(cand)) return cand;
    }
  }
  // Fallback: random 3 letters
  for (let attempt = 0; attempt < 200; attempt++) {
    const rand =
      String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
      String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
      String.fromCharCode(65 + Math.floor(Math.random() * 26));
    if (!taken.has(rand)) return rand;
  }
  return "";
}
