import type { Instrumentation } from 'next'

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { registerEmailSettings } = await import('./server/email-settings')
  registerEmailSettings()
}

/** Server errors (render, route handlers, server actions, proxy) → Sentry-compatible endpoint when SENTRY_DSN is set. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (!process.env.SENTRY_DSN) return
  const { reportError } = await import('@spa/core')
  await reportError(process.env.SENTRY_DSN, err, {
    source: 'web',
    environment: process.env.NODE_ENV,
    release: process.env.APP_RELEASE,
    request: { url: request.path, method: request.method },
    tags: { route: context.routePath, routeType: context.routeType, renderSource: context.renderSource },
  })
}
