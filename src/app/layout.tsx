import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// Variable Plex Sans with the width axis: body at 100%, display condensed via font-stretch.
const plexSans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], axes: ["wdth"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "Synapse — Flight recorder for paying AI agents",
  description:
    "Agents plan, buy data over x402 and settle outcome-based escrow on Monad. Every payment, checkpoint and crash is recorded, so a backup worker resumes without paying twice.",
};

// Apply the saved theme before paint to avoid a flash. Storage can be unavailable; default to light.
const themeInit = `try{var t=localStorage.getItem("synapse-theme");if(t==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
