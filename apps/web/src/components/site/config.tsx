import type { Config, Field, PuckContext } from '@puckeditor/core'
import { ButtonGroup, Gallery, Heading, Hero, Image, RichText } from './blocks/elements'
import { globalSectionBlock } from './blocks/global'
import { Columns, Section, Spacer, Stack, withAdvanced } from './blocks/layout'
import {
  BookingCTA,
  FAQ,
  Footer,
  OpeningHours,
  ServicesMenu,
  Team,
  Testimonials,
  WhatsAppButton,
} from './blocks/smart'
import { CONTENT_KEYS } from './content'
import { biField } from './field-defs'
import { SiteFrame } from './frame'
import { themeVars } from './theme'
import type { SiteMeta } from './types'

/**
 * Puck config shared by the public renderer (RSC `Render`) and the editor. Render functions are pure and
 * server-safe; only the custom field UIs are client components.
 */
export const siteConfig: Config = {
  categories: {
    layout: { title: 'Layout', components: ['Section', 'Columns', 'Stack', 'Spacer'] },
    content: {
      title: 'Content',
      components: ['Hero', 'Heading', 'RichText', 'ButtonGroup', 'Image', 'Gallery'],
    },
    smart: {
      title: 'Live from your dashboard',
      components: ['ServicesMenu', 'Team', 'OpeningHours', 'BookingCTA', 'WhatsAppButton'],
    },
    more: { title: 'More', components: ['Testimonials', 'FAQ', 'Footer'] },
    // Inserted from the editor's library only (it references a saved section).
    global: { title: 'Global sections', components: ['GlobalSection'], visible: false },
  },
  components: {
    // Bands carry the Advanced group (schedule + scoped custom CSS, PLAN §11.3 layer 6).
    Section: withAdvanced(Section),
    Columns,
    Stack,
    Spacer,
    Hero: withAdvanced(Hero),
    Heading,
    RichText,
    ButtonGroup,
    Image,
    Gallery: withAdvanced(Gallery),
    ServicesMenu: withAdvanced(ServicesMenu),
    Team: withAdvanced(Team),
    OpeningHours: withAdvanced(OpeningHours),
    BookingCTA: withAdvanced(BookingCTA),
    WhatsAppButton,
    Testimonials: withAdvanced(Testimonials),
    FAQ: withAdvanced(FAQ),
    Footer: withAdvanced(Footer),
    GlobalSection: globalSectionBlock(() => siteConfig),
  },
  root: {
    fields: {
      title: biField('Page title (search results)'),
      description: biField('Page description (search results)', { multiline: true }),
    },
    render: ({ children, puck }: { children: React.ReactNode; puck: PuckContext }) => {
      const meta = puck.metadata as SiteMeta & { bare?: boolean }
      // `bare`: theme only, no header — the modal editor for one global section.
      if (meta.bare)
        return (
          <div
            className="site-root"
            dir={meta.locale === 'ar' ? 'rtl' : 'ltr'}
            lang={meta.locale}
            data-motion="none"
            style={themeVars(meta.theme)}
          >
            {children}
          </div>
        )
      return <SiteFrame meta={meta}>{children}</SiteFrame>
    },
  },
}

/**
 * Editor config for a member's permissions: without `site.design`, layout/style fields are hidden so a
 * content editor only sees text and images (structure is locked via Puck permissions too).
 */
export function editorConfig(canDesign: boolean): Config {
  if (canDesign) return siteConfig
  const lock = (fields: Record<string, Field> | undefined) =>
    Object.fromEntries(
      Object.entries(fields ?? {}).map(([key, f]) => [
        key,
        CONTENT_KEYS.has(key) ? f : { ...f, visible: false },
      ]),
    )
  return {
    ...siteConfig,
    components: Object.fromEntries(
      Object.entries(siteConfig.components).map(([name, c]) => [
        name,
        { ...c, fields: lock(c.fields as Record<string, Field>) },
      ]),
    ),
  }
}
