import { useEffect, useState } from "react";

export const BRAND_KEYS = {
  ribbonTitle: "app.brand.ribbonTitle",
} as const;

export const DEFAULT_RIBBON_TITLE = "PAVILION TEXTILE GROUP";

const EVENT_NAME = "app:brand-changed";

export function getRibbonTitle(): string {
  if (typeof window === "undefined") return DEFAULT_RIBBON_TITLE;
  const raw = localStorage.getItem(BRAND_KEYS.ribbonTitle);
  return raw ?? DEFAULT_RIBBON_TITLE;
}

export function setRibbonTitle(value: string) {
  localStorage.setItem(BRAND_KEYS.ribbonTitle, value);
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

/** Reactive hook so any component using the title updates immediately on save. */
export function useRibbonTitle(): string {
  const [title, setTitle] = useState<string>(() => getRibbonTitle());
  useEffect(() => {
    const update = () => setTitle(getRibbonTitle());
    window.addEventListener(EVENT_NAME, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT_NAME, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return title;
}