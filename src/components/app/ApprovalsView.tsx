import { useState } from "react";
import { Check, X, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "./SectionHeader";
import { EmptyState } from "./EmptyState";
import {
  approvalsStore,
  describeAction,
  useApprovals,
  type ApprovalAction,
  type ApprovalRequest,
} from "@/lib/approvals";
import { useSession } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function ActionDetails({ action }: { action: ApprovalAction }) {
  if (action.type === "settings_change") {
    return (
      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
        {action.changes.map((c, i) => {
          if (c.kind === "localStorage") {
            return (
              <li key={i}>
                <span className="font-mono-tabular">{c.key}</span>: {c.previous ?? "—"} → {c.value}
              </li>
            );
          }
          if (c.kind === "ribbonTitle") {
            return (
              <li key={i}>
                Ribbon title: <strong>{c.previous}</strong> → <strong>{c.value}</strong>
              </li>
            );
          }
          return (
            <li key={i}>
              {c.customerName} tax rate: {c.previous ?? "default"} → {c.value ?? "default"}
            </li>
          );
        })}
      </ul>
    );
  }
  return null;
}

export function ApprovalsView() {
  const session = useSession();
  const all = useApprovals();
  const [declineFor, setDeclineFor] = useState<ApprovalRequest | null>(null);
  const [reason, setReason] = useState("");

  const pending = all.filter((r) => r.status === "pending");
  const resolved = all.filter((r) => r.status !== "pending");

  function approve(req: ApprovalRequest) {
    if (!session) return;
    approvalsStore.approve(req.id, session.username);
    toast.success("Approved & executed");
  }

  function openDecline(req: ApprovalRequest) {
    setDeclineFor(req);
    setReason("");
  }

  function confirmDecline() {
    if (!session || !declineFor) return;
    approvalsStore.decline(declineFor.id, session.username, reason.trim() || undefined);
    toast.success("Declined");
    setDeclineFor(null);
  }

  return (
    <>
      <SectionHeader
        title="Approvals"
        actions={
          resolved.length > 0 ? (
            <Button variant="outline" onClick={() => approvalsStore.clearResolved()}>
              Clear history
            </Button>
          ) : null
        }
      />

      <div className="mb-3 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        Pending · {pending.length}
      </div>

      {pending.length === 0 ? (
        <EmptyState title="No pending requests" description="Operator-restricted actions will appear here for approval." />
      ) : (
        <div className="space-y-3">
          {pending.map((req) => (
            <div key={req.id} className="border-2 border-foreground p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    Requested by {req.requestedBy} · {fmtDate(req.requestedAt)}
                  </div>
                  <div className="mt-1 font-display text-lg">{describeAction(req.action)}</div>
                  <ActionDetails action={req.action} />
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="outline" onClick={() => openDecline(req)}>
                    <X /> Decline
                  </Button>
                  <Button size="sm" onClick={() => approve(req)}>
                    <Check /> Approve
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <>
          <div className="mt-10 mb-3 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            History
          </div>
          <div className="border-2 border-foreground/20">
            {resolved.map((req) => (
              <div
                key={req.id}
                className="flex items-start justify-between gap-4 border-b border-foreground/10 px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    {req.requestedBy} → {req.resolvedBy} · {req.resolvedAt ? fmtDate(req.resolvedAt) : ""}
                  </div>
                  <div className="text-sm">{describeAction(req.action)}</div>
                  {req.declineReason && (
                    <div className="text-xs text-muted-foreground">Reason: {req.declineReason}</div>
                  )}
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 border-2 border-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em]",
                    req.status === "approved"
                      ? "bg-foreground text-primary-foreground"
                      : "bg-bauhaus-red text-primary-foreground",
                  )}
                >
                  {req.status === "approved" ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  {req.status}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={!!declineFor} onOpenChange={(o) => !o && setDeclineFor(null)}>
        <DialogContent className="max-w-md rounded-none border-2 border-foreground">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Decline request</DialogTitle>
          </DialogHeader>
          {declineFor && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>{describeAction(declineFor.action)}</span>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Reason (optional)
                </label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineFor(null)}>
              Cancel
            </Button>
            <Button onClick={confirmDecline}>Confirm decline</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}