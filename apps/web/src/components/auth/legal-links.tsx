import { getT } from '@/i18n/server'
import { marketingUrl } from '@/server/origin'

/** Small "Terms · Privacy" line under the sign-in / sign-up forms (links to the marketing legal pages). */
export async function LegalLinks() {
  const [t, base] = await Promise.all([getT(), marketingUrl()])
  return (
    <p className="mt-8 text-center text-[13px] text-muted">
      <a href={`${base}/terms`} className="hover:text-fg hover:underline">
        {t('auth.legal.terms')}
      </a>
      {' · '}
      <a href={`${base}/privacy`} className="hover:text-fg hover:underline">
        {t('auth.legal.privacy')}
      </a>
    </p>
  )
}
