import { intlLocale, type SupportedLocale } from "@/lib/locale";

type DateInput = Date | string | number;

// Due dates are calendar days stored as UTC midnight, so they are formatted in
// UTC: every browser and the server then agree on the day.
export function formatDueDate(value: DateInput, locale: SupportedLocale, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone: "UTC" }).format(new Date(value));
}

export function formatDate(value: DateInput, locale: SupportedLocale, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(new Date(value));
}
