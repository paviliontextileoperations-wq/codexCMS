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
import {
  useOpLog,
  undoEntry,
  clearLog,
  describeEntry,
  diffEntry,
  canUndoEntry,
  type OpLogEntry,
} from "@/lib/opLog";
import { toast } from "sonner";

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function OpLogView() {
  const log = useOpLog();
  const [viewing, setViewing] = useState<OpLogEntry | null>(null);
  const entries = useMemo(() => log, [log]);

  function handleUndo(entry: OpLogEntry): boolean {
    if (!canUndoEntry(entry)) return false;
    if (!confirm(`确认撤销这条「${entry.label}」变动吗？`)) return false;
    const ok = undoEntry(entry.id);
    if (ok) toast.success("已撤销该变动");
    else toast.error("无法撤销该变动");
    return ok;
  }

  function handleClear() {
    if (!confirm("确认清空全部操作日志吗？这个操作不能撤销。")) return;
    clearLog();
    toast.success("日志已清空");
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
              {entries.map((entry) => {
                const details = diffEntry(entry);
                const preview = details.slice(0, 4);
                const more = details.length - preview.length;
                return (
                  <tr key={entry.id} className="border-t border-foreground/10 hover:bg-secondary align-top">
                    <td className="px-4 py-3 font-mono-tabular text-xs whitespace-nowrap">{fmtTime(entry.timestamp)}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {entry.user ? `${entry.user} (${entry.role})` : "-"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{entry.label}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <div className="font-medium text-foreground">{describeEntry(entry)}</div>
                      {preview.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-[11px] font-mono-tabular">
                          {preview.map((detail, i) => (
                            <li key={i} className="break-all">- {detail}</li>
                          ))}
                          {more > 0 && (
                            <li className="text-muted-foreground/70">还有 {more} 项变动</li>
                          )}
                        </ul>
                      )}
                      {entry.undone && (
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
                          onClick={() => setViewing(entry)}
                        >
                          <Eye />
                        </Button>
                        {canUndoEntry(entry) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="撤销这条变动"
                            onClick={() => handleUndo(entry)}
                          >
                            <Undo2 />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-3xl rounded-none border-2 border-foreground">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              {viewing?.label ?? "Change"} - {viewing && fmtTime(viewing.timestamp)}
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
                        {lines.map((line, i) => <li key={i} className="break-all">- {line}</li>)}
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
            {viewing && canUndoEntry(viewing) && (
              <Button
                variant="outline"
                onClick={() => {
                  if (handleUndo(viewing)) setViewing(null);
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
