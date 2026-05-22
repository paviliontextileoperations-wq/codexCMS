import { useState } from "react";
import { Plus, Trash2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { accountsStore, useAccounts, useSession, type Account } from "@/lib/auth";
import { toast } from "sonner";

export function AccessSettings() {
  const session = useSession();
  const accounts = useAccounts();
  const [pwFor, setPwFor] = useState<Account | null>(null);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newUser, setNewUser] = useState("");
  const [newUserPw, setNewUserPw] = useState("");

  const developers = accounts.filter((a) => a.role === "developer");
  const operators = accounts.filter((a) => a.role === "operator");

  function openChangePw(a: Account) {
    setPwFor(a);
    setNewPw("");
    setConfirmPw("");
  }

  function submitChangePw() {
    if (!pwFor) return;
    if (!newPw || newPw.length < 4) {
      toast.error("Password must be at least 4 characters");
      return;
    }
    if (newPw !== confirmPw) {
      toast.error("Passwords do not match");
      return;
    }
    if (accountsStore.setPassword(pwFor.username, newPw)) {
      toast.success(`Password updated for ${pwFor.username}`);
      setPwFor(null);
    } else {
      toast.error("Account not found");
    }
  }

  function submitCreate() {
    const res = accountsStore.createOperator(newUser, newUserPw);
    if (!res.ok) {
      toast.error(res.error ?? "Could not create account");
      return;
    }
    toast.success(`Operator "${newUser.trim()}" created`);
    setNewUser("");
    setNewUserPw("");
    setCreateOpen(false);
  }

  function removeOperator(a: Account) {
    if (!confirm(`Delete operator "${a.username}"? They will no longer be able to sign in.`)) return;
    if (session?.username.toLowerCase() === a.username.toLowerCase()) {
      toast.error("You cannot delete the account you are signed in as");
      return;
    }
    if (accountsStore.remove(a.username)) {
      toast.success(`Removed "${a.username}"`);
    }
  }

  return (
    <div className="border-2 border-foreground/10 p-8">
      <div className="mb-6 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        Access · Accounts and passwords
      </div>

      {/* Developers */}
      <div className="mb-10">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider">Developers</h3>
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Full access
          </span>
        </div>
        <AccountTable
          accounts={developers}
          currentUser={session?.username}
          onChangePassword={openChangePw}
        />
      </div>

      {/* Operators */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider">Operators</h3>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus /> New operator
          </Button>
        </div>
        {operators.length === 0 ? (
          <div className="border-2 border-dashed border-foreground/10 p-6 text-center text-sm text-muted-foreground">
            No operator accounts yet.
          </div>
        ) : (
          <AccountTable
            accounts={operators}
            currentUser={session?.username}
            onChangePassword={openChangePw}
            onRemove={removeOperator}
          />
        )}
      </div>

      {/* Change password dialog */}
      <Dialog open={!!pwFor} onOpenChange={(o) => !o && setPwFor(null)}>
        <DialogContent className="max-w-md rounded-none border-2 border-foreground">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              Change password
            </DialogTitle>
          </DialogHeader>
          {pwFor && (
            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between border-2 border-foreground/10 px-3 py-2">
                <span className="text-muted-foreground text-xs uppercase tracking-wider">
                  Account
                </span>
                <span className="font-mono-tabular">
                  {pwFor.username} · {pwFor.role}
                </span>
              </div>
              <div>
                <Label className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  New password
                </Label>
                <Input
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <Label className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Confirm password
                </Label>
                <Input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwFor(null)}>
              Cancel
            </Button>
            <Button onClick={submitChangePw}>
              <KeyRound /> Update password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create operator dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md rounded-none border-2 border-foreground">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">New operator</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div>
              <Label className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Username
              </Label>
              <Input
                value={newUser}
                onChange={(e) => setNewUser(e.target.value)}
                placeholder="e.g. ops2"
                autoFocus
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Password
              </Label>
              <Input
                type="password"
                value={newUserPw}
                onChange={(e) => setNewUserPw(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitCreate}>
              <Plus /> Create operator
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccountTable({
  accounts,
  currentUser,
  onChangePassword,
  onRemove,
}: {
  accounts: Account[];
  currentUser?: string;
  onChangePassword: (a: Account) => void;
  onRemove?: (a: Account) => void;
}) {
  return (
    <div className="border-2 border-foreground/10">
      <div className="grid grid-cols-[1fr_120px_180px] gap-2 border-b border-foreground/10 bg-muted/40 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        <span>Username</span>
        <span>Role</span>
        <span className="text-right">Actions</span>
      </div>
      {accounts.map((a) => {
        const isMe = currentUser?.toLowerCase() === a.username.toLowerCase();
        return (
          <div
            key={a.username}
            className="grid grid-cols-[1fr_120px_180px] items-center gap-2 border-b border-foreground/5 px-3 py-2 text-sm last:border-b-0"
          >
            <span className="truncate font-mono-tabular">
              {a.username}
              {isMe && (
                <span className="ml-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  (you)
                </span>
              )}
            </span>
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              {a.role}
            </span>
            <div className="flex justify-end gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onChangePassword(a)}
                title="Change password"
              >
                <KeyRound /> Password
              </Button>
              {onRemove && !isMe && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onRemove(a)}
                  title="Remove account"
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}