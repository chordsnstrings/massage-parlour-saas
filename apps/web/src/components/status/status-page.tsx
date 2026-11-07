// F24: the shared 404 / error card, in each surface's look (status.css). No hooks: server not-found pages and client
// error boundaries both render it. Never shows an error message or stack — only the digest, for support.
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/noto-sans-thai'
import '@fontsource-variable/space-grotesk'
import './status.css'

export type StatusLook = 'crm' | 'marketing' | 'console' | 'site'

/** Which look a surface's status pages use. */
export const lookOf = (surface: string): StatusLook =>
  surface === 'app'
    ? 'crm'
    : surface === 'admin'
      ? 'console'
      : surface === 'site' || surface === 'domain'
        ? 'site'
        : 'marketing'

export function StatusPage({
  look,
  lang,
  dir = 'ltr',
  code,
  name,
  brand,
  title,
  body,
  reference,
  children,
}: {
  look: StatusLook
  lang: string
  dir?: 'ltr' | 'rtl'
  /** "404", or the short error label. */
  code?: string
  /** Spa name above the card (spa sites). */
  name?: string | null
  brand?: React.ReactNode
  title: string
  body: string
  /** "Ref {digest}" line (errors only). */
  reference?: string | null
  /** The way back: links / buttons with `sp-btn` classes. */
  children: React.ReactNode
}) {
  return (
    <main className="sp-status" data-look={look} data-status-page={code ?? 'error'} lang={lang} dir={dir}>
      <div className="sp-status__card">
        {brand && <div className="sp-status__brand">{brand}</div>}
        {name && <p className="sp-status__name">{name}</p>}
        {code && <p className="sp-status__code">{code}</p>}
        <h1 className="sp-status__title">{title}</h1>
        <p className="sp-status__body">{body}</p>
        <div className="sp-status__actions">{children}</div>
        {reference && <p className="sp-status__ref">{reference}</p>}
      </div>
    </main>
  )
}
