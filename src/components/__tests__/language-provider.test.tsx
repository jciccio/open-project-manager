import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { LanguageProvider, useTranslation } from "../LanguageProvider";

function SsoTitle() {
  const { t } = useTranslation();
  return <p>{t("profileModal.ssoTitle")}</p>;
}

function clearLocaleCookie() {
  document.cookie = "opm_locale=; path=/; max-age=0";
}

describe("LanguageProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    clearLocaleCookie();
    document.documentElement.lang = "en";
  });

  it("renders the server's locale on the very first render", () => {
    localStorage.setItem("opm_locale", "en");
    render(
      <LanguageProvider initialLocale="es" localeFromCookie>
        <SsoTitle />
      </LanguageProvider>
    );

    expect(screen.getByText("Inicio de Sesión Único")).toBeInTheDocument();
  });

  it("adopts a choice saved before the cookie existed and writes the cookie", async () => {
    localStorage.setItem("opm_locale", "es");
    render(
      <LanguageProvider initialLocale="en" localeFromCookie={false}>
        <SsoTitle />
      </LanguageProvider>
    );

    expect(await screen.findByText("Inicio de Sesión Único")).toBeInTheDocument();
    expect(document.cookie).toContain("opm_locale=es");
    expect(document.documentElement.lang).toBe("es");
  });

  it("writes the server's guess to the cookie when nothing was saved", async () => {
    render(
      <LanguageProvider initialLocale="es" localeFromCookie={false}>
        <SsoTitle />
      </LanguageProvider>
    );

    await waitFor(() => expect(document.cookie).toContain("opm_locale=es"));
    expect(screen.getByText("Inicio de Sesión Único")).toBeInTheDocument();
  });

  it("leaves a cookie-backed locale alone even if localStorage disagrees", async () => {
    localStorage.setItem("opm_locale", "es");
    render(
      <LanguageProvider initialLocale="en" localeFromCookie>
        <SsoTitle />
      </LanguageProvider>
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText("Single Sign-On")).toBeInTheDocument();
  });
});
