"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { en } from "@/locales/en";
import { es } from "@/locales/es";
import { DEFAULT_LOCALE, LOCALE_COOKIE, asSupportedLocale, type SupportedLocale } from "@/lib/locale";

export type { SupportedLocale };

const DICTIONARIES: Record<SupportedLocale, typeof en> = { en, es };

function readLocaleCookie(): SupportedLocale | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  return asSupportedLocale(match?.[1]);
}

function persistLocale(locale: SupportedLocale) {
  try {
    localStorage.setItem(LOCALE_COOKIE, locale);
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; SameSite=Lax`;
  } catch (e) {}
  document.documentElement.lang = locale;
}

interface LanguageContextType {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (keyPath: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({
  initialLocale,
  localeFromCookie = false,
  children,
}: {
  initialLocale?: SupportedLocale;
  localeFromCookie?: boolean;
  children: React.ReactNode;
}) {
  // Seeded from what the server rendered with, so the first client render
  // matches the server markup.
  const [locale, setLocaleState] = useState<SupportedLocale>(initialLocale ?? DEFAULT_LOCALE);

  useEffect(() => {
    if (localeFromCookie) return;
    // No cookie reached the server: it guessed from Accept-Language (or had no
    // request at all). A choice saved before the cookie existed lives only in
    // localStorage, so honour it once; either way, write the cookie so later
    // requests render the right language on the server.
    let saved: SupportedLocale | null = readLocaleCookie();
    if (!saved) {
      try {
        saved = asSupportedLocale(localStorage.getItem(LOCALE_COOKIE));
      } catch (e) {}
    }
    const chosen = saved ?? locale;
    if (chosen !== locale) setLocaleState(chosen);
    persistLocale(chosen);
  }, []);

  const setLocale = useCallback((newLocale: SupportedLocale) => {
    setLocaleState(newLocale);
    persistLocale(newLocale);
  }, []);

  const t = useCallback((keyPath: string, params?: Record<string, string | number>): string => {
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
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return (
    <LanguageContext.Provider value={value}>
      <div>{children}</div>
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
