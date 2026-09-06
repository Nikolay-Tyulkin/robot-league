import type { Metadata, Viewport } from 'next';
import './globals.css';
import './mobile.css';
import './menu.css'; // Home, mode setup and room selection.

export const metadata: Metadata = {
  title: 'Robot League — Garage Football',
  description: 'Small robots. Big attitude. Watti versus Microduck, with Reachy Mini as referee.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#1b282b', interactiveWidget: 'resizes-content' };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}

