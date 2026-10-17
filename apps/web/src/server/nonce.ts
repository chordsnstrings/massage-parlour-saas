import { headers } from 'next/headers'

/**
 * This request's CSP nonce (F10, set by proxy.ts) for our own inline <script> tags; Next stamps its own scripts.
 * Reading headers() also keeps the page dynamic, which nonces require (a prerendered page has no nonce).
 */
export async function getNonce(): Promise<string | undefined> {
  return (await headers()).get('x-nonce') ?? undefined
}
