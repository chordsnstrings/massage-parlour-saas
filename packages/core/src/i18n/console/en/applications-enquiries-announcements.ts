// Console page group "applications-enquiries-announcements" (R22, EN source): Console → Applications, Enquiries, Announcements (applications/**, enquiries/**, announcements/**).
// Owned by that group's conversion — only it edits this file and ar/applications-enquiries-announcements.ts (mirror every key there).
// Keys: one namespace per page (registered in console/en.ts already); `domainErrors` = the services' DomainError
// texts these pages show, copied exactly from en/domain.ts under the same id (merged into `errors.domain`).
// Recipe, key naming and the glossary: docs/design/console-i18n.md.
export const applications = {
  title: 'Applications',
  description: 'New spas apply here. Accept to create the spa and record the setup payment, or reject.',
} as const

/** Console → Enquiries: messages from the marketing site's Contact page (the spa catalogue owns `enquiries`). */
export const contactEnquiries = {
  title: 'Enquiries',
  description:
    'Messages from the Contact page. Reply by phone, WhatsApp or email, then mark them contacted or closed.',
} as const

export const announcements = {
  title: 'Announcements',
  description:
    'Notices shown at the top of the spa dashboard (each member can dismiss them). Never sent by email or SMS.',
} as const

export const domainErrors = {} as const
