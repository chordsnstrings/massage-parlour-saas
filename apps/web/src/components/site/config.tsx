import type { Config, Field, PuckContext } from '@puckeditor/core'
import { ButtonGroup, Gallery, Heading, Hero, Image, RichText } from './blocks/elements'
import { Columns, Section, Spacer, Stack } from './blocks/layout'
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
  },
  components: {
    Section,
    Columns,
    Stack,
    Spacer,
    Hero,
    Heading,
    RichText,
    ButtonGroup,
    Image,
    Gallery,
    ServicesMenu,
    Team,
    OpeningHours,
    BookingCTA,
    WhatsAppButton,
    Testimonials,
    FAQ,
    Footer,
  },
  root: {
    fields: {
      title: biField('Page title (search results)'),
      description: biField('Page description (search results)', { multiline: true }),
    },
    render: ({ children, puck }: { children: React.ReactNode; puck: PuckContext }) => (
      <SiteFrame meta={puck.metadata as SiteMeta}>{children}</SiteFrame>
    ),
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
