import { useState } from "react";
import { Building2, MapPin, Phone, Truck, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COUNTRY_DIAL_CODES } from "@/lib/countryCodes";
import { regionsFor } from "@/lib/regions";
import { SearchableSelect } from "./SearchableSelect";
import { BUSINESS_TYPES, type Address, type BusinessType, type ClientType, type Customer } from "@/types";
import { cn } from "@/lib/utils";

export type CustomerDraft = Omit<Customer, "id" | "createdAt" | "phone"> & {
  id?: string;
};

export const emptyAddress: Address = {
  line1: "",
  line2: "",
  additionalInfo: "",
  postalCode: "",
  provinceState: "",
  country: "",
};

export const emptyCustomer: CustomerDraft = {
  clientType: "B2B",
  name: "",
  surname: "",
  businessType: undefined,
  businessName: "",
  email: "",
  vatNumber: "",
  phoneCountryCode: "+34",
  phoneNumber: "",
  fiscalAddress: { ...emptyAddress },
  logisticsAddress: { ...emptyAddress },
};

type Section = "fiscal" | "logistics" | "phone";

interface Props {
  value: CustomerDraft;
  onChange: (next: CustomerDraft) => void;
  /** When set, hide the B2B/B2C selector and force this type. */
  lockedClientType?: ClientType;
}

