import React, { createContext, useContext, useEffect, useMemo } from "react";
import { detectLocale, translate, type Locale, type TranslationValues } from "./i18n.js";

interface I18nValue {
  locale: Locale;
  t: (message: string, values?: TranslationValues) => string;
  formatNumber: (value: number) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useMemo(
    () => {
      if (typeof navigator === "undefined") return detectLocale();
      return detectLocale(navigator.languages.length > 0 ? navigator.languages : [navigator.language]);
    },
    []
  );
  const value = useMemo<I18nValue>(() => ({
    locale,
    t: (message, values) => translate(locale, message, values),
    formatNumber: (number) => number.toLocaleString(locale),
  }), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, "OpenWolf Dashboard");
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
