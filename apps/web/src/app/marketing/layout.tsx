import './marketing.css'

// Every marketing page links to the app (Sign in, Start) through APP_URL, which is only known at runtime — a page
// prerendered at image build time would link to localhost. Pages are cheap, so render them per request.
export const dynamic = 'force-dynamic'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return children
}
