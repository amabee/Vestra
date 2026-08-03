import { getSettings } from "@vestra/storage";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AppShell } from "@/components/layout/app-shell";
import { Providers } from "@/components/providers";
import { ThemeController } from "@/components/theme/theme-controller";
import { getDriver } from "@/lib/storage";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Vestra Atlas",
    template: "%s · Vestra",
  },
  description:
    "Vestra — anime, movies, TV, K-drama, YouTube and your local library, in one place.",
  applicationName: "Vestra",
};

export const viewport: Viewport = {
  themeColor: "#0d0d10",
  colorScheme: "dark",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Appearance lives in the JSON store, so the correct theme is applied on the
  // first paint rather than flashing the default.
  const settings = await getSettings(getDriver());

  return (
    // `dark` is the server default: Vestra is dark-first, and ThemeController
    // corrects it on the client if the user chose light or system.
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-dvh bg-background font-sans`}
      >
        <div className="app-aurora" aria-hidden="true" />
        <Providers>
          <ThemeController
            theme={settings.appearance.theme}
            accent={settings.appearance.accent}
            glassEffects={settings.appearance.glassEffects}
          />
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
