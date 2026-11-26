import { act, render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { ThemeProvider, useTheme } from "../ThemeProvider";

function ThemeProbe() {
  const { theme, toggleTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggleTheme}>toggle</button>
      <button onClick={() => setTheme("light")}>light</button>
    </div>
  );
}

const html = document.documentElement;

beforeEach(() => {
  html.classList.remove("dark", "disable-theme-transitions");
  html.style.colorScheme = "";
  localStorage.clear();
  document.cookie = "opm_theme=; path=/; max-age=0";
});

describe("ThemeProvider", () => {
  it("starts from the server's theme even when the page class says otherwise", () => {
    html.classList.add("dark");

    render(
      <ThemeProvider initialTheme="light">
        <ThemeProbe />
      </ThemeProvider>
    );

    expect(screen.getByTestId("theme")).toHaveTextContent("light");
  });

  it("on a first visit, adopts the theme the head script applied", () => {
    html.classList.add("dark");

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    );

    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
  });

  it("defaults to light on a first visit with no dark class", () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    );

    expect(screen.getByTestId("theme")).toHaveTextContent("light");
  });

  it("toggles the theme and applies it to the page, localStorage and the cookie", () => {
    render(
      <ThemeProvider initialTheme="light">
        <ThemeProbe />
      </ThemeProvider>
    );

    act(() => screen.getByRole("button", { name: "toggle" }).click());

    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(html).toHaveClass("dark");
    expect(html.style.colorScheme).toBe("dark");
    expect(localStorage.getItem("opm_theme")).toBe("dark");
    expect(document.cookie).toContain("opm_theme=dark");
    expect(html).not.toHaveClass("disable-theme-transitions");

    act(() => screen.getByRole("button", { name: "toggle" }).click());

    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(html).not.toHaveClass("dark");
    expect(html.style.colorScheme).toBe("light");
    expect(localStorage.getItem("opm_theme")).toBe("light");
    expect(document.cookie).toContain("opm_theme=light");
  });

  it("sets a theme directly", () => {
    render(
      <ThemeProvider initialTheme="dark">
        <ThemeProbe />
      </ThemeProvider>
    );

    act(() => screen.getByRole("button", { name: "light" }).click());

    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(localStorage.getItem("opm_theme")).toBe("light");
  });

  it("throws when useTheme is used outside the provider", () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      expect(() => render(<ThemeProbe />)).toThrow("useTheme must be used within a ThemeProvider");
    } finally {
      console.error = quiet;
    }
  });
});
