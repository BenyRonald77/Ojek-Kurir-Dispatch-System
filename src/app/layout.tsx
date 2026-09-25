import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ojek/Kurir Dispatch System",
  description: "Dispatch order ke driver terdekat secara sekuensial dengan pelacakan lokasi realtime.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
