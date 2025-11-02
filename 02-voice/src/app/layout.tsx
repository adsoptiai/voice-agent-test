import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voice Agent Demo",
  description: "Voice Agent Demo",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`antialiased`}>{children}</body>
    </html>
  );
}
