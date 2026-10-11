// R24: upload limits of the console's template uploads, shared by the client check (nothing is sent when the file is
// too large, so no request ever hits the generic error page) and the upload route (app/files/templates).
import { MAX_HTML_UPLOAD_BYTES } from '@spa/core'

export { MAX_HTML_UPLOAD_BYTES }
/** Same as @spa/services MAX_TEMPLATE_BYTES (client code doesn't import the services). */
export const MAX_TEMPLATE_JSON_BYTES = 2 * 1024 * 1024

const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`

export const htmlTooLarge = (bytes: number) =>
  `The file is ${mb(bytes)}; the limit is ${MAX_HTML_UPLOAD_BYTES / (1024 * 1024)} MB. Embedded images and fonts are moved out automatically, but the file itself can't be larger — compress the embedded images or link big videos by URL.`

export const jsonTooLarge = (bytes: number) =>
  `The file is ${mb(bytes)}; the limit is ${MAX_TEMPLATE_JSON_BYTES / (1024 * 1024)} MB.`
