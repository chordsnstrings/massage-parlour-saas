import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'spamanagement.co',
    short_name: 'Spa',
    description: 'Run your spa: bookings, payments, team and website.',
    start_url: '/',
    display: 'standalone',
    background_color: '#fafaf8',
    theme_color: '#fafaf8',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  }
}
