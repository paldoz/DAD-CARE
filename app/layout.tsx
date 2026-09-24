import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import { LayoutWrapper } from '@/components/layout-wrapper';
import { ThemeProvider } from '@/components/theme-provider';
import { ServiceWorkerRegistration } from '@/components/service-worker-registration';
import { FetchInterceptor } from '@/components/fetch-interceptor';
import { SWRProvider } from '@/components/swr-provider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://www.buugaxisaabta.online'),
  title: 'Buuga Xisaabta - Nidaamka Maamulka Ganacsiga & Maqalka',
  description: 'Buuga Xisaabta waa nidaam casri ah oo lagu maamulo xisaabaadka ganacsiga, maqalka, daymaha, iyo lacagaha.',
  openGraph: {
    title: 'Buuga Xisaabta - Nidaamka Maamulka Ganacsiga & Maqalka',
    description: 'Buuga Xisaabta waa nidaam casri ah oo lagu maamulo xisaabaadka ganacsiga, maqalka, daymaha, iyo lacagaha.',
    url: 'https://www.buugaxisaabta.online',
    siteName: 'Buuga Xisaabta',
    locale: 'so_SO',
    type: 'website',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png?v=3', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png?v=3', sizes: '512x512', type: 'image/png' }
    ],
    apple: [
      { url: '/icons/icon-192.png?v=3' }
    ]
  },
  verification: {
    google: 'HNF7M4TLFDOA2ke26ARDnEDWn37ljTX9h6rOh2v_Wec',
  },
  manifest: '/manifest.json?v=3',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Buuga Xisaabta',
  },
};

export const viewport: import('next').Viewport = {
  themeColor: '#2563EB',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head />
      <body className={`${inter.className} h-full antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <SWRProvider>
            <LayoutWrapper>
              {children}
            </LayoutWrapper>
          </SWRProvider>
          <Toaster />
          <ServiceWorkerRegistration />
          <FetchInterceptor />
        </ThemeProvider>
      </body>
    </html>
  );
}
