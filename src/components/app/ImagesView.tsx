import { useEffect, useMemo, useRef, useState } from "react";
import { FolderTree, Image as ImageIcon, Replace, Search, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SectionHeader } from "./SectionHeader";
import { EmptyState } from "./EmptyState";
import { toast } from "sonner";
import {
  enrichGalleryImage,
  galleryStore,
  parseFileName,
  type GalleryImage,
} from "@/lib/imageGallery";
import { uploadImageToCloud } from "@/lib/cloudImages";
import { useProducts } from "@/hooks/useStore";
import { productsStore } from "@/lib/storage";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressImage(file: File, maxDim = 1280, quality = 0.8): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function roleLabel(value?: string) {
  return (value ?? "other").replace(/_/g, " ");
}

function fallbackDirectory(item: GalleryImage) {
  return item.directory ?? `women/uncategorized/general/${item.prefix}/${item.prefix}`;
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|avif|heic)$/i.test(file.name);
}

function syncProductMainImages(items: Omit<GalleryImage, "id" | "createdAt">[]) {
  const products = productsStore.all();
  let changed = false;
  const next = products.map((product) => {
    const match = items.find((item) => {
      const isSameProduct =
        item.productId === product.id ||
        (Boolean(item.sku) && [product.sku, product.otherSku].filter(Boolean).includes(item.sku));
      return isSameProduct && Boolean(item.dataUrl);
    });
    if (!match) return product;
    const shouldUseAsMain = match.imageRole === "front" || !product.mainImage;
    const imagePatch =
      match.sku === product.sku || match.productId === product.id
        ? { image: match.dataUrl }
        : {};
    if (!shouldUseAsMain && !imagePatch.image) return product;
    changed = true;
    return {
      ...product,
      ...imagePatch,
      ...(shouldUseAsMain ? { mainImage: match.dataUrl } : {}),
      updatedAt: Date.now(),
    };
  });
  if (changed) productsStore.save(next);
}

