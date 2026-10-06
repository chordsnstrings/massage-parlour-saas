import type { Metadata, Viewport } from 'next'
import { MotionProvider } from '@/components/ui/motion'
import { Toaster } from '@/components/ui/toast'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Spa Management', template: '%s · Spa Management' },
  description: 'Bookings, payments, accounting, websites and AI marketing for spas in the UAE.',
  manifest: '/manifest.webmanifest',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafaf8' },
    { media: '(prefers-color-scheme: dark)', color: '#121211' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Scroll scenes run only with motion allowed; set before first paint so pins never shift the layout. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static inline bootstrap, no user input
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('scenes-on')}catch(e){}})()",
          }}
        />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        <MotionProvider>
          {children}
          <Toaster />
        </MotionProvider>
      </body>
    </html>
  )
}
