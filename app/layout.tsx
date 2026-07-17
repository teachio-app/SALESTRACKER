import "./globals.css";
import { Inter } from "next/font/google";

// next/font downloads Inter at BUILD time and self-hosts it. No request to
// Google at runtime, no layout shift from a late-arriving webfont, and nothing
// to break if fonts.googleapis.com is blocked.
const inter = Inter({
  subsets: ["latin", "latin-ext"], // latin-ext carries á/č/ř/š/ž
  display: "swap",
  variable: "--font-sans",
});

export const metadata = {
  title: "TicketDesk",
  description: "Track ticket buys and sells",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
