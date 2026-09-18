import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ThemeProvider } from "@/components/ThemeProvider";
import { LanguageProvider } from "@/components/LanguageProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Open Project Manager",
  description: "Fast, lightweight self-hosted Kanban & task management tool inspired by Vikunja.",
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
};

// Painted before globals.css is available (guaranteed in `next dev`, possible on
// a cold cache in production) so the first frame is never the browser's default
// canvas. Keep in sync with --background / --foreground in globals.css.
const criticalThemeCss =
  "html{background-color:#f8fafc;color:#0f172a}html.dark{background-color:#0f172a;color:#f8fafc}";

// Runs synchronously in <head>, before first paint. The cookie is authoritative
// (the server already rendered from it); localStorage / the OS preference only
// decide the very first visit, and the result is written back to the cookie so
// every later request is server-rendered with the right theme.
const themeScript = `(function(){try{var m=document.cookie.match(/(?:^|; )opm_theme=(dark|light)/);var t=m?m[1]:null;if(!t){var s=null;try{s=localStorage.getItem('opm_theme');}catch(e){}t=(s==='dark'||s==='light')?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.cookie='opm_theme='+t+'; path=/; max-age=31536000; SameSite=Lax';}try{localStorage.setItem('opm_theme',t);}catch(e){}var d=document.documentElement;if(t==='dark'){d.classList.add('dark');}else{d.classList.remove('dark');}d.style.colorScheme=t;}catch(e){}})();`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const stored = cookieStore.get("opm_theme")?.value;
  // undefined = first visit: the server cannot know, so the inline script picks
  // before paint instead of us guessing and flashing.
  const theme = stored === "dark" || stored === "light" ? stored : undefined;

  return (
    <html
      lang="en"
      className={theme === "dark" ? "dark" : undefined}
      style={theme ? { colorScheme: theme } : undefined}
      suppressHydrationWarning
    >
      <head>
        <meta name="color-scheme" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: criticalThemeCss }} />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider initialTheme={theme}>
          <LanguageProvider>{children}</LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
