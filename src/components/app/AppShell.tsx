import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useRibbonTitle } from "@/lib/brandSettings";
import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { logout, useSession } from "@/lib/auth";
import { usePendingApprovalsCount } from "@/lib/approvals";
import { useSales } from "@/hooks/useStore";
import { LogOut } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { CloudSyncStatus } from "./CloudSyncStatus";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type TabKey =
  | "pos"
  | "products"
  | "customers"
  | "sales"
  | "invoices"
  | "images"
  | "inventory"
  | "settings"
  | "approvals"
  | "oplog";

const BASE_TABS: { key: TabKey; label: string; n: string; developerOnly?: boolean }[] = [
  { key: "pos", label: "POS", n: "01" },
  { key: "products", label: "Products", n: "02" },
  { key: "customers", label: "Customers", n: "03" },
  { key: "sales", label: "ORDERS", n: "04" },
  { key: "invoices", label: "Invoices", n: "05" },
  { key: "images", label: "Images", n: "06" },
  { key: "inventory", label: "Inventory", n: "07" },
  { key: "approvals", label: "Approvals", n: "08", developerOnly: true },
  { key: "oplog", label: "Log", n: "09", developerOnly: true },
  { key: "settings", label: "Settings", n: "10" },
];

export function AppShell({
  active,
  onChange,
  children,
}: {
  active: TabKey;
  onChange: (k: TabKey) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const ribbonTitle = useRibbonTitle();
  const [open, setOpen] = useState(false);
  const session = useSession();
  const pendingCount = usePendingApprovalsCount();
  const [sales] = useSales();
  const pendingOrdersCount = sales.filter((s) => {
    if (s.documentStatus === "cancelled" || s.documentStatus === "converted") return false;
    const ds =
      s.deliveryStatus ??
      ((s.documentType ?? "INVOICE") === "DELIVERY_NOTE" ? "open" : "open");
    return ds !== "completed" && ds !== "delivered" && ds !== "picked_up_client" && ds !== "returned";
  }).length;
  const unpaidCount = sales.filter((s) => {
    if (s.documentStatus === "cancelled" || s.documentStatus === "converted") return false;
    return (s.paymentStatus ?? "PAID") !== "PAID";
  }).length;
  const draftInvoicesCount = sales.filter((s) => {
    if (s.documentStatus === "cancelled" || s.documentStatus === "converted") return false;
    return (s.invoiceNumber ?? "").startsWith("DRAFT-") || (s.paymentStatus ?? "PAID") !== "PAID";
  }).length;
  const [logoutOpen, setLogoutOpen] = useState(false);
  const TABS = BASE_TABS.filter((t) => !t.developerOnly || session?.role === "developer");
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="relative mx-auto flex max-w-[1400px] items-center justify-center px-6 py-4">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              aria-label={t("Open menu")}
              className="absolute left-6 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-foreground hover:opacity-70 transition-opacity"
            >
              <ZaraBurger open={open} />
            </SheetTrigger>
            <SheetContent
              side="left"
              hideClose
              overlayClassName="bg-background/0"
              className="w-screen max-w-none sm:max-w-none p-0 flex items-center justify-center bg-background/80 backdrop-blur-md data-[state=open]:slide-in-from-left-0 data-[state=closed]:slide-out-to-left-0 data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:duration-500 data-[state=closed]:!duration-500"
            >
              <SheetTitle className="sr-only">{t("Main menu")}</SheetTitle>
              <SheetDescription className="sr-only">{t("Choose a section")}</SheetDescription>
              <div className="relative mx-auto w-full max-w-[1400px] px-6 h-full flex items-center justify-center">
                <button
                  type="button"
                  aria-label={t("Close menu")}
                  onClick={() => setOpen(false)}
                  className="absolute inset-0 cursor-default"
                />
                <button
                  aria-label={t("Close menu")}
                  onClick={() => setOpen(false)}
                  className="absolute left-6 top-[30px] -translate-y-1/2 inline-flex items-center justify-center text-foreground hover:opacity-70 transition-opacity z-10"
                >
                  <ZaraBurger open={true} />
                </button>
                <nav
                  className="relative z-10 flex flex-col items-center justify-center gap-6"
                >
                {TABS.map((tab) => {
                  const isActive = tab.key === active;
                  const badgeCount =
                    tab.key === "approvals"
                      ? pendingCount
                      : tab.key === "sales"
                      ? pendingOrdersCount
                      : tab.key === "invoices"
                      ? draftInvoicesCount
                      : 0;
                  const showBadge = badgeCount > 0;
                  const showUnpaid = tab.key === "sales" && unpaidCount > 0;
                  return (
                    <button
                      key={tab.key}
                      onClick={() => {
                        onChange(tab.key);
                        setOpen(false);
                      }}
                      className={cn(
                        "relative text-center font-display uppercase tracking-wide transition-colors",
                        isActive
                          ? "text-foreground text-3xl md:text-5xl"
                          : "text-muted-foreground/50 hover:text-foreground text-3xl md:text-5xl",
                      )}
                    >
                      {t(tab.label)}
                      {(showBadge || showUnpaid) && (
                        <span className="absolute left-full top-0 ml-3 inline-flex items-center gap-1">
                          {showBadge && (
                            <span
                              className={cn(
                                "inline-flex h-6 min-w-6 items-center justify-center px-1.5 text-xs font-semibold leading-none font-sans tracking-normal",
                                tab.key === "approvals"
                                  ? "bg-bauhaus-red text-primary-foreground"
                                  : "bg-bauhaus-yellow text-foreground",
                              )}
                            >
                              {badgeCount}
                            </span>
                          )}
                          {showUnpaid && (
                            <span className="inline-flex h-6 min-w-6 items-center justify-center bg-bauhaus-red px-1.5 text-xs font-semibold leading-none text-primary-foreground font-sans tracking-normal">
                              {unpaidCount}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
                </nav>
              </div>
            </SheetContent>
          </Sheet>
          {ribbonTitle && (
            <h1
              className="truncate px-4 text-center font-display text-base uppercase tracking-[0.3em] sm:text-lg"
              title={ribbonTitle}
            >
              {ribbonTitle}
            </h1>
          )}
          {session && (
            <div className="absolute right-6 top-1/2 flex -translate-y-1/2 items-center gap-3">
              <CloudSyncStatus />
              <button
                onClick={() => setLogoutOpen(true)}
                className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-foreground"
                title={t("Sign out")}
              >
                <span className="hidden sm:inline">
                  {session.username} · {t(session.role)}
                </span>
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-6 py-8">{children}</main>
      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Sign out?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {session
                ? t("You are signed in as {username} ({role}).", {
                    username: session.username,
                    role: t(session.role),
                  })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => logout()}>{t("Sign out")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ZaraBurger({ open }: { open: boolean }) {
  // Two thin lines that morph into an X. Both stay centered in the same spot.
  return (
    <svg
      width="66"
      height="66"
      viewBox="0 0 44 44"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="butt"
      aria-hidden="true"
      className="overflow-visible"
    >
      <line
        x1="8"
        y1="22"
        x2="36"
        y2="22"
        className="origin-center transition-transform duration-300 ease-out"
        style={{
          transform: open ? "rotate(45deg) translateY(0)" : "translateY(-5px)",
          transformBox: "fill-box",
          transformOrigin: "center",
        }}
      />
      <line
        x1="8"
        y1="22"
        x2="36"
        y2="22"
        className="origin-center transition-transform duration-300 ease-out"
        style={{
          transform: open ? "rotate(-45deg) translateY(0)" : "translateY(5px)",
          transformBox: "fill-box",
          transformOrigin: "center",
        }}
      />
    </svg>
  );
}
