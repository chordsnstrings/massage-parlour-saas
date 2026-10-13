import type { ComponentConfig } from '@puckeditor/core'
import {
  HTML_DESIGN_SANDBOX,
  type HtmlDesignContent,
  type HtmlDesignDoc,
  type HtmlImageAdjust,
  htmlDesignDocOf,
  htmlDesignDocument,
  htmlDesignPhoneFixes,
  htmlPictureAdjustments,
} from '@spa/core'
import { lazy, Suspense } from 'react'
import { designKey, designWithCrm } from '../html-crm'
import { HtmlDesignFrame } from '../html-design-frame'
import { htmlDesignLinks, htmlDesignValues } from '../html-design-values'
import type { SiteMeta } from '../types'

/**
 * `doc` (R24): the design's stored file; `html` is then '' in the stored data and filled right before rendering
 * (server/html-design-files.ts; the editor gets it in `meta.htmlDocs`). Designs stored before keep `html` inline.
 * `images`: the super-admin's per-image adjustments (focal point, fill/fit, replacement), applied in the frame.
 * `phoneFixes` (R24): the design's "Phone fixes" switch. It has NO default on purpose (Puck merges defaults into loaded
 * props): absent = stored before R24 = on (`htmlDesignPhoneFixes`); every writer since stores an explicit boolean.
 * `content` (R28): the spa's website content — values over a CRM-contract design's own data, page texts, pictures
 * (P4: over `images` by id) — the stored file never changes. No default either: absent = the design's own values.
 */
type Props = {
  html: string
  doc?: HtmlDesignDoc
  images?: HtmlImageAdjust[]
  phoneFixes?: boolean
  content?: HtmlDesignContent
}

// R28: the editor-only field, loaded on first render so this block config stays importable on its own.
const HtmlContentField = lazy(() =>
  import('../editor/html-content-field').then((m) => ({ default: m.HtmlContentField })),
)

/**
 * An uploaded HTML design shown exactly as built (its CSS, fonts, motion and scripts), full screen. It runs in a
 * sandboxed frame with an opaque origin, so its scripts can't reach the platform's pages, cookies or APIs, under the
 * design shell's own CSP (F10, html-design-frame.tsx) instead of the page's strict one. The live page of an exact
 * design (phone fixes off) is the design document itself instead (R24, app/site-html); this frame renders it in the
 * editor, the previews, for legacy designs and as the fallback.
 */
export const HtmlDesign: ComponentConfig<Props> = {
  label: 'HTML design',
  // The file is replaced by uploading a new one, never edited here; its words and pictures are (R28 Website content).
  fields: {
    html: { type: 'textarea', visible: false },
    doc: { type: 'custom', render: () => <></>, visible: false },
    images: { type: 'custom', render: () => <></>, visible: false },
    phoneFixes: { type: 'custom', render: () => <></>, visible: false },
    content: {
      type: 'custom',
      label: 'Website content',
      render: (props) => (
        <Suspense fallback={<div className="h-24 animate-pulse rounded-lg bg-subtle" />}>
          <HtmlContentField {...(props as Parameters<typeof HtmlContentField>[0])} />
        </Suspense>
      ),
    },
  },
  defaultProps: { html: '', images: [] },
  render: ({ html, doc, images, phoneFixes, content, puck }) => {
    const meta = puck.metadata as SiteMeta
    const ref = htmlDesignDocOf({ doc })
    // R26 + R28: a design with the CRM data contract gets the spa's website content and live CRM data (only its
    // window.CRM_DATA JSON changes); contract.inline pictures as data: URIs where the server planned them.
    const key = designKey(ref)
    const source = designWithCrm(html || (ref && meta.htmlDocs?.[ref.file]) || '', key, meta.crm, {
      inject: true,
      content,
      locale: meta.locale,
      inline: meta.crmInline?.[key ?? ''],
    })
    return (
      <HtmlDesignFrame
        title={meta.data.tenant.name}
        html={htmlDesignDocument(
          source,
          htmlDesignValues(meta),
          Boolean(meta.editing),
          htmlPictureAdjustments(images ?? [], content),
          htmlDesignLinks(meta),
          { phoneFixes: htmlDesignPhoneFixes({ phoneFixes }), texts: content?.texts, locale: meta.locale },
        )}
        sandbox={HTML_DESIGN_SANDBOX}
        editing={Boolean(meta.editing)}
        className="site-html-design"
        style={{ display: 'block', width: '100%', height: '100dvh', border: 0 }}
      />
    )
  },
}
