import { StudioI18n } from '@/components/site/studio-i18n'
import { requirePlatformAdmin } from '@/server/access'

/**
 * R23 Website Studio, full screen (page editor, draft preview): super-admins only, without the console shell. The
 * spa website page itself lives in the console (`(console)/websites/[slug]`).
 */
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin()
  return <StudioI18n>{children}</StudioI18n>
}
