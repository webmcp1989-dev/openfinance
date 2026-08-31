import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles.css";
import "./audit.css";

export const metadata: Metadata = {
  title: "OpenFinance Supplier Portal · Acme AP",
  description: "WebMCP-enabled purchase orders and invoice submissions for Acme suppliers.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
