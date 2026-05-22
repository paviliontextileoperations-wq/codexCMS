import { useEffect, useState } from "react";

export const COMPANY_KEYS = {
  companyName: "app.company.name",
  vatNumber: "app.company.vat",
  address: "app.company.address",
  beneficiary: "app.company.beneficiary",
  bank: "app.company.bank",
  swift: "app.company.swift",
} as const;

export const DEFAULT_COMPANY = {
  companyName: "PAVILION TEXTILE GROUP SL",
  vatNumber: "ES-B88476221",
  address: "Calle de San Lorenzo 10, Local H-I\n28947 Fuenlabrada, Madrid, Spain",
  beneficiary: "PAVILION TEXTILE GROUP",
  bank: "IBANXXXXXXXXXXXXXXXXXXXXX",
  swift: "XXXXXXXXXXXXXX",
} as const;

export type CompanyInfo = {
  companyName: string;
  vatNumber: string;
  address: string;
  beneficiary: string;
  bank: string;
  swift: string;
};

const EVENT_NAME = "app:company-changed";

export function getCompanyInfo(): CompanyInfo {
  if (typeof window === "undefined") return { ...DEFAULT_COMPANY };
  return {
    companyName: localStorage.getItem(COMPANY_KEYS.companyName) ?? DEFAULT_COMPANY.companyName,
    vatNumber: localStorage.getItem(COMPANY_KEYS.vatNumber) ?? DEFAULT_COMPANY.vatNumber,
    address: localStorage.getItem(COMPANY_KEYS.address) ?? DEFAULT_COMPANY.address,
    beneficiary: localStorage.getItem(COMPANY_KEYS.beneficiary) ?? DEFAULT_COMPANY.beneficiary,
    bank: localStorage.getItem(COMPANY_KEYS.bank) ?? DEFAULT_COMPANY.bank,
    swift: localStorage.getItem(COMPANY_KEYS.swift) ?? DEFAULT_COMPANY.swift,
  };
}

export function setCompanyInfo(info: Partial<CompanyInfo>) {
  const existing = getCompanyInfo();
  const next = { ...existing, ...info };
  Object.entries(next).forEach(([key, value]) => {
    localStorage.setItem(COMPANY_KEYS[key as keyof CompanyInfo], value);
  });
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

/** Reactive hook so any component using company info updates immediately on save. */
export function useCompanyInfo(): CompanyInfo {
  const [info, setInfo] = useState<CompanyInfo>(() => getCompanyInfo());
  useEffect(() => {
    const update = () => setInfo(getCompanyInfo());
    window.addEventListener(EVENT_NAME, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT_NAME, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return info;
}
