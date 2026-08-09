"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { en } from "@/locales/en";
import { es } from "@/locales/es";

export type SupportedLocale = "en" | "es";

const DICTIONARIES: Record<SupportedLocale, any> = { en, es };

interface LanguageContextType {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (keyPath: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>("en");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("opm_locale") as SupportedLocale | null;
    if (saved && (saved === "en" || saved === "es")) {
      setLocaleState(saved);
    } else {
      const browserLang = navigator.language.toLowerCase();
      if (browserLang.startsWith("es")) {
        setLocaleState("es");
      }
    }
    setMounted(true);
  }, []);

  function setLocale(newLocale: SupportedLocale) {
    setLocaleState(newLocale);
    localStorage.setItem("opm_locale", newLocale);
  }

  function t(keyPath: string, params?: Record<string, string | number>): string {
    const dict = DICTIONARIES[locale] || en;
    const keys = keyPath.split(".");

    let current: any = dict;
    for (const key of keys) {
      if (current && typeof current === "object" && key in current) {
        current = current[key];
      } else {
        // Fallback to English dictionary
        let fallback: any = en;
        for (const k of keys) {
          if (fallback && typeof fallback === "object" && k in fallback) {
            fallback = fallback[k];
          } else {
            return keyPath;
          }
        }
        current = fallback;
        break;
      }
    }

    if (typeof current !== "string") {
      return keyPath;
    }

    let result = current;
    if (params) {
      Object.entries(params).forEach(([paramKey, val]) => {
        result = result.replace(new RegExp(`{\\s*${paramKey}\\s*}`, "g"), String(val));
      });
    }

    return result;
  }

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t }}>
      <div className={mounted ? "" : "visibility-hidden"}>{children}</div>
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useTranslation must be used within a LanguageProvider");
  }
  return context;
}
