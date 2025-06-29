import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { CustomThemeProvider } from "../theme/theme";
import { DatabaseProvider } from "../contexts/DatabaseContext";
import { LoggingProvider } from "../contexts/LoggingContext";

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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <LoggingProvider>
        <CustomThemeProvider>
          <DatabaseProvider>
            
              {children}
            
          </DatabaseProvider>
        </CustomThemeProvider>
        </LoggingProvider>
      </body>
    </html>
  );
}
