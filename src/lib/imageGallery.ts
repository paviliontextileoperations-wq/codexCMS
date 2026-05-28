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

// Strict role naming is still supported, but operators may also upload
// SKU.JPG / SKU.PNG or any other image. Non-matching names stay unbound.
export const FILENAME_RE = /^(.+)\.(JPG|JPEG|PNG|WEBP|GIF|AVIF|HEIC)$/i;
const STRICT_ROLE_RE = /^(.+)[_-](F|B|MF|MB|D\d+|MX\d+|S\d+)$/i;

export function parseFileName(name: string):
  | { ok: true; prefix: string; code: string; separator?: "_" | "-"; strict: boolean; fileName: string; extension: string }
  | { ok: false } {
  const match = String(name || "").trim().match(FILENAME_RE);
  if (!match) return { ok: false };
  const rawBase = match[1].trim();
  const extension = match[2].toUpperCase() === "JPEG" ? "JPG" : match[2].toUpperCase();
  const strict = rawBase.toUpperCase().match(STRICT_ROLE_RE);
  if (strict) {
    const separator = rawBase.slice(strict[1].length, strict[1].length + 1) as "_" | "-";
    const prefix = normalizeImageKey(strict[1]);
    const code = strict[2].toUpperCase();
    return {
      ok: true,
      prefix: prefix || "IMAGE",
      code,
      separator,
      strict: true,
      fileName: `${prefix || "IMAGE"}-${code}.${extension}`,
      extension,
    };
  }
  const prefix = normalizeImageKey(rawBase);
  return {
    ok: true,
    prefix: prefix || "IMAGE",
    code: "IMG",
    strict: false,
    fileName: `${prefix || "IMAGE"}.${extension}`,
    extension,
  };
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
    const candidates = [product.sku, product.otherSku].filter(Boolean) as string[];
    return candidates.some((candidate) => normalizeImageKey(candidate) === target);
  });
}

export function buildImageDirectory(product: Product | undefined, prefix: string): string {
  if (!product) return ["women", "unmatched", "general", prefix.toUpperCase(), "unbound"].join("/");
  const category = slugPart(product.category, "uncategorized");
  const fineCategory = slugPart(product?.fineCategory, "general");
  const modelCode = (product?.barcode || prefix).toUpperCase();
  const skuCode = (product?.sku || prefix).toUpperCase();
  return ["women", category, fineCategory, modelCode, skuCode].join("/");
}

export function enrichGalleryImage(
  parsed: { prefix: string; code: string; fileName?: string },
  fileName: string,
  dataUrl: string,
  products: Product[],
): Omit<GalleryImage, "id" | "createdAt"> {
  const product = findProductForImagePrefix(parsed.prefix, products);
  return {
    prefix: parsed.prefix,
    code: parsed.code,
    fileName: parsed.fileName ?? fileName,
    dataUrl,
    sku: product?.sku,
    modelCode: product?.barcode ?? parsed.prefix,
    productId: product?.id,
    directory: buildImageDirectory(product, parsed.prefix),
    imageRole: imageRoleFromCode(parsed.code),
  };
}
