import Script from 'next/script'

/** Public tenant site wrapper: cookieless analytics for every page (incl. /book). */
export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return (
    <>
      {children}
      <Script src="/t.js" data-site={slug} strategy="afterInteractive" />
    </>
  )
}
