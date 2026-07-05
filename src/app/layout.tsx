import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MyPatient Journey",
  description: "Every patient. Every recall. Every follow-up tracked.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
