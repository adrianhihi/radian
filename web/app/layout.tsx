import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { ReferralCapture } from "@/components/ReferralCapture";

export const metadata: Metadata = {
  title: "Radian: fair launches on Arc and Robinhood Chain",
  description:
    "Launch a token in one transaction on Circle's Arc chain or Robinhood Chain, priced in a stablecoin or a stock. Fair bonding-curve discovery, permanently locked liquidity, graduation into Uniswap V4.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          <ReferralCapture />
          {children}
        </Providers>
      </body>
    </html>
  );
}
