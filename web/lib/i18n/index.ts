// Language + lookup. Framework-free so server components, client components
// and tests can all import it; the React binding is components/LangProvider.
//
// Default English. The chosen language is remembered in localStorage; any
// unknown or corrupted value collapses to the default and lookups never throw.
import { DICT, type TKey } from "./dict";

export type { TKey } from "./dict";
export type Lang = "en" | "zh";

const KEY = "radian.lang";
const SUPPORTED: readonly Lang[] = ["en", "zh"];
const DEFAULT: Lang = "en";

let _lang: Lang | null = null;

function isLang(v: unknown): v is Lang {
  return SUPPORTED.includes(v as Lang);
}

export function getLang(): Lang {
  if (_lang) return _lang;
  let v: string = DEFAULT;
  try {
    v = localStorage.getItem(KEY) || DEFAULT;
  } catch {
    v = DEFAULT;
  }
  _lang = isLang(v) ? v : DEFAULT;
  return _lang;
}

export function setLang(l: Lang | (string & {})): Lang {
  _lang = isLang(l) ? l : DEFAULT;
  try {
    localStorage.setItem(KEY, _lang);
  } catch {
    /* private mode / quota: the in-memory value still applies this session */
  }
  syncHtmlLang();
  notify();
  return _lang;
}

const listeners = new Set<() => void>();
function notify() {
  for (const fn of listeners) fn();
}
/** Subscribe to language changes (for useSyncExternalStore). */
export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function syncHtmlLang(): void {
  if (typeof document === "undefined") return;
  try {
    document.documentElement.lang = getLang() === "zh" ? "zh-CN" : "en";
  } catch {
    /* no document */
  }
}

export type TVars = Record<string, string | number>;

// current language → English → the key itself (a visible "missing entry" signal)
function resolve(key: string, vars?: TVars): string {
  const table = DICT[getLang()] as Record<string, string | undefined>;
  let s = table[key];
  if (s == null) s = (DICT.en as Record<string, string | undefined>)[key];
  if (s == null) s = key;
  if (vars) for (const k in vars) s = s.split("{" + k + "}").join(String(vars[k]));
  return s;
}

/** Static key: a typo is a compile error. */
export function t(key: TKey, vars?: TVars): string {
  return resolve(key, vars);
}

/** Runtime-built key (`crumb.${route}`): same fallback chain, open type. */
export function tDynamic(key: string, vars?: TVars): string {
  return resolve(key, vars);
}
