import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles.css";
import "./audit.css";

export const metadata: Metadata = {
  title: "OpenFinance Supplier Portal · Acme AP",
  description: "Authenticated Acme AP supplier portal with 12 WebMCP tools for governed invoice submission, exception handling, buyer cases, and payment remittance.",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="alternate" type="text/plain" href="/llms.txt" title="Agent-readable project guide" />
      </head>
      <body>{children}</body>
    </html>
  );
}
