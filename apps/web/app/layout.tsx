import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/toaster";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Unlimited Dialer Checker",
  description: "Caller-ID health, rotation and live agents for the VICIdial dialer",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
