import { describe, expect, it } from 'vitest'
import { blogPostJsonLd, mapEmbedSrc, parseVideoUrl, videoEmbedSrc, youtubePoster } from '../src'

describe('parseVideoUrl', () => {
  it('reads YouTube watch, share, shorts, embed and nocookie links (with a start time)', () => {
    const id = 'dQw4w9WgXcQ'
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://m.youtube.com/watch?v=${id}&feature=share`,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`,
      ` https://youtube.com/live/${id} `,
    ])
      expect(parseVideoUrl(url), url).toEqual({ provider: 'youtube', id })
    expect(parseVideoUrl(`https://youtu.be/${id}?t=90`)).toEqual({ provider: 'youtube', id, start: 90 })
    expect(parseVideoUrl(`https://www.youtube.com/watch?v=${id}&t=1m30s`)).toEqual({
      provider: 'youtube',
      id,
      start: 90,
    })
  })

  it('reads Vimeo pages and player links (private hash kept)', () => {
    expect(parseVideoUrl('https://vimeo.com/76979871')).toEqual({ provider: 'vimeo', id: '76979871' })
    expect(parseVideoUrl('https://vimeo.com/76979871/abc123def0')).toEqual({
      provider: 'vimeo',
      id: '76979871',
      hash: 'abc123def0',
    })
    expect(parseVideoUrl('https://player.vimeo.com/video/76979871?h=abc123def0')).toEqual({
      provider: 'vimeo',
      id: '76979871',
      hash: 'abc123def0',
    })
  })

  it('accepts uploaded library videos on the same origin only', () => {
    const file = '/files/3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'
    expect(parseVideoUrl(file)).toEqual({ provider: 'file', src: file })
    expect(parseVideoUrl(`${file}/tour.mp4`)).toEqual({ provider: 'file', src: `${file}/tour.mp4` })
    expect(parseVideoUrl('//files/3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b')).toBeNull()
  })

  it('refuses other hosts, bad ids, credentials and script URLs', () => {
    for (const bad of [
      '',
      'javascript:alert(1)',
      'data:video/mp4;base64,AAAA',
      'https://evil.test/watch?v=dQw4w9WgXcQ',
      'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ"onload=x',
      'https://user:pw@youtu.be/dQw4w9WgXcQ',
      'https://vimeo.com/channels/staffpicks',
      'https://cdn.example.com/video.mp4',
      `https://youtu.be/${'a'.repeat(600)}`,
    ])
      expect(parseVideoUrl(bad), bad).toBeNull()
  })
})

describe('video + map embed URLs', () => {
  it('plays YouTube privacy-enhanced and Vimeo with do-not-track', () => {
    expect(videoEmbedSrc({ provider: 'youtube', id: 'dQw4w9WgXcQ', start: 30 })).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1&start=30',
    )
    expect(videoEmbedSrc({ provider: 'vimeo', id: '1', hash: 'abcdef' })).toBe(
      'https://player.vimeo.com/video/1?autoplay=1&dnt=1&h=abcdef',
    )
    expect(videoEmbedSrc({ provider: 'file', src: '/files/x' })).toBeNull()
    expect(youtubePoster('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
  })

  it('embeds the pin coordinates when the Maps link has them, else the address', () => {
    expect(
      mapEmbedSrc({
        address: 'Marina Walk, Dubai',
        mapsUrl: 'https://www.google.com/maps/place/Spa/@25.08,55.14,17z/data=!3d25.0801!4d55.1402',
      }),
    ).toBe('https://www.google.com/maps?q=25.0801%2C55.1402&z=15&hl=en&output=embed')
    expect(mapEmbedSrc({ address: 'Shop 4, Marina Walk', mapsUrl: 'https://maps.app.goo.gl/x1' }, 'ar')).toBe(
      'https://www.google.com/maps?q=Shop%204%2C%20Marina%20Walk&z=15&hl=ar&output=embed',
    )
    expect(mapEmbedSrc({ address: '  ', mapsUrl: null })).toBeNull()
    expect(mapEmbedSrc(null)).toBeNull()
  })
})

describe('blogPostJsonLd', () => {
  it('adds a BlogPosting published by the spa, with a breadcrumb to the post', () => {
    const ld = blogPostJsonLd(
      { name: 'Birch Spa', url: 'https://birch.example/', pageUrl: 'https://birch.example/' },
      {
        url: 'https://birch.example/blog/hot-stones',
        headline: 'Why hot stones work',
        description: 'Warmth, pressure and calm.',
        image: 'https://birch.example/files/x',
        datePublished: new Date('2026-10-01T08:00:00Z'),
        inLanguage: 'en',
      },
    ) as { '@graph': Record<string, unknown>[] }
    const types = ld['@graph'].map((n) => n['@type'])
    expect(types).toEqual(['DaySpa', 'BreadcrumbList', 'BlogPosting'])
    const post = ld['@graph'][2]!
    expect(post).toMatchObject({
      headline: 'Why hot stones work',
      publisher: { '@id': 'https://birch.example/#spa' },
      datePublished: '2026-10-01T08:00:00.000Z',
      image: 'https://birch.example/files/x',
      inLanguage: 'en',
    })
  })
})
