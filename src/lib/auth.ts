import { useEffect, useState } from "react";

export type Role = "developer" | "operator";

export type Session = {
  username: string;
  role: Role;
  loggedInAt: number;
};

const SESSION_KEY = "form.session.v1";
const ACCOUNTS_KEY = "form.accounts.v1";
const EVT = "form-auth";

export type Account = { username: string; password: string; role: Role };

// Default seed credentials. Persisted to localStorage on first run so they can be edited.
const DEFAULT_ACCOUNTS: Account[] = [
  { username: "dev", password: "developer", role: "developer" },
  { username: "ops", password: "operator", role: "operator" },
];

function readAccounts(): Account[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(DEFAULT_ACCOUNTS));
      return [...DEFAULT_ACCOUNTS];
    }
    const list = JSON.parse(raw) as Account[];
    if (!Array.isArray(list) || list.length === 0) return [...DEFAULT_ACCOUNTS];
    return list;
  } catch {
    return [...DEFAULT_ACCOUNTS];
  }
}

function writeAccounts(list: Account[]) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent(EVT));
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

function emit() {
  window.dispatchEvent(new CustomEvent(EVT));
}

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function login(username: string, password: string): Session | null {
  const u = normalize(username);
  const accounts = readAccounts();
  const entry = accounts.find((a) => normalize(a.username) === u);
  if (!entry || entry.password !== password) return null;
  const session: Session = { username: entry.username, role: entry.role, loggedInAt: Date.now() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  emit();
  return session;
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
  emit();
}

export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(() => getSession());
  useEffect(() => {
    const handler = () => setSession(getSession());
    window.addEventListener(EVT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);
  return session;
}

export function isDeveloper(s: Session | null): boolean {
  return s?.role === "developer";
}

/* ------------------------------------------------------------------ */
/* Account management (developer-only callers should enforce the role) */
/* ------------------------------------------------------------------ */

export const accountsStore = {
  all(): Account[] {
    return readAccounts();
  },
  exists(username: string): boolean {
    const u = normalize(username);
    return readAccounts().some((a) => normalize(a.username) === u);
  },
  verify(username: string, password: string): boolean {
    const u = normalize(username);
    const a = readAccounts().find((x) => normalize(x.username) === u);
    return !!a && a.password === password;
  },
  setPassword(username: string, password: string): boolean {
    const u = normalize(username);
    const list = readAccounts();
    const idx = list.findIndex((a) => normalize(a.username) === u);
    if (idx < 0) return false;
    list[idx] = { ...list[idx], password };
    writeAccounts(list);
    return true;
  },
  createOperator(username: string, password: string): { ok: boolean; error?: string } {
    const trimmed = username.trim();
    if (!trimmed) return { ok: false, error: "Username is required" };
    if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(trimmed)) {
      return { ok: false, error: "Username must be 2-32 chars (letters, numbers, _ . -)" };
    }
    if (!password || password.length < 4) {
      return { ok: false, error: "Password must be at least 4 characters" };
    }
    const list = readAccounts();
    if (list.some((a) => normalize(a.username) === normalize(trimmed))) {
      return { ok: false, error: "Username already exists" };
    }
    list.push({ username: trimmed, password, role: "operator" });
    writeAccounts(list);
    return { ok: true };
  },
  remove(username: string): boolean {
    const u = normalize(username);
    const list = readAccounts();
    const next = list.filter((a) => normalize(a.username) !== u);
    if (next.length === list.length) return false;
    writeAccounts(next);
    return true;
  },
};

export function useAccounts(): Account[] {
  const [list, setList] = useState<Account[]>(() => readAccounts());
  useEffect(() => {
    const handler = () => setList(readAccounts());
    window.addEventListener(EVT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);
  return list;
}