export function CustomerForm({ value, onChange, lockedClientType }: Props) {
  const [section, setSection] = useState<Section | null>(null);

  const set = <K extends keyof CustomerDraft>(key: K, v: CustomerDraft[K]) =>
    onChange({ ...value, [key]: v });

  const setAddr = (
    key: "fiscalAddress" | "logisticsAddress",
    field: keyof Address,
    v: string,
  ) => onChange({ ...value, [key]: { ...(value[key] ?? emptyAddress), [field]: v } });

  const patchAddr = (
    key: "fiscalAddress" | "logisticsAddress",
    patch: Partial<Address>,
  ) => onChange({ ...value, [key]: { ...(value[key] ?? emptyAddress), ...patch } });

  const businessSelected = !!value.businessType;
  const clientType: ClientType = lockedClientType ?? value.clientType ?? "B2B";
  const isB2C = clientType === "B2C";

  return (
    <div className="space-y-6">
      {/* Client type selector */}
      {!lockedClientType && (
      <div>
        <Label className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Client type
        </Label>
        <div className="grid grid-cols-2 gap-px bg-foreground/10">
          {(["B2B", "B2C"] as ClientType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set("clientType", t)}
              className={cn(
                "border-2 bg-background px-3 py-3 text-sm font-medium transition-colors",
                clientType === t
                  ? "border-foreground bg-foreground text-primary-foreground"
                  : "border-foreground hover:bg-secondary",
              )}
            >
              {t}
              <span className="ml-2 text-[10px] uppercase tracking-[0.2em] opacity-70">
                {t === "B2B" ? "Business" : "Consumer"}
              </span>
            </button>
          ))}
        </div>
      </div>
      )}

      {isB2C ? (
        <div className="grid grid-cols-2 gap-4">
          <FieldBox label="Name *">
            <Input value={value.name} onChange={(e) => set("name", e.target.value)} />
          </FieldBox>
          <FieldBox label="Surname">
            <Input value={value.surname ?? ""} onChange={(e) => set("surname", e.target.value)} />
          </FieldBox>
          <FieldBox label="Country code">
            <Select
              value={value.phoneCountryCode ?? ""}
              onValueChange={(v) => set("phoneCountryCode", v)}
            >
              <SelectTrigger className="h-10 rounded-none border-2 border-foreground">
                <SelectValue placeholder="Code" />
              </SelectTrigger>
              <SelectContent className="rounded-none border-2 border-foreground max-h-72">
                {COUNTRY_DIAL_CODES.map((c) => (
                  <SelectItem key={c.code} value={c.dial} className="rounded-none">
                    {c.dial} · {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBox>
          <FieldBox label="Phone number *">
            <Input
              inputMode="tel"
              value={value.phoneNumber ?? ""}
              onChange={(e) => set("phoneNumber", e.target.value)}
            />
          </FieldBox>
        </div>
      ) : (
      <>
      {/* Basic info */}
      <div className="grid grid-cols-2 gap-4">
        <FieldBox label="Name *">
          <Input value={value.name} onChange={(e) => set("name", e.target.value)} />
        </FieldBox>
        <FieldBox label="Surname">
          <Input value={value.surname ?? ""} onChange={(e) => set("surname", e.target.value)} />
        </FieldBox>

        <FieldBox label="Business type" full>
          <Select
            value={value.businessType ?? ""}
            onValueChange={(v) => set("businessType", v as BusinessType)}
          >
            <SelectTrigger className="h-10 rounded-none border-2 border-foreground">
              <SelectValue placeholder="Select business type…" />
            </SelectTrigger>
            <SelectContent className="rounded-none border-2 border-foreground">
              {BUSINESS_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="rounded-none">
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldBox>

        <FieldBox label="Business name" full>
          <Input value={value.businessName ?? ""} onChange={(e) => set("businessName", e.target.value)} />
        </FieldBox>

        <FieldBox label="Email">
          <Input type="email" value={value.email ?? ""} onChange={(e) => set("email", e.target.value)} />
        </FieldBox>
        <FieldBox label="VAT number">
          <Input value={value.vatNumber ?? ""} onChange={(e) => set("vatNumber", e.target.value)} />
        </FieldBox>

        <FieldBox label="Tax rate (%) — leave empty for default" full>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={0.01}
            placeholder="Use default B2B rate"
            value={value.taxRate ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") return set("taxRate", undefined);
              const n = parseFloat(v);
              set("taxRate", Number.isFinite(n) ? n : undefined);
            }}
          />
        </FieldBox>
      </div>

      {/* Three section toggles, unlocked once a business type is chosen */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Additional details
          </Label>
          {!businessSelected && (
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Select a business type to continue
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-px bg-foreground/10">
          <SectionButton
            active={section === "fiscal"}
            disabled={!businessSelected}
            icon={<MapPin className="h-4 w-4" />}
            label="Fiscal address"
            done={isAddressFilled(value.fiscalAddress)}
            onClick={() => setSection(section === "fiscal" ? null : "fiscal")}
          />
          <SectionButton
            active={section === "logistics"}
            disabled={!businessSelected}
            icon={<Truck className="h-4 w-4" />}
            label="Logistics address"
            done={isAddressFilled(value.logisticsAddress)}
            onClick={() => setSection(section === "logistics" ? null : "logistics")}
          />
          <SectionButton
            active={section === "phone"}
            disabled={!businessSelected}
            icon={<Phone className="h-4 w-4" />}
            label="Contact phone"
            done={!!value.phoneNumber}
            onClick={() => setSection(section === "phone" ? null : "phone")}
          />
        </div>

        {section === "fiscal" && (
          <AddressFields
            title="Fiscal address"
            value={value.fiscalAddress ?? emptyAddress}
            onChange={(field, v) => setAddr("fiscalAddress", field, v)}
            onPatch={(patch) => patchAddr("fiscalAddress", patch)}
            onCopyFrom={
              isAddressFilled(value.logisticsAddress)
                ? () =>
                    onChange({
                      ...value,
                      fiscalAddress: { ...(value.logisticsAddress ?? emptyAddress) },
                    })
                : undefined
            }
            copyLabel="Copy from logistics"
          />
        )}
        {section === "logistics" && (
          <AddressFields
            title="Logistics address"
            value={value.logisticsAddress ?? emptyAddress}
            onChange={(field, v) => setAddr("logisticsAddress", field, v)}
            onPatch={(patch) => patchAddr("logisticsAddress", patch)}
            onCopyFrom={() =>
              onChange({
                ...value,
                logisticsAddress: { ...(value.fiscalAddress ?? emptyAddress) },
              })
            }
            copyLabel="Same as fiscal address"
            copyDisabled={!isAddressFilled(value.fiscalAddress)}
          />
        )}
        {section === "phone" && (
          <div className="mt-3 border-2 border-foreground bg-background p-4">
            <div className="mb-3 flex items-center gap-2 border-b-2 border-foreground/10 pb-2">
              <Building2 className="h-4 w-4" />
              <h4 className="font-display text-base">Contact phone number</h4>
            </div>
            <div className="grid grid-cols-[180px_1fr] gap-4">
              <FieldBox label="Country code">
                <Select
                  value={value.phoneCountryCode ?? ""}
                  onValueChange={(v) => set("phoneCountryCode", v)}
                >
                  <SelectTrigger className="h-10 rounded-none border-2 border-foreground">
                    <SelectValue placeholder="Code" />
                  </SelectTrigger>
                  <SelectContent className="rounded-none border-2 border-foreground max-h-72">
                    {COUNTRY_DIAL_CODES.map((c) => (
                      <SelectItem key={c.code} value={c.dial} className="rounded-none">
                        {c.dial} · {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldBox>
              <FieldBox label="Phone number">
                <Input
                  inputMode="tel"
                  value={value.phoneNumber ?? ""}
                  onChange={(e) => set("phoneNumber", e.target.value)}
                />
              </FieldBox>
            </div>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}

function SectionButton({
  active,
  disabled,
  icon,
  label,
  done,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  done: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group flex items-center justify-between gap-2 border-2 bg-background px-3 py-3 text-left text-sm transition-colors",
        active ? "border-foreground bg-foreground text-primary-foreground" : "border-foreground hover:bg-secondary",
        disabled && "opacity-40 pointer-events-none",
      )}
    >
      <span className="flex items-center gap-2">
        {icon}
        <span className="font-medium">{label}</span>
      </span>
      {done && (
        <span className={cn("flex h-5 w-5 items-center justify-center", active ? "bg-accent text-accent-foreground" : "bg-accent text-accent-foreground")}>
          <Check className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}

function AddressFields({
  title,
  value,
  onChange,
  onPatch,
  onCopyFrom,
  copyLabel,
  copyDisabled,
}: {
  title: string;
  value: Address;
  onChange: (field: keyof Address, v: string) => void;
  onPatch?: (patch: Partial<Address>) => void;
  onCopyFrom?: () => void;
  copyLabel?: string;
  copyDisabled?: boolean;
}) {
  const countryEntry = COUNTRY_DIAL_CODES.find((c) => c.name === value.country);
  const regions = regionsFor(countryEntry?.code);
  const hasRegions = regions.length > 0;
  return (
    <div className="mt-3 border-2 border-foreground bg-background p-4">
      <div className="mb-3 flex items-center justify-between border-b-2 border-foreground/10 pb-2">
        <h4 className="font-display text-base">{title}</h4>
        {onCopyFrom && (
          <Button type="button" size="sm" variant="outline" onClick={onCopyFrom} disabled={copyDisabled}>
            {copyLabel}
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FieldBox label="Address line 1" full>
          <Input value={value.line1} onChange={(e) => onChange("line1", e.target.value)} />
        </FieldBox>
        <FieldBox label="Address line 2" full>
          <Input value={value.line2 ?? ""} onChange={(e) => onChange("line2", e.target.value)} />
        </FieldBox>
        <FieldBox label="Additional info" full>
          <Input value={value.additionalInfo ?? ""} onChange={(e) => onChange("additionalInfo", e.target.value)} />
        </FieldBox>
        <FieldBox label="Postal code">
          <Input value={value.postalCode} onChange={(e) => onChange("postalCode", e.target.value)} />
        </FieldBox>
        <FieldBox label="Province / State">
          <SearchableSelect
            value={value.provinceState || ""}
            onChange={(v) => onChange("provinceState", v)}
            options={regions.map((r) => ({ value: r, label: r }))}
            placeholder={hasRegions ? "Search province / state…" : "Select country first"}
            disabled={!value.country && !hasRegions}
          />
        </FieldBox>
        <FieldBox label="Country" full>
          <SearchableSelect
            value={value.country || ""}
            onChange={(v) => {
              if (onPatch) onPatch({ country: v, provinceState: "" });
              else onChange("country", v);
            }}
            options={COUNTRY_DIAL_CODES.map((c) => ({ value: c.name, label: c.name }))}
            placeholder="Search country…"
          />
        </FieldBox>
      </div>
    </div>
  );
}

function FieldBox({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <Label className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function isAddressFilled(a?: Address) {
  return !!a && !!a.line1 && !!a.country;
}

/** Compose a draft into a Customer-ready object (adds `phone` and `address`). */
export function composeCustomer(draft: CustomerDraft): Omit<Customer, "id" | "createdAt"> & { id?: string } {
  const phone = [draft.phoneCountryCode, draft.phoneNumber].filter(Boolean).join(" ").trim();
  const fa = draft.fiscalAddress;
  const address = fa && isAddressFilledLocal(fa)
    ? [fa.line1, fa.line2, fa.postalCode, fa.provinceState, fa.country].filter(Boolean).join(", ")
    : undefined;
  return { ...draft, phone, address };
}

function isAddressFilledLocal(a: Address) {
  return !!a.line1 && !!a.country;
}

/** Reverse: take an existing Customer and turn it into a draft for editing. */
export function customerToDraft(c: Customer): CustomerDraft {
  return {
    id: c.id,
    clientType: c.clientType ?? "B2B",
    name: c.name,
    surname: c.surname ?? "",
    businessType: c.businessType,
    businessName: c.businessName ?? "",
    email: c.email ?? "",
    vatNumber: c.vatNumber ?? "",
    phoneCountryCode: c.phoneCountryCode ?? (c.phone?.startsWith("+") ? c.phone.split(" ")[0] : "+34"),
    phoneNumber:
      c.phoneNumber ??
      (c.phone?.startsWith("+") ? c.phone.split(" ").slice(1).join(" ") : c.phone ?? ""),
    fiscalAddress: c.fiscalAddress ?? { ...emptyAddress },
    logisticsAddress: c.logisticsAddress ?? { ...emptyAddress },
    taxRate: c.taxRate,
  };
}