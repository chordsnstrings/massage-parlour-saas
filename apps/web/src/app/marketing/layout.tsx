import '@fontsource-variable/plus-jakarta-sans'
import './marketing.css'

// Pages render per request: the shell's links come from the visitor's domain (server/origin.ts reads headers()).
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return children
}
