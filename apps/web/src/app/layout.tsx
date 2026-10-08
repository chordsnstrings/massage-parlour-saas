import type { Metadata, Viewport } from 'next'
import { MotionProvider } from '@/components/ui/motion'
import { Toaster } from '@/components/ui/toast'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'spamanagement.co', template: '%s · spamanagement.co' },
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
    // data-scroll-behavior: the marketing pages scroll smoothly to in-page anchors; route changes still jump.
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        {/* Scroll scenes run for every visitor (owner decision: also with OS reduced motion); set before first paint so pins never shift the layout. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static inline bootstrap, no user input
          dangerouslySetInnerHTML={{
            __html: "document.documentElement.classList.add('scenes-on')",
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
