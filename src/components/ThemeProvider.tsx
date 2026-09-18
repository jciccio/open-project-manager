"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function disableTransitions() {
  if (typeof document === "undefined") return () => {};
  document.documentElement.classList.add("disable-theme-transitions");
  return () => {
    window.getComputedStyle(document.documentElement).opacity;
    document.documentElement.classList.remove("disable-theme-transitions");
  };
}

export function ThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme?: Theme;
  children: React.ReactNode;
}) {
  // Seeded from the cookie the server rendered with, so the first client render
  // matches the server markup. Reading the DOM here instead would re-introduce
  // the hydration mismatch this provider is meant to avoid.
  const [theme, setThemeState] = useState<Theme>(initialTheme ?? "light");

  useEffect(() => {
    // First visit only: no cookie existed, so the inline head script - not the
    // server - decided the theme. Catch up to whatever it applied. Runs after
    // hydration, so it cannot cause a flash.
    if (initialTheme) return;
    const activeTheme: Theme = document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";
    if (theme !== activeTheme) {
      setThemeState(activeTheme);
    }
  }, []);

  function setTheme(newTheme: Theme) {
    const enableTransitions = disableTransitions();
    setThemeState(newTheme);
    try {
      localStorage.setItem("opm_theme", newTheme);
      document.cookie = `opm_theme=${newTheme}; path=/; max-age=31536000; SameSite=Lax`;
    } catch (e) {}

    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.style.colorScheme = "dark";
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.style.colorScheme = "light";
    }
    enableTransitions();
  }

  function toggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
