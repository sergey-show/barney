import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { catalog, detectLocale, type Locale, type Messages } from "./i18n.ts";

type LocaleContextValue = {
  locale: Locale;
  t: Messages;
  setLocale: (next: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider(props: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale());
  const t = catalog[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem("barney.locale", locale);
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    t,
    setLocale: (next) => setLocaleState(next),
  }), [locale, t]);

  return <LocaleContext.Provider value={value}>{props.children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("LocaleProvider missing");
  return ctx;
}
