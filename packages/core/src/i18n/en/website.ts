// `website` namespace (EN source). Only the website screens edit this file; mirror every key in th/website.ts.
// R23: the Website Studio lives in the platform console (English only); these are the spa's own Website page texts.
export const website = {
  title: 'Website',
  previewMeta: 'Preview',
  descSpa:
    'Our studio designs and publishes your website. Keep your services and prices current here, and ask us for any other change.',
  menu: {
    title: 'Services & prices',
    sub: 'What your website lists. Changes show on your live site straight away — no publishing needed.',
    readOnly: 'What your website lists. Ask an owner or manager to change services or prices.',
    viewLive: 'View live site',
    allServices: 'All service settings',
    onSite: 'On the website',
    notOnSite: 'Not on the website',
    emptyTitle: 'No services yet',
    emptyBody: 'Add your treatments under Services & rooms and they appear on your website.',
  },
  craftingTitle: 'Our studio is crafting your website',
  craftingBody:
    "We design every spa's site by hand from your menu, team and photos. Send us anything you'd like included.",
  live: 'Live',
  copyLink: 'Copy link',
  preview: {
    title: 'Your website',
    building: 'In progress',
    draftNote: 'Preview of the latest version from our studio — not live yet.',
    frame: 'Preview of your website',
  },
  request: {
    title: 'Request a change',
    sub: "Tell our studio what you'd like changed. We update your site and reply here.",
    body: 'What should change?',
    bodyHint: 'New photos? Upload them to Media first and mention them here.',
    placeholder: 'e.g. Add our new opening hours banner on the home page and swap the main photo.',
    page: 'Page',
    submit: 'Send to studio',
    sent: 'Sent to our studio',
    tooShort: 'Tell us what you would like changed',
  },
  requests: 'Your requests',
  noRequests: 'No requests yet',
  noRequestsBody: 'New photos, a seasonal offer, different wording — just ask.',
  wholeSite: 'Whole site',
  studioReply: 'Studio: {text}',
  tooLong: 'Use at most 2,000 characters',
  // F15 blog: service validation messages (packages/services site-posts.ts); the blog UI is in the console.
  blog: {
    slugInvalid: 'Use lowercase letters, numbers and dashes',
    slugTaken: 'Another post already uses that address',
    coverInvalid: 'Choose a photo from the library or paste an https link',
    tooLong: 'This text is too long',
  },
} as const
