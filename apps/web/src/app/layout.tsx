import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CanchaYa · Panel de reservas",
  description: "Nunca más pierdes una reserva por no contestar.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-CO">
      <body className="min-h-screen bg-slate-950 text-slate-50 antialiased">{children}</body>
    </html>
  );
}

