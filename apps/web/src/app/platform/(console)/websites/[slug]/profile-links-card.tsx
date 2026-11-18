// R33 console spa website page: the spa's Profile links (JSON-LD sameAs) — saved ones + the connected accounts'.
import { withTenant } from '@spa/db'
import { ExternalLink, Link2 } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/card'
import { type AutoProfile, spaProfiles } from '@/server/seo'
import { ProfileLinksSheet } from './profile-links-form'

const FROM: Record<AutoProfile['source'], string> = {
  instagram: 'From the connected Instagram',
  facebook: 'From the connected Facebook Page',
}

const row = 'flex items-start gap-3 px-[var(--ui-card-pad,1.25rem)] py-3 sm:px-[var(--ui-card-pad-sm,1.5rem)]'

function LinkRow({ url, note }: { url: string; note?: string }) {
  return (
    <li className={row}>
      <Link2 className="mt-0.5 size-4 shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-full items-center gap-1 break-all text-sm font-medium hover:underline"
        >
          {url} <ExternalLink className="size-3.5 shrink-0 text-muted" />
        </a>
        {note && <span className="block text-xs text-muted">{note}</span>}
      </span>
    </li>
  )
}

export async function ProfileLinksCard({
  slug,
  tenantId,
  canEdit,
}: {
  slug: string
  tenantId: string
  /** site.publish: the links are live as soon as they are saved. */
  canEdit: boolean
}) {
  const { manual, automatic } = await withTenant(tenantId, (tx) => spaProfiles(tx, tenantId))
  const auto = automatic.filter((a) => !manual.includes(a.url))
  return (
    <Card data-testid="profile-links">
      <CardHeader
        title="Profile links"
        description="Official profiles in the site's search data (schema sameAs), next to the Google Maps pin."
        action={canEdit && <ProfileLinksSheet slug={slug} links={manual} />}
      />
      {manual.length + auto.length > 0 ? (
        <ul className="mt-3 divide-y border-t" aria-label="Profile links">
          {manual.map((url) => (
            <LinkRow key={url} url={url} />
          ))}
          {auto.map((a) => (
            <LinkRow key={a.url} url={a.url} note={FROM[a.source]} />
          ))}
        </ul>
      ) : (
        <p className="px-[var(--ui-card-pad,1.25rem)] pt-3 pb-[var(--ui-card-pad,1.25rem)] text-sm text-muted sm:px-[var(--ui-card-pad-sm,1.5rem)] sm:pb-[var(--ui-card-pad-sm,1.5rem)]">
          No profile links yet. Add the Google Business Profile share link and the spa's social profiles.
        </p>
      )}
    </Card>
  )
}
