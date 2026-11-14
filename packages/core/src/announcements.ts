// Announcements from the platform to spas (F20, PLAN §17): shown as a dismissible banner in the spa dashboard,
// never sent by email/SMS. Text is typed by a super-admin (EN, optional TH that falls back to EN).

export const ANNOUNCEMENT_SEVERITIES = ['info', 'warning', 'critical'] as const
export type AnnouncementSeverity = (typeof ANNOUNCEMENT_SEVERITIES)[number]
export const ANNOUNCEMENT_AUDIENCES = ['all', 'plan', 'tenants'] as const
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number]

/** Title + body in the viewer's dashboard language (TH when typed, else EN). */
export function announcementCopy(
  a: { titleEn: string; titleTh: string | null; bodyEn: string; bodyTh: string | null },
  locale: string,
) {
  const th = locale === 'th'
  return {
    title: (th && a.titleTh?.trim()) || a.titleEn,
    body: (th && a.bodyTh?.trim()) || a.bodyEn,
  }
}
