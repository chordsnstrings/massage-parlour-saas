import { ImageResponse } from 'next/og'
import { isMarketingPage, MARKETING_PAGES } from '@/components/marketing/seo'

// Served on every host as /og/{page}.png (image paths skip the proxy rewrite); the marketing metadata links them.
const INK = '#17181A'
const LIME = '#D9F26A'
const CREAM = '#F7F3EA'
const MINT = '#E6F2EA'
const GREEN = '#0F6B4B'

/** Generated 1200×630 Open Graph / Twitter card for a marketing page: SM badge, wordmark and the page headline. */
export async function GET(_req: Request, { params }: { params: Promise<{ page: string }> }) {
  const key = (await params).page.replace(/\.png$/, '')
  if (!isMarketingPage(key)) return new Response('Not found', { status: 404 })
  const { headline } = MARKETING_PAGES[key]
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        background: `linear-gradient(135deg, ${CREAM} 0%, ${MINT} 100%)`,
        color: INK,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <div
          style={{
            width: 112,
            height: 112,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: LIME,
            borderRadius: 30,
            transform: 'rotate(-7deg)',
          }}
        >
          <div style={{ fontSize: 58, fontStyle: 'italic', letterSpacing: -6, lineHeight: 1 }}>SM</div>
          <div style={{ width: 70, height: 6, marginTop: 8, borderRadius: 3, background: CREAM }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 40, lineHeight: 1.05 }}>
          <span>Spa</span>
          <span>Management</span>
        </div>
      </div>
      <div style={{ display: 'flex', fontSize: 76, lineHeight: 1.08, letterSpacing: -2, maxWidth: 980 }}>
        {headline}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 30, color: GREEN }}>
        <div style={{ width: 14, height: 14, borderRadius: 7, background: GREEN }} />
        spamanagement.co · Built for UAE spas
      </div>
    </div>,
    { width: 1200, height: 630, headers: { 'cache-control': 'public, max-age=86400' } },
  )
}
