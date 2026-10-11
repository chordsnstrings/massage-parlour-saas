import type { ComponentConfig } from '@puckeditor/core'
import {
  HTML_DESIGN_SANDBOX,
  type HtmlImageAdjust,
  htmlDesignDocument,
  htmlDesignPhoneFixes,
  MAX_HTML_DESIGN_BYTES,
} from '@spa/core'
import { HtmlDesignFrame } from '../html-design-frame'
import { htmlDesignLinks, htmlDesignValues } from '../html-design-values'
import type { SiteMeta } from '../types'

export {
  HTML_DESIGN,
  HTML_DESIGN_PLACEHOLDERS,
  htmlDesignLinks,
  htmlDesignPages,
  htmlDesignValues,
} from '../html-design-values'
export { htmlDesignDocument }

/**
 * `images`: the super-admin's per-image adjustments (focal point, fill/fit, replacement), applied in the frame.
 * `phoneFixes` (R24): the design's "Phone fixes" switch. It has NO default on purpose (Puck merges defaults into loaded
 * props): absent = stored before R24 = on (`htmlDesignPhoneFixes`); every writer since stores an explicit boolean.
 */
type Props = { html: string; images?: HtmlImageAdjust[]; phoneFixes?: boolean }

/**
 * An uploaded HTML design shown exactly as built (its CSS, fonts, motion and scripts), full screen. It runs in a
 * sandboxed frame with an opaque origin, so its scripts can't reach the platform's pages, cookies or APIs, under the
 * design shell's own CSP (F10, html-design-frame.tsx) instead of the page's strict one. The live page of an exact
 * design (phone fixes off) is the design document itself instead (R24, app/site-html); this frame renders it in the
 * editor, the previews, for legacy designs and as the fallback.
 */
export const HtmlDesign: ComponentConfig<Props> = {
  label: 'HTML design',
  // Replaced by uploading a new file, never edited here.
  fields: {
    html: { type: 'textarea', visible: false },
    images: { type: 'custom', render: () => <></>, visible: false },
    phoneFixes: { type: 'custom', render: () => <></>, visible: false },
  },
  defaultProps: { html: '', images: [] },
  render: ({ html, images, phoneFixes, puck }) => {
    const meta = puck.metadata as SiteMeta
    return (
      <HtmlDesignFrame
        title={meta.data.tenant.name}
        html={htmlDesignDocument(
          html,
          htmlDesignValues(meta),
          Boolean(meta.editing),
          images ?? [],
          htmlDesignLinks(meta),
          { phoneFixes: htmlDesignPhoneFixes({ phoneFixes }) },
        )}
        sandbox={HTML_DESIGN_SANDBOX}
        editing={Boolean(meta.editing)}
        className="site-html-design"
        style={{ display: 'block', width: '100%', height: '100dvh', border: 0 }}
      />
    )
  },
}

/** Largest stored design (after its embedded files moved out): it travels inside the page JSON (512 KB cap). */
export { MAX_HTML_DESIGN_BYTES }
