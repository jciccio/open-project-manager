export type SupportedLocale = "en" | "es";

export const DEFAULT_LOCALE: SupportedLocale = "en";
export const LOCALE_COOKIE = "opm_locale";

export function asSupportedLocale(value: string | null | undefined): SupportedLocale | null {
  return value === "en" || value === "es" ? value : null;
}

export function localeFromAcceptLanguage(header: string | null | undefined): SupportedLocale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { language: tag.trim().toLowerCase().split("-")[0], q: Number.isNaN(q) ? 0 : q, index };
    })
    .filter((entry) => entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);

  for (const { language } of ranked) {
    const locale = asSupportedLocale(language);
    if (locale) return locale;
  }
  return null;
}

export function resolveLocale(cookieValue: string | null | undefined, acceptLanguage: string | null | undefined) {
  const fromCookie = asSupportedLocale(cookieValue);
  if (fromCookie) return { locale: fromCookie, fromCookie: true };
  return { locale: localeFromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE, fromCookie: false };
}

export function intlLocale(locale: SupportedLocale): string {
  return locale === "es" ? "es-ES" : "en-US";
}
