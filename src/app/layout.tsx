import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { CustomThemeProvider } from "../theme/theme";
import { LoggingProvider } from "../contexts/LoggingContext";
import { LocaleProvider } from "../contexts/LocaleContext";
import { WllamaProvider } from "../contexts/WllamaContext";
import OfflineRuntime from "../components/common/Offline/OfflineRuntime";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Budget Tracker - Personal Finance Management",
  description: "Track your income, expenses, and budgets with powerful visualizations and insights.",
  // Installed on iOS: a standalone home-screen app (icon: src/app/apple-icon.png).
  // The web app manifest is src/app/manifest.ts.
  appleWebApp: {
    capable: true,
    title: "Budget Tracker", // i18n-ignore: app name, static like <title> and the manifest
    statusBarStyle: "default",
  },
};

// The browser / installed window's title bar follows the app bar colour.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1976d2" },
    { media: "(prefers-color-scheme: dark)", color: "#182235" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta httpEquiv="origin-trial" content="AtEQYSKQCqI9urnL86o2cWOq6bCZp5g3Y2rvuqNBtznSnk6d67XqQ6Jh1dXQ9aZqO7XqXkQPaBryyZjS1U9XKQ0AAABfeyJvcmlnaW4iOiJodHRwczovL2Rldi5wdGJ1ZGdldC5vcmc6NDQzIiwiZmVhdHVyZSI6IlNoYXJlZFdvcmtlck9uQW5kcm9pZCIsImV4cGlyeSI6MTc3NDMxMDQwMH0=" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <LoggingProvider>
          <LocaleProvider>
            <CustomThemeProvider>
              <WllamaProvider>
                {children}
              </WllamaProvider>
              <OfflineRuntime />
            </CustomThemeProvider>
          </LocaleProvider>
        </LoggingProvider>
      </body>
    </html>
  );
}