export function ImagesView() {
  const [q, setQ] = useState("");
  const [products] = useProducts();
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const [preview, setPreview] = useState<GalleryImage | null>(null);
  const [gallery, setGallery] = useState<GalleryImage[]>(() => galleryStore.all());

  useEffect(() => {
    const handler = () => setGallery(galleryStore.all());
    window.addEventListener("form-storage", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("form-storage", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  async function prepareGalleryImage(file: File, parsed: { prefix: string; code: string; fileName?: string }) {
    const cloudImage = await uploadImageToCloud(file);
    if (cloudImage) return cloudImage;
    const dataUrl = await compressImage(file);
    return enrichGalleryImage(parsed, file.name, dataUrl, products);
  }

  async function handleBulkPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const accepted: Omit<GalleryImage, "id" | "createdAt">[] = [];
    const rejected: string[] = [];

    for (const file of files) {
      const parsed = parseFileName(file.name);
      if (!isImageFile(file) || !parsed.ok) {
        rejected.push(file.name);
        continue;
      }
      try {
        accepted.push(await prepareGalleryImage(file, parsed));
      } catch {
        rejected.push(file.name);
      }
    }

    if (accepted.length > 0) {
      try {
        galleryStore.add(accepted);
        syncProductMainImages(accepted);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error("Storage full", {
          description: msg.includes("quota")
            ? "Browser storage is full. Remove some pictures and try again."
            : msg,
        });
        return;
      }
    }

    if (accepted.length > 0 && rejected.length === 0) {
      toast.success(`Uploaded ${accepted.length} picture${accepted.length === 1 ? "" : "s"}`);
    } else if (accepted.length > 0 && rejected.length > 0) {
      toast.warning(`Uploaded ${accepted.length}, rejected ${rejected.length} non-image file${rejected.length === 1 ? "" : "s"}`, {
        description: rejected.slice(0, 5).join(", ") + (rejected.length > 5 ? "..." : ""),
      });
    } else {
      toast.error(`Rejected ${rejected.length} file${rejected.length === 1 ? "" : "s"}`, {
        description: "Only image files can be uploaded.",
      });
    }
  }

  function startReplace(id: string) {
    setReplaceTargetId(id);
    replaceInputRef.current?.click();
  }

  async function handleReplacePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const id = replaceTargetId;
    setReplaceTargetId(null);
    if (!file || !id) return;

    if (!isImageFile(file)) {
      toast.error("Only image files can be uploaded");
      return;
    }
    const parsed = parseFileName(file.name);
    if (!parsed.ok) return;
    try {
      const nextImage = await prepareGalleryImage(file, parsed);
      galleryStore.update(id, nextImage);
      syncProductMainImages([nextImage]);
      toast.success("Picture replaced");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg.includes("quota") ? "Storage full" : msg || "Failed to upload file");
    }
  }

  function removeGalleryImage(id: string) {
    galleryStore.remove(id);
    if (preview?.id === id) setPreview(null);
  }

  const directoryIndex = useMemo(() => {
    const map = new Map<
      string,
      { directory: string; count: number; modelCode: string; sku: string; roles: Set<string> }
    >();
    for (const item of gallery) {
      const directory = fallbackDirectory(item);
      const current =
        map.get(directory) ??
        {
          directory,
          count: 0,
          modelCode: item.modelCode ?? item.prefix,
          sku: item.sku ?? item.prefix,
          roles: new Set<string>(),
        };
      current.count += 1;
      current.roles.add(roleLabel(item.imageRole));
      map.set(directory, current);
    }
    return Array.from(map.values()).sort((a, b) => a.directory.localeCompare(b.directory));
  }, [gallery]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = [...gallery].sort((a, b) => b.createdAt - a.createdAt);
    if (!t) return list;
    return list.filter((g) =>
      [
        g.prefix,
        g.fileName,
        g.code,
        g.sku,
        g.modelCode,
        fallbackDirectory(g),
        roleLabel(g.imageRole),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(t),
    );
  }, [gallery, q]);

  const indexedCount = gallery.filter((item) => item.productId).length;
  const unmatchedCount = gallery.length - indexedCount;

  return (
    <>
      <SectionHeader
        title="Images"
        description="Cloud-ready product image catalog with SKU naming, directory index, and image role lookup."
        actions={
          <Button onClick={() => bulkInputRef.current?.click()}>
            <Upload /> Upload pictures
          </Button>
        }
      />

      <input
        ref={bulkInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleBulkPick}
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleReplacePick}
      />

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-2 border-foreground bg-secondary/30 p-3">
        <div className="text-xs text-muted-foreground">
          <div className="mb-1 font-display text-sm text-foreground">Bulk upload</div>
          <div>
            Any image can be uploaded. Exact SKU names like <span className="font-mono-tabular">P001BLK.JPG</span>
            {" "}bind to products; strict names like <span className="font-mono-tabular">P001BLK-F.JPG</span> add roles.
          </div>
          <div>Unmatched files stay in the cloud as unbound pictures until a product SKU is available.</div>
        </div>
        <div className="font-mono-tabular text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          AWS key preview: women/category/fine-category/model/sku/file.jpg
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <div className="border-2 border-foreground p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <FolderTree className="h-4 w-4" /> Directories
          </div>
          <div className="mt-2 font-display text-3xl">{directoryIndex.length}</div>
        </div>
        <div className="border-2 border-foreground p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <ImageIcon className="h-4 w-4" /> Product matched
          </div>
          <div className="mt-2 font-display text-3xl">{indexedCount}</div>
        </div>
        <div className="border-2 border-foreground p-3">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Needs product link</div>
          <div className="mt-2 font-display text-3xl">{unmatchedCount}</div>
        </div>
      </div>

      {directoryIndex.length > 0 && (
        <div className="mb-4 overflow-x-auto border-2 border-foreground">
          <div className="flex items-center justify-between bg-foreground px-3 py-2 text-primary-foreground">
            <div className="font-display text-sm">Directory index</div>
            <div className="text-[10px] uppercase tracking-[0.2em]">S3-ready lookup</div>
          </div>
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-secondary/50">
              <tr className="border-b-2 border-foreground text-left">
                <th className="px-3 py-2 font-display text-xs uppercase">Directory</th>
                <th className="px-3 py-2 font-display text-xs uppercase">Model</th>
                <th className="px-3 py-2 font-display text-xs uppercase">SKU</th>
                <th className="px-3 py-2 font-display text-xs uppercase">Roles</th>
                <th className="px-3 py-2 font-display text-xs uppercase">Images</th>
              </tr>
            </thead>
            <tbody>
              {directoryIndex.slice(0, 8).map((item) => (
                <tr key={item.directory} className="border-b border-foreground/20">
                  <td className="px-3 py-2 font-mono-tabular text-xs">{item.directory}</td>
                  <td className="px-3 py-2 font-mono-tabular text-xs">{item.modelCode}</td>
                  <td className="px-3 py-2 font-mono-tabular text-xs">{item.sku}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {Array.from(item.roles).join(", ")}
                  </td>
                  <td className="px-3 py-2 font-mono-tabular text-xs">{item.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mb-4 flex items-center gap-3 border-2 border-foreground bg-background px-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by SKU, model, code, filename, role or directory..."
          className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={gallery.length === 0 ? "No pictures yet" : "No matching pictures"}
          description="Upload images named like an existing SKU to bind them, or upload loose images for later matching."
        />
      ) : (
        <div className="overflow-x-auto border-2 border-foreground">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-secondary/50">
              <tr className="border-b-2 border-foreground text-left">
                <th className="px-3 py-2 font-display text-xs uppercase">Thumbnail</th>
                <th className="px-3 py-2 font-display text-xs uppercase">File name</th>
                <th className="px-3 py-2 font-display text-xs uppercase">SKU / Model</th>
                <th className="px-3 py-2 font-display text-xs uppercase">Role</th>
                <th className="px-3 py-2 font-display text-xs uppercase">Directory</th>
                <th className="px-3 py-2 font-display text-xs uppercase">Uploaded</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr
                  key={it.id}
                  onDoubleClick={() => setPreview(it)}
                  className="cursor-pointer border-b border-foreground/20 hover:bg-secondary/30"
                  title="Double-click to preview"
                >
                  <td className="px-3 py-2">
                    <div className="h-14 w-14 border-2 border-foreground bg-secondary">
                      <img src={it.dataUrl} alt={it.fileName} className="h-full w-full object-cover" />
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono-tabular text-xs">{it.fileName}</td>
                  <td className="px-3 py-2 font-mono-tabular text-xs">
                    <div>{it.sku ?? it.prefix}</div>
                    <div className="text-muted-foreground">{it.modelCode ?? it.prefix}</div>
                  </td>
                  <td className="px-3 py-2 text-xs capitalize text-muted-foreground">{roleLabel(it.imageRole)}</td>
                  <td className="px-3 py-2 font-mono-tabular text-xs">{fallbackDirectory(it)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(it.createdAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          startReplace(it.id);
                        }}
                      >
                        <Replace /> Replace
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeGalleryImage(it.id);
                        }}
                      >
                        <Trash2 /> Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono-tabular text-base">{preview?.fileName}</DialogTitle>
            <DialogDescription>
              {preview ? (
                <>
                  {preview.sku ?? preview.prefix} - {roleLabel(preview.imageRole)} - {formatDate(preview.createdAt)}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="flex flex-col gap-3">
              <div className="border-2 border-foreground bg-secondary">
                <img src={preview.dataUrl} alt={preview.fileName} className="max-h-[70vh] w-full object-contain" />
              </div>
              <div className="border-2 border-foreground/20 p-3 font-mono-tabular text-xs">
                {fallbackDirectory(preview)}/{preview.fileName}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => startReplace(preview.id)}>
                  <Replace /> Replace
                </Button>
                <Button variant="outline" onClick={() => removeGalleryImage(preview.id)}>
                  <Trash2 /> Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
