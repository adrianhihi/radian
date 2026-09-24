"use client";

// React binding for lib/i18n. The language is an external store
// (module cache + localStorage); useSyncExternalStore subscribes to it with a
// server snapshot fixed at "en", so the first client frame matches SSR and a
// Chinese reader never hydrates against an English tree.
import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { getLang, setLang as persistLang, subscribeLang, syncHtmlLang, t, tDynamic } from "@/lib/i18n";
import type { Lang, TKey, TVars } from "@/lib/i18n";

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: typeof t;
  tDynamic: typeof tDynamic;
}

const LangContext = createContext<LangContextValue | null>(null);
const getServerLang = (): Lang => "en";

export function LangProvider({ children }: { children: ReactNode }) {
  const lang = useSyncExternalStore(subscribeLang, getLang, getServerLang);
  useEffect(() => {
    syncHtmlLang();
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    persistLang(l);
  }, []);
  return <LangContext.Provider value={{ lang, setLang, t, tDynamic }}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used inside <LangProvider>");
  return ctx;
}

export function useT(): (key: TKey, vars?: TVars) => string {
  return useLang().t;
}

export function useTDynamic(): (key: string, vars?: TVars) => string {
  return useLang().tDynamic;
}
