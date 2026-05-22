import { useState, FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "@/lib/auth";
import { useRibbonTitle } from "@/lib/brandSettings";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

export function LoginScreen() {
  const { t } = useI18n();
  const ribbonTitle = useRibbonTitle();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      toast.error(t("Enter username and password"));
      return;
    }
    setSubmitting(true);
    const session = login(username, password);
    setSubmitting(false);
    if (!session) {
      toast.error(t("Invalid credentials"));
      return;
    }
    toast.success(t("Signed in as {username}", { username: session.username }));
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <h1 className="font-display text-3xl uppercase tracking-[0.2em]">
            {ribbonTitle || t("Sign in")}
          </h1>
        </div>

        <form onSubmit={onSubmit} className="space-y-5 border-2 border-foreground p-6">
          <div>
            <Label className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {t("Username")}
            </Label>
            <Input
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("dev or ops")}
            />
          </div>
          <div>
            <Label className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {t("Password")}
            </Label>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {t("Sign in")}
          </Button>
        </form>

        <p className="mt-6 text-center text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {t("Two roles · Developer · Operator")}
        </p>
      </div>
    </div>
  );
}
