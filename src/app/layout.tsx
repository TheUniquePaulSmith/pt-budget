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
      <head>
        <meta httpEquiv="origin-trial" content="AtEQYSKQCqI9urnL86o2cWOq6bCZp5g3Y2rvuqNBtznSnk6d67XqQ6Jh1dXQ9aZqO7XqXkQPaBryyZjS1U9XKQ0AAABfeyJvcmlnaW4iOiJodHRwczovL2Rldi5wdGJ1ZGdldC5vcmc6NDQzIiwiZmVhdHVyZSI6IlNoYXJlZFdvcmtlck9uQW5kcm9pZCIsImV4cGlyeSI6MTc3NDMxMDQwMH0=" />
      </head>
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
