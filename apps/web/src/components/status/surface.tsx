'use client'
// F24: the request's surface + document language, from the root layout (server/surface.ts), for the client error
// boundaries that render outside every surface layout (and its i18n provider).
import { PLATFORM_CONTACT_EMAIL } from '@spa/core'
import { errors as enErrors } from '@spa/core/i18n/en/errors'
import { errors as thErrors } from '@spa/core/i18n/th/errors'
import { createContext, use } from 'react'
import { ui } from '@/components/site/i18n'
import { lookOf, type StatusLook } from './status-page'

export type DocSurface = 'marketing' | 'app' | 'admin' | 'site' | 'domain'
export type SurfaceInfo = { surface: DocSurface; lang: string; dir: 'ltr' | 'rtl'; home: string }

const SurfaceContext = createContext<SurfaceInfo | null>(null)

export function SurfaceProvider({ value, children }: { value: SurfaceInfo; children: React.ReactNode }) {
  return <SurfaceContext value={value}>{children}</SurfaceContext>
}

export const useSurface = () => use(SurfaceContext)

export type ErrorCopy = {
  look: StatusLook
  title: string
  body: string
  retry: string
  home: string
  reference: (digest: string) => string
}

/** Error-page copy in the surface's language: dashboard EN/TH (catalogue), spa sites EN/AR, marketing + console EN. */
export function errorCopy(surface: DocSurface, lang: string): ErrorCopy {
  const look = lookOf(surface)
  if (look === 'crm') {
    const e = lang === 'th' ? thErrors : enErrors
    return {
      look,
      title: e.boundary.title,
      body: e.boundary.body,
      retry: e.boundary.retry,
      home: e.page.toDashboard,
      reference: (digest) => e.boundary.ref.replace('{digest}', digest),
    }
  }
  if (look === 'site') {
    const l = lang === 'ar' ? 'ar' : 'en'
    return {
      look,
      title: ui('errorTitle', l),
      body: ui('errorBody', l),
      retry: ui('retry', l),
      home: ui('backHome', l),
      reference: (digest) => ui('errorRef', l).replace('{digest}', digest),
    }
  }
  return {
    look,
    title: 'Something went wrong',
    body:
      look === 'console'
        ? 'The error was logged. Try again; the reference below finds it in the server logs.'
        : `We’ve been notified. Try again — if it keeps happening, write to ${PLATFORM_CONTACT_EMAIL} with the reference below.`,
    retry: 'Try again',
    home: look === 'console' ? 'Back to the console' : 'Back to home',
    reference: (digest) => `Ref ${digest}`,
  }
}
