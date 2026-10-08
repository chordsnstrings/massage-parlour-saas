import Link from 'next/link'
import { Logo } from '@/components/brand'

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="anim-pop-in max-w-sm text-center">
        <Logo className="mx-auto h-9" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-[15px] text-muted">The page you’re looking for doesn’t exist or has moved.</p>
        <Link
          href="/"
          className="mt-8 inline-flex h-10 items-center rounded-lg border bg-surface px-4 text-sm font-medium transition-colors hover:bg-subtle"
        >
          Go home
        </Link>
      </div>
    </div>
  )
}
