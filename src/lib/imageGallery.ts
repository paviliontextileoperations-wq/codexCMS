import { nanoid } from "nanoid";
import type { Product } from "@/types";

export type ImageRole =
  | "front"
  | "back"
  | "detail"
  | "model_front"
  | "model_back"
  | "model_extra"
  | "shein"
  | "other";

export type GalleryImage = {
  id: string;
  prefix: string;
  code: string;
  fileName: string;
  dataUrl: string;
  sku?: string;
  modelCode?: string;
  productId?: string;
  directory?: string;
  imageRole?: ImageRole;
  createdAt: number;
};

const KEY = "form.imageGallery.v1";

function read(): GalleryImage[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as GalleryImage[]) : [];
  } catch {
    return [];
  }
}

function write(list: GalleryImage[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("form-storage", { detail: { key: KEY } }));
}

export const galleryStore = {
  KEY,
  all(): GalleryImage[] {
    return read();
  },
  add(items: Omit<GalleryImage, "id" | "createdAt">[]) {
    const list = read();
    const now = Date.now();
    for (const it of items) {
      list.unshift({ ...it, id: nanoid(10), createdAt: now });
    }
    write(list);
  },
  remove(id: string) {
    write(read().filter((x) => x.id !== id));
  },
  update(id: string, patch: Partial<Omit<GalleryImage, "id" | "createdAt">>) {
    write(read().map((x) => (x.id === id ? { ...x, ...patch } : x)));
  },
};

// Filename: ALL CAPS basename, JPG extension.
// Accepts PREFIX_CODE.JPG and SKU-CODE.JPG for operators who append "-F" to the SKU.
// Codes: F, B, MF, MB, D<n>, MX<n>, S<n>
export const FILENAME_RE = /^([A-Z0-9-]+)[_-](F|B|MF|MB|D\d+|MX\d+|S\d+)\.JPG$/;

export function parseFileName(name: string):
  | { ok: true; prefix: string; code: string; separator: "_" | "-" }
  | { ok: false } {
  const m = name.match(FILENAME_RE);
  if (!m) return { ok: false };
  const separator = name.slice(m[1].length, m[1].length + 1) as "_" | "-";
  return { ok: true, prefix: m[1], code: m[2], separator };
}

export function imageRoleFromCode(code: string): ImageRole {
  if (code === "F") return "front";
  if (code === "B") return "back";
  if (code === "MF") return "model_front";
  if (code === "MB") return "model_back";
  if (code.startsWith("D")) return "detail";
  if (code.startsWith("MX")) return "model_extra";
  if (code.startsWith("S")) return "shein";
  return "other";
}

export function normalizeImageKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function slugPart(value: string | undefined, fallback: string): string {
  const clean = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || fallback;
}

export function findProductForImagePrefix(prefix: string, products: Product[]) {
  const target = normalizeImageKey(prefix);
  return products.find((product) => {
    const candidates = [product.sku, product.barcode, product.otherSku].filter(Boolean) as string[];
    return candidates.some((candidate) => normalizeImageKey(candidate) === target);
  });
}

export function buildImageDirectory(product: Product | undefined, prefix: string): string {
  const category = slugPart(product?.category, "uncategorized");
  const fineCategory = slugPart(product?.fineCategory, "general");
  const modelCode = (product?.barcode || prefix).toUpperCase();
  const skuCode = (product?.sku || prefix).toUpperCase();
  return ["women", category, fineCategory, modelCode, skuCode].join("/");
}

export function enrichGalleryImage(
  parsed: { prefix: string; code: string },
  fileName: string,
  dataUrl: string,
  products: Product[],
): Omit<GalleryImage, "id" | "createdAt"> {
  const product = findProductForImagePrefix(parsed.prefix, products);
  return {
    prefix: parsed.prefix,
    code: parsed.code,
    fileName,
    dataUrl,
    sku: product?.sku ?? parsed.prefix,
    modelCode: product?.barcode ?? parsed.prefix,
    productId: product?.id,
    directory: buildImageDirectory(product, parsed.prefix),
    imageRole: imageRoleFromCode(parsed.code),
  };
}
