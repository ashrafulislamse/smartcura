import type { Metadata } from "next";
import { Manrope, Playfair_Display } from "next/font/google";
import "@/styles/globals.css";
import { Toaster } from "@/components/ui/toaster";
import DevelopmentIdentityBanner from "@/components/identity/DevelopmentIdentityBanner";
import IdentityProviderRegistrar from "@/components/identity/IdentityProviderRegistrar";

const manrope = Manrope({ 
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
});

export const metadata: Metadata = {
  title: "SmartCura Admin Portal",
  description: "Professional admin dashboard for managing the SmartCura telemedicine platform",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
          rel="stylesheet"
        />
      </head>
      <body className={`${manrope.variable} ${playfair.variable} font-sans antialiased`}>
        <IdentityProviderRegistrar />
        {children}
        <Toaster />
        <DevelopmentIdentityBanner />
      </body>
    </html>
  );
}
