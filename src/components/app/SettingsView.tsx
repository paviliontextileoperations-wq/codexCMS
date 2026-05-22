import { useEffect, useState } from "react";
import { SectionHeader } from "./SectionHeader";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { toast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { useCustomers } from "@/hooks/useStore";
import { customersStore } from "@/lib/storage";
import { TAX_KEYS, DEFAULT_TAX, getDefaultTaxRates, BUSINESS_TYPE_TAX } from "@/lib/taxSettings";
import { TRANSPORT_KEYS, DEFAULT_TRANSPORT_FEE, getDefaultTransportFee } from "@/lib/transportSettings";
import {
  PICKUP_ADDRESS,
  quoteTransport,
  ES_PROVINCE_OPTIONS,
  INTL_COUNTRY_OPTIONS,
} from "@/lib/transportRates";
import { getRibbonTitle, setRibbonTitle, DEFAULT_RIBBON_TITLE } from "@/lib/brandSettings";
import { getSerialConfig, setSerialConfig, formatSerial, DEFAULT_SERIAL } from "@/lib/serialSettings";
import { getCompanyInfo, setCompanyInfo, DEFAULT_COMPANY } from "@/lib/companySettings";
import { BUSINESS_TYPES, type Customer, type SaleDocumentType } from "@/types";
import { useSession } from "@/lib/auth";
import { approvalsStore, usePendingDeletes, type ApprovalAction } from "@/lib/approvals";
import { AccessSettings } from "./AccessSettings";
import { getColours, setColours, generateColourCode, type Colour, subscribeColours } from "@/lib/colourSettings";
import { Trash2 } from "lucide-react";
import { LANGUAGES, getLanguageLabel, useI18n, type Language } from "@/lib/i18n";
import {
  DEFAULT_B2C_MARKUP_PERCENT,
  PRODUCT_SETTING_KEYS,
  getDefaultB2cMarkupPercent,
  setDefaultB2cMarkupPercent,
} from "@/lib/productSettings";

type SettingsTab = "general" | "products" | "stock" | "sales" | "customers" | "transport" | "access";

const SUB_TABS: { key: SettingsTab; label: string; n: string; developerOnly?: boolean }[] = [
  { key: "general", label: "General", n: "01" },
  { key: "products", label: "Products", n: "02" },
  { key: "stock", label: "Stock", n: "03", developerOnly: true },
  { key: "sales", label: "Sales", n: "04", developerOnly: true },
  { key: "customers", label: "Customers", n: "05", developerOnly: true },
  { key: "transport", label: "Transport", n: "06" },
  { key: "access", label: "Access", n: "07", developerOnly: true },
];

function Placeholder({ title }: { title: string }) {
  return (
    <div className="border-2 border-foreground/10 p-10 text-center">
      <div className="mb-2 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        {title} settings
      </div>
      <p className="text-sm text-muted-foreground">
        Configuration for this section will be added here.
      </p>
    </div>
  );
}

function GeneralSettings() {
  const { language: savedLang, setLanguage, t } = useI18n();
  const session = useSession();
  const isDeveloper = session?.role === "developer";
  const [pendingLang, setPendingLang] = useState<Language>(savedLang);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    setPendingLang(savedLang);
  }, [savedLang]);

  const handleApply = () => {
    if (pendingLang === savedLang) {
      toast({
        title: t("No changes"),
        description: t("Language is already set to {language}", { language: getLanguageLabel(savedLang) }),
      });
      return;
    }
    setConfirmOpen(true);
  };

  const confirmChange = () => {
    setLanguage(pendingLang);
    setConfirmOpen(false);
    toast({
      title: "Language updated",
      description: `Now set to ${getLanguageLabel(pendingLang)}`,
    });
  };

  const revertChange = () => {
    setPendingLang(savedLang);
    setConfirmOpen(false);
  };

  return (
    <div className="border-2 border-foreground/10 p-8">
      <div className="mb-6 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        {t("General settings")}
      </div>

      <div className="max-w-md space-y-4">
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider">
            {t("Language")}
          </label>
          <Select value={pendingLang} onValueChange={(v) => setPendingLang(v as Language)}>
            <SelectTrigger>
              <SelectValue placeholder={t("Select language")} />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((item) => (
                <SelectItem key={item.code} value={item.code}>
                  {item.nativeName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("Currently active:")}{" "}
            <span className="font-medium text-foreground">{getLanguageLabel(savedLang)}</span>
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleApply} disabled={pendingLang === savedLang}>
            {t("Apply")}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Confirm language change?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Change language from")} <strong>{getLanguageLabel(savedLang)}</strong> {t("to")}{" "}
              <strong>{getLanguageLabel(pendingLang)}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={revertChange}>{t("Revert")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmChange}>{t("Confirm change")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isDeveloper && (
        <div className="mt-10 border-t-2 border-foreground/10 pt-8">
          <RibbonTitleSettings />
        </div>
      )}

      {isDeveloper && (
        <div className="mt-10 border-t-2 border-foreground/10 pt-8">
          <TaxSettings />
        </div>
      )}

      {isDeveloper && (
        <div className="mt-10 border-t-2 border-foreground/10 pt-8">
          <CompanyInfoSettings />
        </div>
      )}
    </div>
  );
}

