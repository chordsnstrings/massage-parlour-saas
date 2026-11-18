import { StudioI18n } from '@/components/site/studio-i18n'

/** R23: the spa website pages share client parts (media library, image fields) with the spa dashboard. */
export default function SpaWebsiteLayout({ children }: { children: React.ReactNode }) {
  return <StudioI18n>{children}</StudioI18n>
}
