import Script from 'next/script'

/** Custom-domain site wrapper: cookieless analytics for every page. */
export default async function DomainLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ hostname: string }>
}) {
  const { hostname } = await params
  return (
    <>
      {children}
      <Script src="/t.js" data-site={decodeURIComponent(hostname)} strategy="afterInteractive" />
    </>
  )
}