function TaxSettings() {
  // (defined below)
  return <TaxSettingsImpl />;
}

function CompanyInfoSettings() {
  const [saved, setSaved] = useState(() => getCompanyInfo());
  const [pending, setPending] = useState(saved);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const dirty =
    pending.companyName.trim() !== saved.companyName ||
    pending.vatNumber.trim() !== saved.vatNumber ||
    pending.address.trim() !== saved.address ||
    pending.beneficiary.trim() !== saved.beneficiary ||
    pending.bank.trim() !== saved.bank ||
    pending.swift.trim() !== saved.swift;

  const valid =
    pending.companyName.trim().length > 0 &&
    pending.vatNumber.trim().length > 0;

  function handleApply() {
    if (!valid) {
      toast({ title: "Required fields missing", description: "Company name and VAT/CIF are required." });
      return;
    }
    setConfirmOpen(true);
  }

  function confirmChange() {
    const next = {
      companyName: pending.companyName.trim(),
      vatNumber: pending.vatNumber.trim(),
      address: pending.address.trim(),
      beneficiary: pending.beneficiary.trim(),
      bank: pending.bank.trim(),
      swift: pending.swift.trim(),
    };
    setCompanyInfo(next);
    setSaved(next);
    setPending(next);
    setConfirmOpen(false);
    toast({ title: "Company information saved" });
  }

  function revertChange() {
    setPending(saved);
    setConfirmOpen(false);
  }

  return (
    <div>
      <div className="mb-6 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        Company information
      </div>

      <div className="max-w-2xl space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider">
              Company name
            </label>
            <Input
              value={pending.companyName}
              onChange={(e) => setPending((p) => ({ ...p, companyName: e.target.value }))}
              placeholder={DEFAULT_COMPANY.companyName}
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider">
              EU VAT / CIF
            </label>
            <Input
              value={pending.vatNumber}
              onChange={(e) => setPending((p) => ({ ...p, vatNumber: e.target.value }))}
              placeholder={DEFAULT_COMPANY.vatNumber}
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider">
            Address
          </label>
          <textarea
            value={pending.address}
            onChange={(e) => setPending((p) => ({ ...p, address: e.target.value }))}
            placeholder={DEFAULT_COMPANY.address}
            rows={3}
            className="flex w-full rounded-none border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-foreground focus-visible:ring-1 focus-visible:ring-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <div className="border-2 border-foreground/10 p-4">
          <div className="mb-3 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            Payment details
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider">
                Beneficiary
              </label>
              <Input
                value={pending.beneficiary}
                onChange={(e) => setPending((p) => ({ ...p, beneficiary: e.target.value }))}
                placeholder={DEFAULT_COMPANY.beneficiary}
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider">
                Bank / IBAN
              </label>
              <Input
                value={pending.bank}
                onChange={(e) => setPending((p) => ({ ...p, bank: e.target.value }))}
                placeholder={DEFAULT_COMPANY.bank}
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider">
                Swift
              </label>
              <Input
                value={pending.swift}
                onChange={(e) => setPending((p) => ({ ...p, swift: e.target.value }))}
                placeholder={DEFAULT_COMPANY.swift}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleApply} disabled={!dirty || !valid}>
            Apply
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm company information changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Update company details and payment information.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={revertChange}>Revert</AlertDialogCancel>
            <AlertDialogAction onClick={confirmChange}>Confirm change</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const DOC_LABELS: { key: SaleDocumentType; label: string; hint: string }[] = [
  { key: "INVOICE", label: "Invoice", hint: "B2B invoice" },
  { key: "DELIVERY_NOTE", label: "Delivery note", hint: "B2B note" },
  { key: "RECEIPT", label: "Receipt", hint: "B2C receipt / return" },
  { key: "PROFORMA", label: "Proforma", hint: "B2B proforma" },
];

function SerialSettings() {
  const initial = {
    INVOICE: getSerialConfig("INVOICE"),
    DELIVERY_NOTE: getSerialConfig("DELIVERY_NOTE"),
    RECEIPT: getSerialConfig("RECEIPT"),
    PROFORMA: getSerialConfig("PROFORMA"),
  } as Record<SaleDocumentType, { prefix: string; counter: number }>;
  const [saved, setSaved] = useState(initial);
  const [pending, setPending] = useState<Record<SaleDocumentType, { prefix: string; counter: string }>>({
    INVOICE: { prefix: initial.INVOICE.prefix, counter: String(initial.INVOICE.counter) },
    DELIVERY_NOTE: { prefix: initial.DELIVERY_NOTE.prefix, counter: String(initial.DELIVERY_NOTE.counter) },
    RECEIPT: { prefix: initial.RECEIPT.prefix, counter: String(initial.RECEIPT.counter) },
    PROFORMA: { prefix: initial.PROFORMA.prefix, counter: String(initial.PROFORMA.counter) },
  });
  const [confirmOpen, setConfirmOpen] = useState(false);

  const dirty = DOC_LABELS.some((d) => {
    const p = pending[d.key];
    const s = saved[d.key];
    const n = parseInt(p.counter, 10);
    return p.prefix.trim() !== s.prefix || (Number.isFinite(n) && n !== s.counter);
  });
  const valid = DOC_LABELS.every((d) => {
    const p = pending[d.key];
    const n = parseInt(p.counter, 10);
    return p.prefix.trim().length > 0 && Number.isFinite(n) && n >= 1;
  });

  function handleApply() {
    if (!valid) {
      toast({ title: "Invalid serial", description: "Letters required and number must be ≥ 1." });
      return;
    }
    setConfirmOpen(true);
  }

  function confirmChange() {
    const nextSaved = { ...saved };
    DOC_LABELS.forEach((d) => {
      const p = pending[d.key];
      const prefix = p.prefix.trim();
      const counter = parseInt(p.counter, 10);
      setSerialConfig(d.key, prefix, counter);
      nextSaved[d.key] = { prefix, counter };
    });
    setSaved(nextSaved);
    setConfirmOpen(false);
    toast({ title: "Serial settings saved" });
  }

  function revertChange() {
    setPending({
      INVOICE: { prefix: saved.INVOICE.prefix, counter: String(saved.INVOICE.counter) },
      DELIVERY_NOTE: { prefix: saved.DELIVERY_NOTE.prefix, counter: String(saved.DELIVERY_NOTE.counter) },
      RECEIPT: { prefix: saved.RECEIPT.prefix, counter: String(saved.RECEIPT.counter) },
      PROFORMA: { prefix: saved.PROFORMA.prefix, counter: String(saved.PROFORMA.counter) },
    });
    setConfirmOpen(false);
  }

  return (
    <div>
      <div className="mb-6 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        Document numbering
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Set the letter prefix and current number for each document sequence. Defaults: Invoice{" "}
        <span className="font-mono-tabular">{DEFAULT_SERIAL.INVOICE.prefix}</span>, Delivery note{" "}
        <span className="font-mono-tabular">{DEFAULT_SERIAL.DELIVERY_NOTE.prefix}</span>, Receipt{" "}
        <span className="font-mono-tabular">{DEFAULT_SERIAL.RECEIPT.prefix}</span>, Proforma{" "}
        <span className="font-mono-tabular">{DEFAULT_SERIAL.PROFORMA.prefix}</span>.
      </p>

      <div className="space-y-3">
        {DOC_LABELS.map((d) => {
          const p = pending[d.key];
          const n = parseInt(p.counter, 10);
          const preview = p.prefix.trim() && Number.isFinite(n)
            ? formatSerial(p.prefix.trim(), n)
            : "—";
          return (
            <div
              key={d.key}
              className="grid max-w-2xl grid-cols-[1fr_140px_140px_1fr] items-end gap-3 border-2 border-foreground/10 p-3"
            >
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider">{d.label}</div>
                <div className="text-[10px] text-muted-foreground">{d.hint}</div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
                  Letters
                </label>
                <Input
                  value={p.prefix}
                  onChange={(e) =>
                    setPending((prev) => ({ ...prev, [d.key]: { ...prev[d.key], prefix: e.target.value } }))
                  }
                  className="font-mono-tabular"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
                  Current №
                </label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={p.counter}
                  onChange={(e) =>
                    setPending((prev) => ({ ...prev, [d.key]: { ...prev[d.key], counter: e.target.value } }))
                  }
                  className="font-mono-tabular"
                />
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Next</div>
                <div className="font-mono-tabular text-sm">{preview}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex max-w-2xl justify-end">
        <Button onClick={handleApply} disabled={!dirty || !valid}>
          Apply
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm serial changes?</AlertDialogTitle>
            <AlertDialogDescription>
              The next document of each type will use the values shown.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={revertChange}>Revert</AlertDialogCancel>
            <AlertDialogAction onClick={confirmChange}>Confirm change</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RibbonTitleSettings() {
  const session = useSession();
  const [savedTitle, setSavedTitle] = useState<string>(() => getRibbonTitle());
  const [pendingTitle, setPendingTitle] = useState<string>(savedTitle);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const trimmed = pendingTitle.trim();
  const dirty = trimmed !== savedTitle;

  function handleApply() {
    if (!trimmed) {
      toast({ title: "Title required", description: "Ribbon title cannot be empty." });
      return;
    }
    setConfirmOpen(true);
  }

  function confirmChange() {
    if (session?.role === "developer") {
      setRibbonTitle(trimmed);
      setSavedTitle(trimmed);
      setPendingTitle(trimmed);
      setConfirmOpen(false);
      toast({ title: "Ribbon title updated" });
    } else if (session) {
      approvalsStore.request(
        {
          type: "settings_change",
          label: "Ribbon title",
          changes: [{ kind: "ribbonTitle", value: trimmed, previous: savedTitle }],
        },
        session.username,
      );
      setConfirmOpen(false);
      toast({ title: "Approval request submitted", description: "Awaiting developer approval." });
    }
  }

  function revertChange() {
    setPendingTitle(savedTitle);
    setConfirmOpen(false);
  }

  return (
    <div>
      <div className="mb-6 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        Ribbon title
      </div>

      <div className="max-w-md space-y-4">
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider">
            Title shown centered on the top ribbon
          </label>
          <Input
            value={pendingTitle}
            onChange={(e) => setPendingTitle(e.target.value)}
            placeholder={DEFAULT_RIBBON_TITLE}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Currently active: <span className="font-medium text-foreground">{savedTitle}</span>
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleApply} disabled={!dirty || !trimmed}>
            Apply
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm ribbon title change?</AlertDialogTitle>
            <AlertDialogDescription>
              Change ribbon title from <strong>{savedTitle}</strong> to <strong>{trimmed}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={revertChange}>Revert</AlertDialogCancel>
            <AlertDialogAction onClick={confirmChange}>Confirm change</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TaxSettingsImpl() {
  const session = useSession();
  const initial = getDefaultTaxRates();
  const [b2bDefault, setB2bDefault] = useState<string>(String(initial.b2b));
  const [b2cDefault, setB2cDefault] = useState<string>(String(initial.b2c));
  const [savedDefaults, setSavedDefaults] = useState(initial);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [customers] = useCustomers();
  const b2bCustomers = customers.filter((c) => (c.clientType ?? "B2B") === "B2B");

  // Per-customer pending edits (string for empty-input support).
  const [pendingRates, setPendingRates] = useState<Record<string, string>>({});

  const parsedB2b = parseFloat(b2bDefault);
  const parsedB2c = parseFloat(b2cDefault);
  const validDefaults =
    Number.isFinite(parsedB2b) && parsedB2b >= 0 && parsedB2b <= 100 &&
    Number.isFinite(parsedB2c) && parsedB2c >= 0 && parsedB2c <= 100;
  const defaultsDirty = parsedB2b !== savedDefaults.b2b || parsedB2c !== savedDefaults.b2c;

  const dirtyCustomers = b2bCustomers.filter((c) => {
    const pending = pendingRates[c.id];
    if (pending === undefined) return false;
    if (pending === "") return c.taxRate !== undefined;
    const n = parseFloat(pending);
    if (!Number.isFinite(n)) return false;
    return n !== c.taxRate;
  });

  const canApply = (defaultsDirty && validDefaults) || dirtyCustomers.length > 0;

  function handleApply() {
    if (!validDefaults) {
      toast({ title: "Invalid rates", description: "Tax rates must be between 0 and 100." });
      return;
    }
    setConfirmOpen(true);
  }

  function confirmChange() {
    if (session?.role === "developer") {
      if (defaultsDirty) {
        localStorage.setItem(TAX_KEYS.b2b, String(parsedB2b));
        localStorage.setItem(TAX_KEYS.b2c, String(parsedB2c));
        setSavedDefaults({ b2b: parsedB2b, b2c: parsedB2c });
      }
      dirtyCustomers.forEach((c) => {
        const pending = pendingRates[c.id];
        const next: Customer = { ...c };
        if (pending === "") {
          delete next.taxRate;
        } else {
          next.taxRate = parseFloat(pending);
        }
        customersStore.upsert(next);
      });
      setPendingRates({});
      setConfirmOpen(false);
      toast({ title: "Tax settings saved" });
      return;
    }
    if (!session) return;
    const changes: Extract<ApprovalAction, { type: "settings_change" }>["changes"] = [];
    if (defaultsDirty) {
      changes.push({
        kind: "localStorage",
        key: TAX_KEYS.b2b,
        value: String(parsedB2b),
        previous: localStorage.getItem(TAX_KEYS.b2b),
      });
      changes.push({
        kind: "localStorage",
        key: TAX_KEYS.b2c,
        value: String(parsedB2c),
        previous: localStorage.getItem(TAX_KEYS.b2c),
      });
    }
    dirtyCustomers.forEach((c) => {
      const pending = pendingRates[c.id];
      const value = pending === "" ? null : parseFloat(pending);
      changes.push({
        kind: "customerTaxRate",
        customerId: c.id,
        customerName: [c.name, c.surname].filter(Boolean).join(" "),
        value,
        previous: c.taxRate ?? null,
      });
    });
    approvalsStore.request(
      { type: "settings_change", label: "Tax settings", changes },
      session.username,
    );
    setPendingRates({});
    setConfirmOpen(false);
    toast({ title: "Approval request submitted", description: "Awaiting developer approval." });
  }

  function revertChange() {
    setB2bDefault(String(savedDefaults.b2b));
    setB2cDefault(String(savedDefaults.b2c));
    setPendingRates({});
    setConfirmOpen(false);
  }

  return (
    <div>
      <div className="mb-6 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        Tax
      </div>

      <div className="grid max-w-md grid-cols-2 gap-4">
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider">
            B2B default (%)
          </label>
          <Input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={b2bDefault}
            onChange={(e) => setB2bDefault(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider">
            B2C default (%)
          </label>
          <Input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={b2cDefault}
            onChange={(e) => setB2cDefault(e.target.value)}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Default {DEFAULT_TAX.b2c}% (editable).
          </p>
        </div>
      </div>

      <div className="mt-8">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider">
          Per-customer rates (B2B)
        </div>

        <div className="mb-6 border-2 border-foreground/10">
          <div className="border-b border-foreground/10 bg-muted/40 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Default rates by business type
          </div>
          <div className="grid grid-cols-[1fr_120px_120px_120px] gap-2 border-b border-foreground/10 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            <span>Business type</span>
            <span className="text-right">VAT</span>
            <span className="text-right">Recargo</span>
            <span className="text-right">Total</span>
          </div>
          {BUSINESS_TYPES.map((bt) => {
            const b = BUSINESS_TYPE_TAX[bt];
            return (
              <div
                key={bt}
                className="grid grid-cols-[1fr_120px_120px_120px] items-center gap-2 border-b border-foreground/5 px-3 py-2 text-sm last:border-b-0"
              >
                <span>{bt}</span>
                <span className="text-right font-mono-tabular">{b.vat}%</span>
                <span className="text-right font-mono-tabular">
                  {b.surcharge ? `+${b.surcharge}%` : "—"}
                </span>
                <span className="text-right font-mono-tabular font-semibold">
                  {(b.vat + b.surcharge).toFixed(b.surcharge ? 1 : 0)}%
                </span>
              </div>
            );
          })}
          <div className="px-3 py-2 text-[10px] text-muted-foreground">
            Applied automatically to B2B customers based on their business type. Per-customer
            overrides below take priority.
          </div>
        </div>

        <p className="mb-3 text-xs text-muted-foreground">
          Leave empty to use the B2B default. Custom values override the default for that customer.
        </p>

        {b2bCustomers.length === 0 ? (
          <div className="border-2 border-dashed border-foreground/10 p-6 text-center text-sm text-muted-foreground">
            No B2B customers yet.
          </div>
        ) : (
          <div className="border-2 border-foreground/10">
            <div className="grid grid-cols-[1fr_180px_140px] gap-2 border-b border-foreground/10 bg-muted/40 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              <span>Customer</span>
              <span>Business</span>
              <span className="text-right">Tax rate (%)</span>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {b2bCustomers.map((c) => {
                const pending = pendingRates[c.id];
                const display = pending !== undefined
                  ? pending
                  : c.taxRate !== undefined
                    ? String(c.taxRate)
                    : "";
                const btDefault = c.businessType
                  ? BUSINESS_TYPE_TAX[c.businessType].vat +
                    BUSINESS_TYPE_TAX[c.businessType].surcharge
                  : savedDefaults.b2b;
                return (
                  <div
                    key={c.id}
                    className="grid grid-cols-[1fr_180px_140px] items-center gap-2 border-b border-foreground/5 px-3 py-2 text-sm last:border-b-0"
                  >
                    <span className="truncate">{[c.name, c.surname].filter(Boolean).join(" ")}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {c.businessName || c.businessType || "—"}
                    </span>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      placeholder={`Default ${btDefault}`}
                      value={display}
                      onChange={(e) =>
                        setPendingRates((prev) => ({ ...prev, [c.id]: e.target.value }))
                      }
                      className="h-8 text-right font-mono-tabular"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-end">
        <Button onClick={handleApply} disabled={!canApply}>
          Apply
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm tax changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {defaultsDirty && (
                <span className="block">
                  Defaults → B2B {parsedB2b}%, B2C {parsedB2c}%.
                </span>
              )}
              {dirtyCustomers.length > 0 && (
                <span className="block">
                  {dirtyCustomers.length} customer{dirtyCustomers.length === 1 ? "" : "s"} updated.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={revertChange}>Revert</AlertDialogCancel>
            <AlertDialogAction onClick={confirmChange}>Confirm change</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function SettingsView() {
  const [tab, setTab] = useState<SettingsTab>("general");
  const session = useSession();
  const visibleTabs = SUB_TABS.filter((t) => !t.developerOnly || session?.role === "developer");

  return (
    <div>
      <SectionHeader title="Settings" />

      <div className="mb-8 flex flex-wrap gap-0 border-b border-foreground/10">
        {visibleTabs.map((t) => {
          const isActive = t.key === tab;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-2 border-b-2 px-4 py-3 text-sm transition-colors",
                isActive
                  ? "border-foreground font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "font-mono-tabular text-[10px]",
                  isActive ? "text-accent" : "text-muted-foreground/60",
                )}
              >
                {t.n}
              </span>
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "general" && <GeneralSettings />}
      {tab === "products" && <ProductsSettings />}
      {tab === "stock" && <Placeholder title="Stock" />}
      {tab === "sales" && <Placeholder title="Sales" />}
      {tab === "customers" && <Placeholder title="Customers" />}
      {tab === "transport" && <TransportSettings />}
      {tab === "access" && session?.role === "developer" && <AccessSettings />}
    </div>
  );
}

function TransportSettings() {
  return (
    <div className="border-2 border-foreground/10 p-8">
      <div className="mb-6 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        Transport settings
      </div>

      {/* Pickup origin */}
      <div className="mb-6 max-w-md border-2 border-foreground/10 p-4">
        <div className="mb-2 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Pickup origin
        </div>
        <div className="text-sm font-semibold">{PICKUP_ADDRESS.line}</div>
        <div className="text-xs text-muted-foreground">
          {PICKUP_ADDRESS.postalCode} {PICKUP_ADDRESS.city} · {PICKUP_ADDRESS.province} · {PICKUP_ADDRESS.country}
        </div>
      </div>

      {/* Calculator */}
      <ShippingCalculator />
    </div>
  );
}

function ShippingCalculator() {
  const [country, setCountry] = useState<string>("Spain");
  const [province, setProvince] = useState<string>("Madrid");
  const [weight, setWeight] = useState<string>("1");

  const w = parseFloat(weight);
  const validWeight = Number.isFinite(w) && w > 0;
  const quotes = validWeight
    ? quoteTransport({
        country,
        province: country === "Spain" ? province : undefined,
        weightKg: w,
      })
    : [];

  return (
    <div className="mb-6 max-w-2xl border-2 border-foreground/10 p-4">
      <div className="mb-4 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        Shipping calculator
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
            Destination country
          </label>
          <Select value={country} onValueChange={(v) => setCountry(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Spain">Spain</SelectItem>
              {INTL_COUNTRY_OPTIONS.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {country === "Spain" && (
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
              Province
            </label>
            <Select value={province} onValueChange={(v) => setProvince(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ES_PROVINCE_OPTIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
            Weight (kg)
          </label>
          <Input
            type="number"
            min={0}
            step={0.1}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="font-mono-tabular"
          />
        </div>
      </div>

      <div className="mt-4 border-t-2 border-foreground/10 pt-4">
        {!validWeight ? (
          <p className="text-xs text-muted-foreground">Enter a weight greater than 0 kg.</p>
        ) : quotes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No SEUR tariff available for this destination — the default fallback fee will apply in POS.
          </p>
        ) : (
          <div className="space-y-2">
            {quotes.map((q, i) => (
              <div
                key={i}
                className="flex items-center justify-between border border-foreground/10 px-3 py-2"
              >
                <div>
                  <div className="text-sm font-semibold">{q.label}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    ETA {q.eta}
                  </div>
                </div>
                <div className="font-mono-tabular text-base">€ {q.price.toFixed(2)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
function ProductsSettings() {
  const session = useSession();
  const isDeveloper = session?.role === "developer";
  const pendingDeletes = usePendingDeletes();
  const [colours, setColoursState] = useState<Colour[]>(() => getColours());
  const [newName, setNewName] = useState("");
  const [savedMarkup, setSavedMarkup] = useState(() => getDefaultB2cMarkupPercent());
  const [pendingMarkup, setPendingMarkup] = useState(() => String(getDefaultB2cMarkupPercent()));

  useEffect(() => {
    const unsub = subscribeColours(() => setColoursState(getColours()));
    return () => { unsub(); };
  }, []);

  function addColour() {
    const trimmed = newName.trim().toUpperCase();
    if (!trimmed) {
      toast({ title: "Name required", description: "Enter a colour name." });
      return;
    }
    if (colours.some((c) => c.name === trimmed)) {
      toast({ title: "Duplicate", description: "Colour already exists." });
      return;
    }
    const code = generateColourCode(trimmed, colours);
    if (!code) {
      toast({ title: "Could not generate code", description: "Try a different name." });
      return;
    }
    const next = [...colours, { code, name: trimmed }];
    setColours(next);
    setNewName("");
    toast({ title: "Colour added", description: `${trimmed} → ${code}` });
  }

  function removeColour(code: string) {
    const colour = colours.find((c) => c.code === code);
    if (!colour) return;
    if (isDeveloper) {
      setColours(colours.filter((c) => c.code !== code));
      return;
    }
    if (!session) return;
    if (pendingDeletes.colours.has(code)) {
      toast({ title: "Already pending", description: "A deletion request is already awaiting approval." });
      return;
    }
    approvalsStore.request(
      { type: "delete_colour", code: colour.code, name: colour.name },
      session.username,
    );
    toast({ title: "Approval request submitted", description: "Awaiting developer approval." });
  }

  function applyDefaultMarkup() {
    const parsed = Number(String(pendingMarkup).replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000) {
      toast({ title: "Invalid markup", description: "B2C markup must be between 0 and 1000%." });
      return;
    }
    const normalized = Math.round(parsed * 100) / 100;
    if (normalized === savedMarkup) return;
    if (isDeveloper) {
      setDefaultB2cMarkupPercent(normalized);
      setSavedMarkup(normalized);
      setPendingMarkup(String(normalized));
      toast({ title: "B2C markup saved", description: `Default markup is now ${normalized}%.` });
      return;
    }
    if (!session) return;
    approvalsStore.request(
      {
        type: "settings_change",
        label: "Default B2C product markup",
        changes: [
          {
            kind: "localStorage",
            key: PRODUCT_SETTING_KEYS.defaultB2cMarkup,
            value: String(normalized),
            previous: localStorage.getItem(PRODUCT_SETTING_KEYS.defaultB2cMarkup),
          },
        ],
      },
      session.username,
    );
    setPendingMarkup(String(savedMarkup));
    toast({ title: "Approval request submitted", description: "Awaiting developer approval." });
  }

  return (
    <div className="border-2 border-foreground/10 p-8">
      <div className="mb-8 max-w-md border-2 border-foreground/10 p-4">
        <div className="mb-2 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Default B2C markup
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          New products use this markup by default. Current system default is {DEFAULT_B2C_MARKUP_PERCENT}%.
        </p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
              Markup (%)
            </label>
            <Input
              type="number"
              min={0}
              max={1000}
              step={0.01}
              value={pendingMarkup}
              onChange={(e) => setPendingMarkup(e.target.value)}
              className="font-mono-tabular"
            />
          </div>
          <Button
            onClick={applyDefaultMarkup}
            disabled={Number(String(pendingMarkup).replace(",", ".")) === savedMarkup}
          >
            Apply
          </Button>
        </div>
      </div>

      <div className="mb-6 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        Colour table
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Used in product variations. Codes are auto-generated (max 3 characters) and must be unique.
      </p>

      <div className="mb-6 flex max-w-md gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New colour name (e.g. CHARCOAL)"
          onKeyDown={(e) => { if (e.key === "Enter") addColour(); }}
        />
        <Button onClick={addColour}>Add</Button>
      </div>

      <div className="grid grid-cols-1 gap-0 border-2 border-foreground/10 sm:grid-cols-2 lg:grid-cols-3">
        {colours.map((c) => (
          <div
            key={c.code}
            className="flex items-center justify-between border-b border-r border-foreground/10 px-3 py-2"
          >
            <div className="flex items-center gap-3">
              <span className="font-mono-tabular text-xs font-semibold">{c.code}</span>
              <span className="text-sm">{c.name}</span>
            </div>
            <button
              onClick={() => removeColour(c.code)}
              disabled={pendingDeletes.colours.has(c.code)}
              className="text-muted-foreground hover:text-bauhaus-red disabled:opacity-40"
              aria-label={`Remove ${c.name}`}
              title={pendingDeletes.colours.has(c.code) ? "Awaiting approval" : undefined}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
