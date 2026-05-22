import { useEffect, useRef, useState } from "react";
import { Camera, X, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { maintenanceStore, REASON_LABELS, type MaintenanceReason } from "@/lib/maintenanceStore";
import { useSession } from "@/lib/auth";

export function TemporalItemDialog({
  open,
  onOpenChange,
  onAddToCart,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAddToCart?: (item: { name: string; price: number }) => void;
}) {
  const session = useSession();
  const [reason, setReason] = useState<MaintenanceReason>("cannot_find_product");
  const [reasonOther, setReasonOther] = useState("");
  const [sku, setSku] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string>("");
  const [name, setName] = useState("Temporal item");
  const [price, setPrice] = useState("");
  const [camOn, setCamOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  function reset() {
    setReason("cannot_find_product");
    setReasonOther("");
    setSku("");
    setNote("");
    setPhoto("");
    setName("Temporal item");
    setPrice("");
    stopCam();
  }

  function stopCam() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOn(false);
  }

  async function startCam() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      setCamOn(true);
      // wait for next paint so video element exists
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 50);
    } catch (err) {
      toast.error("Could not access webcam", { description: (err as Error)?.message });
    }
  }

  function snap() {
    const v = videoRef.current;
    if (!v) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 640;
    canvas.height = v.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL("image/jpeg", 0.7));
    stopCam();
  }

  useEffect(() => {
    if (!open) {
      stopCam();
      reset();
    }
    return () => stopCam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function save() {
    if (reason === "other" && !reasonOther.trim()) {
      toast.error("Please specify the reason");
      return;
    }
    const finalName = name.trim() || "Temporal item";
    const priceNum = parseFloat(price);
    if (!isFinite(priceNum) || priceNum < 0) {
      toast.error("Enter a valid price");
      return;
    }
    maintenanceStore.add({
      reason,
      reasonOther: reason === "other" ? reasonOther.trim() : undefined,
      associatedSku: sku.trim() || undefined,
      note: [`${finalName} · ${priceNum.toFixed(2)}`, note.trim()].filter(Boolean).join(" — "),
      photo: photo || undefined,
      createdBy: session?.username,
    });
    onAddToCart?.({ name: finalName, price: priceNum });
    toast.success(onAddToCart ? "Added to cart & Maintenance" : "Temporal item added to Maintenance");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-none border-2 border-foreground">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Temporal item</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div>
              <Label className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Name
              </Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Temporal item" />
            </div>
            <div>
              <Label className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Price *
              </Label>
              <Input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Reason *
            </Label>
            <Select value={reason} onValueChange={(v) => setReason(v as MaintenanceReason)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(REASON_LABELS) as MaintenanceReason[]).map((k) => (
                  <SelectItem key={k} value={k}>{REASON_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {reason === "other" && (
            <div>
              <Label className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Specify *
              </Label>
              <Input value={reasonOther} onChange={(e) => setReasonOther(e.target.value)} placeholder="Describe the issue" />
            </div>
          )}

          <div>
            <Label className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Associated SKU / P-number (optional)
            </Label>
            <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="P001 or SKU" />
          </div>

          <div>
            <Label className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Note (optional)
            </Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>

          <div>
            <Label className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Photo (optional)
            </Label>
            {photo ? (
              <div className="space-y-2">
                <img src={photo} alt="Temporal item" className="max-h-48 border-2 border-foreground/30" />
                <Button type="button" variant="outline" size="sm" onClick={() => { setPhoto(""); }}>
                  <RotateCcw className="h-4 w-4" /> Retake
                </Button>
              </div>
            ) : camOn ? (
              <div className="space-y-2">
                <video ref={videoRef} className="max-h-48 w-full border-2 border-foreground/30 bg-black" muted playsInline />
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={snap}>
                    <Camera className="h-4 w-4" /> Capture
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={stopCam}>
                    <X className="h-4 w-4" /> Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={startCam}>
                <Camera className="h-4 w-4" /> Use webcam
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}