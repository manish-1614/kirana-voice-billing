import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kirana Voice Billing',
  description: 'Voice-driven instant billing for Ranchi kirana counters powered by Gemini Live',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 select-none">
        {children}
      </body>
    </html>
  );
}
