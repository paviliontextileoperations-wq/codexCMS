import type { Product } from "@/types";

export function normalizeProductCode(value: string | undefined | null): string {
  return String(value ?? "").trim().toUpperCase();
}

export function compactProductCode(value: string | undefined | null): string {
  return normalizeProductCode(value).replace(/[^A-Z0-9]/g, "");
}

function codeCandidates(product: Product): string[] {
  return [product.sku, product.otherSku, product.barcode].filter(Boolean).map((value) => String(value));
}

export function productCodeMatches(input: string, product: Product): boolean {
  const normalized = normalizeProductCode(input);
  const compact = compactProductCode(input);
  if (!normalized && !compact) return false;
  return codeCandidates(product).some((candidate) => {
    const candidateNormalized = normalizeProductCode(candidate);
    return candidateNormalized === normalized || compactProductCode(candidate) === compact;
  });
}

export function findProductByCode(input: string, products: Product[]): Product | undefined {
  const normalized = normalizeProductCode(input);
  const compact = compactProductCode(input);
  if (!normalized && !compact) return undefined;

  const direct = products.find((product) =>
    [product.sku, product.otherSku].filter(Boolean).some((candidate) => {
      const candidateNormalized = normalizeProductCode(candidate);
      return candidateNormalized === normalized || compactProductCode(candidate) === compact;
    }),
  );
  if (direct) return direct;

  const modelMatches = products.filter((product) => {
    const model = normalizeProductCode(product.barcode);
    return model === normalized || compactProductCode(model) === compact;
  });
  return modelMatches.length === 1 ? modelMatches[0] : undefined;
}

export function findDuplicateProductCode(
  input: string,
  products: Product[],
  excludeProductIds: Set<string> = new Set(),
): Product | undefined {
  const normalized = normalizeProductCode(input);
  const compact = compactProductCode(input);
  if (!normalized && !compact) return undefined;
  return products.find((product) => {
    if (excludeProductIds.has(product.id)) return false;
    return productCodeMatches(normalized, product) || compactProductCode(product.barcode) === compact;
  });
}
