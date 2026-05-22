import type { GalleryImage } from "@/lib/imageGallery";
import { imageRoleFromCode } from "@/lib/imageGallery";

export async function uploadImageToCloud(
  file: File,
): Promise<Omit<GalleryImage, "id" | "createdAt"> | null> {
  const desktopApp = window.desktopApp;
  if (!desktopApp?.createImageUploadUrl || !desktopApp?.registerImageAsset) {
    return null;
  }

  const ticket = await desktopApp.createImageUploadUrl({
    fileName: file.name,
    contentType: file.type || "image/jpeg",
  });
  const contentType = ticket.headers["content-type"] ?? ticket.headers["Content-Type"] ?? file.type;
  const upload = await fetch(ticket.uploadUrl, {
    method: ticket.method,
    headers: contentType ? { "content-type": contentType } : undefined,
    body: file,
  });
  if (!upload.ok) {
    throw new Error(`S3 upload failed with ${upload.status}`);
  }
  await desktopApp.registerImageAsset({ asset: ticket.asset });

  return {
    prefix: ticket.asset.skuCode || ticket.asset.modelCode,
    code: ticket.asset.imageCode,
    fileName: ticket.asset.fileName,
    dataUrl: ticket.asset.url,
    sku: ticket.asset.skuCode,
    modelCode: ticket.asset.modelCode,
    productId: ticket.asset.skuId ?? ticket.asset.productId ?? undefined,
    directory: ticket.asset.directoryKey,
    imageRole: imageRoleFromCode(ticket.asset.imageCode),
  };
}
