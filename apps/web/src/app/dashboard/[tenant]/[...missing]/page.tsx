import { notFound } from 'next/navigation'

/** F24: unknown dashboard paths 404 inside the spa shell (not-found.tsx), after the layout's member check. */
export default function MissingDashboardPage() {
  notFound()
}
