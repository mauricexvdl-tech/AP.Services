import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Wallet, WalletAdvancedDefault } from "@coinbase/onchainkit/wallet";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "APORIA Agent Manager",
  description: "Sovereign AI Agent Management on Base L2",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} antialiased min-h-screen bg-background flex flex-col`}>
        <Providers>
          <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container flex h-14 max-w-screen-2xl items-center px-4">
              <div className="flex items-center space-x-2 mr-6">
                <div className="h-6 w-6 rounded bg-primary text-primary-foreground flex items-center justify-center font-bold font-mono text-xs">
                  A
                </div>
                <span className="font-bold tracking-tight">APORIA</span>
              </div>
              <nav className="flex items-center space-x-6 text-sm font-medium">
                <a href="/" className="transition-colors hover:text-foreground/80 text-foreground">
                  Dashboard
                </a>
                <a href="/mint" className="transition-colors hover:text-foreground/80 text-foreground/60">
                  Deploy
                </a>
              </nav>
              <div className="flex flex-1 items-center justify-end space-x-4">
                <Wallet>
                  <WalletAdvancedDefault />
                </Wallet>
              </div>
            </div>
          </header>
          <main className="flex-1 container max-w-screen-2xl py-6 px-4">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
