import { useState, useEffect, useRef } from "react";
import { ArrowLeft, Check, Clock, Trash2, Camera, Paperclip, X, FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { maintenanceStore, REASON_LABELS, useMaintenance, type MaintenanceItem } from "@/lib/maintenanceStore";
import { EmptyState } from "./EmptyState";
import { toast } from "sonner";
import { useSession } from "@/lib/auth";
import { approvalsStore, usePendingDeletes } from "@/lib/approvals";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ProductMaintenanceView({ onBack }: { onBack: () => void }) {
  const items = useMaintenance();
  const session = useSession();
  const pending = usePendingDeletes();
  const [detail, setDetail] = useState<MaintenanceItem | null>(null);
  const [draft, setDraft] = useState<MaintenanceItem | null>(null);
  useEffect(() => { setDraft(detail ? { ...detail } : null); }, [detail]);
  const [camOn, setCamOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function stopCam() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOn(false);
  }
  async function startCam() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      setCamOn(true);
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
    if (!v || !draft) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 640;
    canvas.height = v.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    setDraft({ ...draft, photo: canvas.toDataURL("image/jpeg", 0.7) });
    stopCam();
  }
  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !draft) return;
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image"); return; }
    const reader = new FileReader();
    reader.onload = () => setDraft({ ...draft, photo: String(reader.result) });
    reader.readAsDataURL(file);
  }
  useEffect(() => { if (!detail) stopCam(); }, [detail]);
  const open = items.filter((i) => !i.resolved);
  const resolved = items.filter((i) => i.resolved);

  function requestResolve(id: string) {
    if (!session) return;
    const item = items.find((i) => i.id === id);
    if (!item) return;
    if (!item.diagnostics || !item.diagnostics.trim()) {
      toast.error("Diagnostics required before resolving");
      setDetail(item);
      return;
    }
    const summary =
      (item.reason === "other" ? item.reasonOther : REASON_LABELS[item.reason]) +
      (item.associatedSku ? ` (${item.associatedSku})` : "");
    if (session.role === "developer") {
      maintenanceStore.resolve(id);
      toast.success("Resolved");
      return;
    }
    if (pending.maintenance.has(id)) {
      toast.message("Already awaiting approval");
      return;
    }
    approvalsStore.request(
      { type: "resolve_maintenance", maintenanceId: id, summary },
      session.username,
    );
    toast.success("Resolve request submitted for approval");
  }

  function saveDraft() {
    if (!draft) return;
    const { id, reason, reasonOther, associatedSku, note, diagnostics, photo } = draft;
    maintenanceStore.update(id, { reason, reasonOther, associatedSku, note, diagnostics, photo });
    toast.success("Saved");
    setDetail(null);
  }

  function saveAndResolve() {
    if (!draft) return;
    if (!draft.diagnostics || !draft.diagnostics.trim()) {
      toast.error("Diagnostics required before resolving");
      return;
    }
    const { id, reason, reasonOther, associatedSku, note, diagnostics, photo } = draft;
    maintenanceStore.update(id, { reason, reasonOther, associatedSku, note, diagnostics, photo });
    setDetail(null);
    requestResolve(id);
  }

  function printItem(it: MaintenanceItem) {
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    const reason = it.reason === "other" ? (it.reasonOther ?? "Other") : REASON_LABELS[it.reason];
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    document.body.appendChild(frame);
    const doc = frame.contentDocument ?? frame.contentWindow?.document;
    if (!doc) {
      frame.remove();
      toast.error("Could not prepare print view");
      return;
    }
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Maintenance ${esc(it.id)}</title>
      <style>
        body{font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;padding:32px;max-width:780px;margin:0 auto;}
        h1{font-size:18px;text-transform:uppercase;letter-spacing:.15em;margin:0 0 4px;}
        .meta{color:#666;font-size:11px;text-transform:uppercase;letter-spacing:.15em;margin-bottom:24px;}
        h2{font-size:11px;text-transform:uppercase;letter-spacing:.2em;color:#666;margin:24px 0 8px;border-bottom:1px solid #000;padding-bottom:4px;}
        .row{margin:6px 0;} .lbl{color:#666;text-transform:uppercase;font-size:10px;letter-spacing:.15em;}
        img{max-width:100%;max-height:360px;border:1px solid #ccc;margin-top:8px;}
        @media print{body{padding:0;}}
      </style></head><body>
      <h1>Maintenance — ${esc(reason)}</h1>
      <div class="meta">${esc(new Date(it.createdAt).toLocaleString())}${it.createdBy ? " · " + esc(it.createdBy) : ""}${it.resolved ? " · RESOLVED" : " · OPEN"}</div>
      ${it.associatedSku ? `<div class="row"><div class="lbl">SKU / P#</div><div>${esc(it.associatedSku)}</div></div>` : ""}
      ${it.note ? `<div class="row"><div class="lbl">Note</div><div>${esc(it.note)}</div></div>` : ""}
      ${it.diagnostics ? `<div class="row"><div class="lbl">Diagnostics</div><div>${esc(it.diagnostics)}</div></div>` : ""}
      ${it.resolvedAt ? `<div class="row"><div class="lbl">Resolved</div><div>${esc(new Date(it.resolvedAt).toLocaleString())}</div></div>` : ""}
      ${it.photo ? `<h2>Photo</h2><img src="${it.photo}" alt="">` : ""}
      </body></html>`);
    doc.close();
    setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 1000);
    }, 250);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Close
        </button>
        <h2 className="font-display text-3xl uppercase tracking-wide">Product Maintenance</h2>
        <div className="w-24" />
      </div>

      <Section title={`Open (${open.length})`}>
        {open.length === 0 ? (
          <EmptyState title="Nothing to resolve" description="Temporal items appear here when created from Products." />
        ) : (
          <List
            items={open}
            pendingIds={pending.maintenance}
            onResolve={requestResolve}
            onOpenDetail={setDetail}
            onPrint={printItem}
            onRemove={(id) => { if (confirm("Remove this item?")) { maintenanceStore.remove(id); } }}
          />
        )}
      </Section>

      {resolved.length > 0 && (
        <Section title={`Resolved (${resolved.length})`}>
          <List
            items={resolved}
            resolved
            onOpenDetail={setDetail}
            onPrint={printItem}
            onRemove={(id) => { if (confirm("Remove this item?")) { maintenanceStore.remove(id); } }}
          />
        </Section>
      )}

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-lg rounded-none border-2 border-foreground max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Maintenance item details</DialogTitle>
          </DialogHeader>
          {detail && draft && (
            <div className="space-y-4 text-sm">
              <div className="space-y-2">
                {camOn ? (
                  <>
                    <video ref={videoRef} className="max-h-72 w-full border-2 border-foreground/30 bg-black" muted playsInline />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={snap}><Camera className="h-4 w-4" /> Capture</Button>
                      <Button type="button" variant="outline" size="sm" onClick={stopCam}><X className="h-4 w-4" /> Cancel</Button>
                    </div>
                  </>
                ) : draft.photo ? (
                  <>
                    <img src={draft.photo} alt="" className="max-h-72 w-full object-contain border-2 border-foreground/20" />
                    {!detail.resolved && (
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={startCam}><Camera className="h-4 w-4" /> Replace (webcam)</Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Paperclip className="h-4 w-4" /> Replace (file)</Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setDraft({ ...draft, photo: undefined })}><Trash2 className="h-4 w-4" /> Remove</Button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex h-32 items-center justify-center border-2 border-dashed border-foreground/20 text-xs uppercase tracking-wider text-muted-foreground">No photo</div>
                    {!detail.resolved && (
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={startCam}><Camera className="h-4 w-4" /> Add image (webcam)</Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Paperclip className="h-4 w-4" /> Add image (file)</Button>
                      </div>
                    )}
                  </>
                )}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Reason</Label>
                <Select
                  value={draft.reason}
                  onValueChange={(v) => setDraft({ ...draft, reason: v as MaintenanceItem["reason"] })}
                  disabled={detail.resolved}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(REASON_LABELS) as MaintenanceItem["reason"][]).map((k) => (
                      <SelectItem key={k} value={k}>{REASON_LABELS[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {draft.reason === "other" && (
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Reason (other)</Label>
                  <Input value={draft.reasonOther ?? ""} onChange={(e) => setDraft({ ...draft, reasonOther: e.target.value })} disabled={detail.resolved} />
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">SKU / P#</Label>
                <Input value={draft.associatedSku ?? ""} onChange={(e) => setDraft({ ...draft, associatedSku: e.target.value })} disabled={detail.resolved} className="font-mono-tabular" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Note</Label>
                <Textarea value={draft.note ?? ""} onChange={(e) => setDraft({ ...draft, note: e.target.value })} disabled={detail.resolved} rows={2} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Diagnostics *</Label>
                <Textarea
                  value={draft.diagnostics ?? ""}
                  onChange={(e) => setDraft({ ...draft, diagnostics: e.target.value })}
                  disabled={detail.resolved}
                  rows={3}
                  placeholder="Required before resolving"
                />
              </div>
              <DetailRow label="Created" value={`${new Date(detail.createdAt).toLocaleString()}${detail.createdBy ? ` · ${detail.createdBy}` : ""}`} />
              <DetailRow label="Status" value={detail.resolved ? `Resolved${detail.resolvedAt ? ` · ${new Date(detail.resolvedAt).toLocaleString()}` : ""}` : (pending.maintenance.has(detail.id) ? "Awaiting approval" : "Open")} />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
            {detail && (
              <Button variant="outline" onClick={() => printItem(detail)}>
                <Printer /> Print
              </Button>
            )}
            {detail && !detail.resolved && (
              <>
                <Button variant="outline" onClick={saveDraft}>Save</Button>
                <Button
                  onClick={saveAndResolve}
                  disabled={!draft?.diagnostics?.trim() || pending.maintenance.has(detail.id)}
                  title={!draft?.diagnostics?.trim() ? "Diagnostics required" : ""}
                >
                  Save & Resolve
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono-tabular" : ""}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-2 border-foreground">
      <header className="border-b-2 border-foreground bg-foreground px-4 py-2 text-primary-foreground">
        <h3 className="font-display text-xs uppercase tracking-[0.2em]">{title}</h3>
      </header>
      <div className="p-4">{children}</div>
    </div>
  );
}

function List({
  items,
  onResolve,
  onRemove,
  resolved,
  pendingIds,
  onOpenDetail,
  onPrint,
}: {
  items: ReturnType<typeof useMaintenance>;
  onResolve?: (id: string) => void;
  onRemove: (id: string) => void;
  resolved?: boolean;
  pendingIds?: Set<string>;
  onOpenDetail?: (it: MaintenanceItem) => void;
  onPrint?: (it: MaintenanceItem) => void;
}) {
  return (
    <div className="space-y-3">
      {items.map((it) => {
        const isPending = pendingIds?.has(it.id);
        return (
        <div
          key={it.id}
          onDoubleClick={() => onOpenDetail?.(it)}
          className={`grid grid-cols-[auto_1fr_auto] items-start gap-4 border border-foreground/30 p-3 cursor-pointer select-none hover:bg-secondary ${isPending ? "opacity-60" : ""}`}
          title="Double-click to view details"
        >
          {it.photo ? (
            <img src={it.photo} alt="" className="h-24 w-24 object-cover border border-foreground/20" />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center border border-dashed border-foreground/20 text-[10px] uppercase tracking-wider text-muted-foreground">No photo</div>
          )}
          <div className="space-y-1 text-sm">
            <div className="font-semibold">
              {it.reason === "other" ? it.reasonOther : REASON_LABELS[it.reason]}
            </div>
            {it.associatedSku && (
              <div className="text-xs text-muted-foreground">SKU/P#: <span className="font-mono-tabular">{it.associatedSku}</span></div>
            )}
            {it.note && <div className="text-xs text-muted-foreground">{it.note}</div>}
            <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              {new Date(it.createdAt).toLocaleString()}{it.createdBy ? ` · ${it.createdBy}` : ""}
            </div>
          </div>
          <div className="flex gap-1">
            {onOpenDetail && (
              <Button variant="ghost" size="icon" onClick={() => onOpenDetail(it)} title="Document preview">
                <FileText />
              </Button>
            )}
            {onPrint && (
              <Button variant="ghost" size="icon" onClick={() => onPrint(it)} title="Print">
                <Printer />
              </Button>
            )}
            {!resolved && onResolve && (
              isPending ? (
                <Button variant="ghost" size="sm" disabled title="Awaiting developer approval" className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  <Clock /> Pending
                </Button>
              ) : (
                <Button variant="ghost" size="icon" onClick={() => onResolve(it.id)} title="Mark resolved">
                  <Check />
                </Button>
              )
            )}
            <Button variant="ghost" size="icon" onClick={() => onRemove(it.id)} title="Delete">
              <Trash2 />
            </Button>
          </div>
        </div>
        );
      })}
    </div>
  );
}
