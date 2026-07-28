import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "@/components/ui/sonner";
import { SITE } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const DESCRIPTION =
  "Software shaped around how your business actually runs — on the job site, on the floor, and in the paperwork that follows. A real person reviews what matters. Grow without building an office.";

export const metadata: Metadata = {
  // Without this, Next resolves the relative OG image against localhost and
  // every shared link previews with a broken image.
  metadataBase: new URL(SITE.url),
  title: {
    default: "Yosher — The Outsourced Business Office",
    template: "%s · Yosher",
  },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: "Yosher — The Outsourced Business Office",
    description: DESCRIPTION,
    images: ["/yosher-logo.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Yosher — The Outsourced Business Office",
    description: DESCRIPTION,
    images: ["/yosher-logo.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col font-sans">
          {children}
          <Toaster position="bottom-right" />
        </body>
      </html>
    </ClerkProvider>
  );
}
