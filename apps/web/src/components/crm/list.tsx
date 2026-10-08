import Link from 'next/link'
import { cn } from '@/lib/utils'

/** List row (crm-spec §3 `.row`): icon tile, title + body, time/meta, end slot (toggle, pill, buttons). */
export function ListRow({
  icon,
  title,
  body,
  time,
  end,
  href,
  className,
}: {
  icon?: React.ReactNode
  title: React.ReactNode
  body?: React.ReactNode
  time?: React.ReactNode
  end?: React.ReactNode
  /** Makes the whole row a link (don't combine with interactive `end` content). */
  href?: string
  className?: string
}) {
  const inner = (
    <>
      {icon && (
        <span className="crm-ricon" aria-hidden>
          {icon}
        </span>
      )}
      <span className="crm-rbody">
        <b className="block">{title}</b>
        {body && <p>{body}</p>}
      </span>
      {time && <span className="crm-rtime">{time}</span>}
      {end && <span className="crm-rend">{end}</span>}
    </>
  )
  return href ? (
    <Link href={href} className={cn('crm-row', className)}>
      {inner}
    </Link>
  ) : (
    <div className={cn('crm-row', className)}>{inner}</div>
  )
}
