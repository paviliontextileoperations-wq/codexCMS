// Category → fine category → 8 measurement labels (mapped to lengthA..lengthH).
export type FineCategoryDef = {
  name: string;
  // 8 entries in order [A..H]
  measurements: [string, string, string, string, string, string, string, string];
};

export const CATEGORY_MEASUREMENTS: Record<string, FineCategoryDef[]> = {
  "Coats & Jackets": [
    { name: "Long Coat",   measurements: ["Length","Shoulder Width","Bust/Chest","Waist","Hem Width","Sleeve Length","Armhole","Cuff Width"] },
    { name: "Short Coat",  measurements: ["Length","Shoulder Width","Bust/Chest","Waist","Hem Width","Sleeve Length","Armhole","Cuff Width"] },
    { name: "Trench Coat", measurements: ["Length","Shoulder Width","Bust/Chest","Waist","Hem Width","Sleeve Length","Cuff Width","Belt Length"] },
    { name: "Jacket",      measurements: ["Length","Shoulder Width","Bust/Chest","Hem Width","Sleeve Length","Armhole","Cuff Width","Waist"] },
    { name: "Blazer",      measurements: ["Length","Shoulder Width","Bust/Chest","Waist","Hem Width","Sleeve Length","Cuff Width","Lapel Width"] },
  ],
  "Tops": [
    { name: "T-Shirt",          measurements: ["Length","Shoulder Width","Bust/Chest","Hem Width","Sleeve Length","Sleeve Opening","Neck Width","Armhole"] },
    { name: "Short Sleeve Top", measurements: ["Length","Shoulder Width","Bust/Chest","Waist","Hem Width","Sleeve Length","Sleeve Opening","Neck Width"] },
    { name: "Long Sleeve Top",  measurements: ["Length","Shoulder Width","Bust/Chest","Waist","Hem Width","Sleeve Length","Cuff Width","Neck Width"] },
    { name: "Shirt",            measurements: ["Length","Shoulder Width","Bust/Chest","Waist","Hem Width","Sleeve Length","Cuff Width","Collar Width"] },
    { name: "Blouse",           measurements: ["Length","Shoulder Width","Bust/Chest","Waist","Hem Width","Sleeve Length","Sleeve Opening","Neck Width"] },
  ],
  "Dresses": [
    { name: "Mini Dress", measurements: ["Length","Shoulder Width","Bust/Chest","Waist","Hip","Hem Width","Sleeve Length","Sleeve Opening"] },
    { name: "Midi Dress", measurements: ["Length","Shoulder Width","Bust/Chest","Waist","Hip","Hem Width","Sleeve Length","Sleeve Opening"] },
    { name: "Long Dress", measurements: ["Length","Shoulder Width","Bust/Chest","Waist","Hip","Hem Width","Sleeve Length","Sleeve Opening"] },
  ],
  "Skirts": [
    { name: "Short Skirt", measurements: ["Length","Waist","Hip","Hem Width","Waistband Height","Slit Length","Zipper Length","Lining Length"] },
    { name: "Midi Skirt",  measurements: ["Length","Waist","Hip","Hem Width","Waistband Height","Slit Length","Zipper Length","Lining Length"] },
    { name: "Long Skirt",  measurements: ["Length","Waist","Hip","Hem Width","Waistband Height","Slit Length","Zipper Length","Lining Length"] },
  ],
  "Trousers & Jeans": [
    { name: "Long Pants",  measurements: ["Waist","Hip","Length","Inseam","Front Rise","Back Rise","Thigh Width","Leg Opening"] },
    { name: "Short Pants", measurements: ["Waist","Hip","Length","Inseam","Front Rise","Back Rise","Thigh Width","Leg Opening"] },
    { name: "Jeans",       measurements: ["Waist","Hip","Length","Inseam","Front Rise","Back Rise","Thigh Width","Leg Opening"] },
  ],
  "Knit": [
    { name: "Sweater",   measurements: ["Length","Shoulder Width","Bust/Chest","Hem Width","Sleeve Length","Cuff Width","Neck Width","Armhole"] },
    { name: "Cardigan",  measurements: ["Length","Shoulder Width","Bust/Chest","Hem Width","Sleeve Length","Cuff Width","Neck Width","Front Opening Length"] },
    { name: "Knit Top",  measurements: ["Length","Shoulder Width","Bust/Chest","Hem Width","Sleeve Length","Sleeve Opening","Neck Width","Armhole"] },
    { name: "Knit Vest", measurements: ["Length","Shoulder Width","Bust/Chest","Hem Width","Armhole","Neck Width","Shoulder Strap Width","Waist"] },
    { name: "Knit Dress",measurements: ["Length","Shoulder Width","Bust/Chest","Waist","Hip","Hem Width","Sleeve Length","Sleeve Opening"] },
  ],
};

export const CATEGORY_NAMES = Object.keys(CATEGORY_MEASUREMENTS);

export function getFineCategories(category: string): FineCategoryDef[] {
  return CATEGORY_MEASUREMENTS[category] ?? [];
}

export function getMeasurementLabels(category: string, fineCategory: string): string[] {
  const fc = getFineCategories(category).find((f) => f.name === fineCategory);
  return fc ? fc.measurements : ["Length a","Length b","Length c","Length d","Length e","Length f","Length g","Length h"];
}
