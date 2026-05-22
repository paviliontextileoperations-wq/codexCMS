import { useMemo, useState } from "react";
import { Undo2, Trash2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { SectionHeader } from "./SectionHeader";
import { EmptyState } from "./EmptyState";
import { useOpLog, undoEntry, clearLog, describeEntry, diffEntry, type OpLogEntry } from "@/lib/opLog";
import { toast } from "sonner";

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString();
}

export function OpLogView() {
  const log = useOpLog();
  const [viewing, setViewing] = useState<OpLogEntry | null>(null);

  const entries = useMemo(() => log, [log]);

  function handleUndo(e: OpLogEntry) {
    if (e.undone) return;
    if (!confirm(`Undo this change to "${e.label}"?`)) return;
    const ok = undoEntry(e.id);
    if (ok) toast.success("Change reverted");
    else toast.error("Could not undo this change");
  }

  function handleClear() {
    if (!confirm("Clear the entire operational log? This cannot be undone.")) return;
    clearLog();
    toast.success("Log cleared");
  }

  return (
    <>
      <SectionHeader
        title="Operational log"
        actions={
          entries.length > 0 ? (
            <Button variant="outline" onClick={handleClear}>
              <Trash2 /> Clear log
            </Button>
          ) : null
        }
      />

      {entries.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Changes to products, customers, sales and accounts will appear here."
        />
      ) : (
        <div className="border-2 border-foreground">
          <table className="w-full text-sm">
            <thead className="bg-foreground text-primary-foreground">
              <tr className="text-left">
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[11px]">When</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[11px]">User</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[11px]">Area</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[11px]">Change</th>
                <th className="px-4 py-3 text-right font-semibold uppercase tracking-wider text-[11px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const details = diffEntry(e);
                const preview = details.slice(0, 4);
                const more = details.length - preview.length;
                return (
                <tr key={e.id} className="border-t border-foreground/10 hover:bg-secondary align-top">
                  <td className="px-4 py-3 font-mono-tabular text-xs whitespace-nowrap">{fmtTime(e.timestamp)}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    {e.user ? `${e.user} (${e.role})` : "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{e.label}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <div className="font-medium text-foreground">{describeEntry(e)}</div>
                    {preview.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-[11px] font-mono-tabular">
                        {preview.map((d, i) => (
                          <li key={i} className="break-all">• {d}</li>
                        ))}
                        {more > 0 && (
                          <li className="text-muted-foreground/70">…and {more} more change(s)</li>
                        )}
                      </ul>
                    )}
                    {e.undone && (
                      <span className="mt-1 inline-flex items-center bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-[0.15em]">
                        Undone
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="View details"
                        onClick={() => setViewing(e)}
                      >
                        <Eye />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={e.undone ? "Already undone" : "Undo this change"}
                        disabled={e.undone}
                        onClick={() => handleUndo(e)}
                      >
                        <Undo2 />
                      </Button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-3xl rounded-none border-2 border-foreground">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              {viewing?.label ?? "Change"} — {viewing && fmtTime(viewing.timestamp)}
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Changes
                </div>
                <div className="border-2 border-foreground bg-secondary p-3 text-[11px] font-mono-tabular max-h-[40vh] overflow-auto">
                  {(() => {
                    const lines = diffEntry(viewing);
                    if (!lines.length) return <div className="text-muted-foreground">No detectable field changes.</div>;
                    return (
                      <ul className="space-y-0.5">
                        {lines.map((l, i) => <li key={i} className="break-all">• {l}</li>)}
                      </ul>
                    );
                  })()}
                </div>
              </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Before
                </div>
                <pre className="max-h-[50vh] overflow-auto border-2 border-foreground bg-secondary p-3 text-[11px]">
{JSON.stringify(viewing.prev, null, 2)}
                </pre>
              </div>
              <div>
                <div className="mb-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  After
                </div>
                <pre className="max-h-[50vh] overflow-auto border-2 border-foreground bg-secondary p-3 text-[11px]">
{JSON.stringify(viewing.next, null, 2)}
                </pre>
              </div>
            </div>
            </div>
          )}
          <DialogFooter>
            {viewing && !viewing.undone && (
              <Button
                variant="outline"
                onClick={() => {
                  if (handleUndoFromDialog(viewing)) setViewing(null);
                }}
              >
                <Undo2 /> Undo this change
              </Button>
            )}
            <Button variant="outline" onClick={() => setViewing(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function handleUndoFromDialog(e: OpLogEntry): boolean {
  if (e.undone) return false;
  if (!confirm(`Undo this change to "${e.label}"?`)) return false;
  const ok = undoEntry(e.id);
  if (ok) toast.success("Change reverted");
  else toast.error("Could not undo this change");
  return ok;
}