import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BizFlow AI - Retail Management SaaS",
  description: "AI-powered multi-tenant retail SaaS platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}

