'use client'
import { authClient } from '@spa/auth/client'
import { ArrowLeftRight, LogOut, UserRound } from 'lucide-react'
import Link from 'next/link'
import { DropdownMenu } from 'radix-ui'
import { surfaceBaseOf } from '@/lib/paths'
import { cn, initials } from '@/lib/utils'

const item =
  'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm text-fg outline-none data-[highlighted]:bg-subtle [&_svg]:size-4 [&_svg]:text-muted'

export function UserMenu({
  user,
  compact,
  accountHref = '/account',
  switchHref,
}: {
  user: { name: string; email: string }
  compact?: boolean
  accountHref?: string
  switchHref?: string
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(
          'flex w-full items-center gap-3 rounded-lg p-1.5 text-start outline-none transition-colors hover:bg-subtle data-[state=open]:bg-subtle',
          compact && 'w-auto',
        )}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
          {initials(user.name)}
        </span>
        {!compact && (
          <span className="min-w-0 md:hidden xl:block">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block truncate text-xs text-muted">{user.email}</span>
          </span>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          side="top"
          sideOffset={8}
          className="z-50 min-w-56 rounded-xl border bg-surface p-1.5 shadow-pop data-[state=open]:anim-menu-in"
        >
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item asChild className={item}>
            <Link href={accountHref}>
              <UserRound /> Account & security
            </Link>
          </DropdownMenu.Item>
          {switchHref && (
            <DropdownMenu.Item asChild className={item}>
              <Link href={switchHref}>
                <ArrowLeftRight /> Switch spa
              </Link>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item
            className={item}
            onSelect={async () => {
              await authClient.signOut()
              window.location.href = `${surfaceBaseOf(window.location.pathname)}/login`
            }}
          >
            <LogOut /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
