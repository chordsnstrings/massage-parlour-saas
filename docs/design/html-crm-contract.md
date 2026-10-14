# CRM data contract for HTML designs (R26, 2026-10-12)

The platform standard for uploaded HTML designs whose business data comes from the spa's CRM (the "Candlelight"
contract, first used by the BE RELAX design). The CRM is the single source of truth: a change in the CRM (prices,
hours, a phone, a staff switch) shows on the live site on the next page load, without editing or republishing the
design. Visual structure, layout, motion and styling stay exactly as built (R24 hard rule).

Code: `@spa/core` `html-crm.ts` (detection, build, merge, script-safe JSON, splice) · web `components/site/html-crm.ts`
(caches, `designWithCrm`) · `components/site/crm-feed.ts` (`crmFeedMeta`, `crmContractFor`) ·
`server/crm-feed-routes.ts` (the two endpoints) · services `site-crm-feed.ts`, `websiteServices`, `designEnquirySchema`.

## 1. What makes a design a contract design

A tokenizer pass (comments, doctypes and raw-text bodies skipped, quote-aware tags) looks for:

- **literal**: the first JavaScript `<script>` (no `type`, `module` or a JS type; no `src`) whose whole body is
  `window.CRM_DATA = {…}` — leading/trailing whitespace and one `;` allowed — where `{…}` is valid JSON giving a plain
  object. A JS object literal that isn't JSON (unquoted keys, single quotes, code after it) is not a contract: the
  design keeps its own data and the upload message says why.
- **endpoint**: `<meta name="crm-endpoint" content="…">` outside comments and scripts.

Either makes it a contract design (the upload message and the connector's `get_html_design` say `crm_contract:
literal | endpoint`). Designs without both are served byte for byte as before (R24).

## 2. Contract JSON (what the design reads)

```
spa{name, short_name, area_label, logo_on_dark, logo_on_light, timezone, currency, experience[], experience_image(_alt)}
journey[]{…}                       contact{whatsapp_number, whatsapp_message, whatsapp_service_message, phones[]}
phones[]{number, display, label, whatsapp, calls}
location{address_line1, address_line2, city, country, maps_url}
hours[]{day mon…sun, open HH:MM, close HH:MM, closed}     (close ≤ open = past midnight; 24:00 allowed)
booking{url, label, form_endpoint, image, image_alt}
services[]{id, name, category, note, description, durations[], price, image, image_alt}
staff[]{id, name, specialty, photo, photo_alt}
locale                             'en' | 'ar' — written by the platform (v2 designs and crm-data.json only; never in the file)
contract{version: 2, locales[], fields{}, l10n{ar{}}}   contract v2 manifest (§9); read-only for the platform
                                   (+ `inline[]` §10, `inline_fonts{locale: [url]}` §11: the design's declarations)
ui{…}                              v2: every interface string of the design (§9), editable per spa like any content
inline_originals{path: url}        written by the platform (§10, live page + share links): the inlined pictures' urls
inline_fonts{url: data URI}        written by the platform (§11, a declared locale only): the inlined woff2 fonts
```

`contract`, `locale`, `inline_originals` and `inline_fonts` are reserved roots in every version: never website
content, never overlaid (console, connector), never leftovers.
On v2, `spa.short_name` and `spa.logo_on_light` are website content too (§9); the merge rules of §3 still decide.

## 3. Field sources and precedence

"Matched" = the design item with the **same identity**: services by normalised name (NFKC, lower case, non letters /
digits → one space) in English or the page locale, or the design `id` equal to the English name's slug
(`normal-massage`); staff by normalised name (an empty name never matches).

**"When the CRM has no value" applies only on the spa's own design** (its `name` or `short_name` names the tenant,
as for `short_name`). On another spa's design an empty CRM value or list stays empty and the design hides that block
(owner R28 D1, 2026-10-12: never another spa's phones, logo, address, hours or menu).

| Key | From the CRM | When the CRM has no value (own design only) |
|---|---|---|
| `spa.name` | tenant name | design |
| `spa.short_name` | v1: design's, if it is a whole-word start of the tenant name, else the tenant name. v2: the spa's website content (any value, in the page locale), else the tenant name — never the design's default | — |
| `spa.area_label` | The default branch's "Area shown on the website" (`branches.area_label` {en, ar?}, locale then English; R28 P3, pre-filled with the application's emirate) — an explicit one always wins; else the CRM city (the address's UAE city), and on the spa's own design its finer label first ("Al Zahiyah, Abu Dhabi") | — |
| `spa.logo_on_light` | the spa's CRM logo (`/files/{id}` on the public site origin; made for the light-only CRM) | design (v2: the spa's website content only) |
| `spa.logo_on_dark` | v1: the design's, when the design is this spa's own and has one; else the CRM logo (never another spa's). v2: the spa's website content, else the CRM logo — never the design's default (report `logo-in-defaults`) | — |
| `spa.timezone` / `currency` | `Asia/Dubai` / `AED` | — |
| `contact.whatsapp_number` | default branch WhatsApp, else the first active branch's, `+E164` | design |
| `contact.phones[]` | all active branches, default first: the phone (`calls`, `whatsapp` when the same number) and a different WhatsApp number (`calls: false`); deduped; `display` 05X XXX XXXX / 0A XXX XXXX / +CC…; `label` = the design's label for the same number, else the branch name (several branches) | design list when no branch has a number |
| `location.*` | default branch address split on commas (trailing UAE dropped; city = last part naming a UAE city; line 1 = first part; line 2 = the rest; country UAE) | design (address fields) |
| `location.maps_url` | branch pin, else a Google Maps search of the address | design |
| `hours[]` | default branch opening hours, 7 rows (first open – last close a day; no interval = closed) | design when hours were never set up |
| `booking.url` | — (owner R26 (1): booking requests, never the automatic online booking page) | design's (BE RELAX: `null` → `#book`, its form) |
| `booking.form_endpoint` | live pages: `{this host}{base}/crm-enquiry?page={slug}[&lang=ar]`; previews / editor / share links: `null` (WhatsApp fallback, nothing stored) | — (the designer's endpoint is never used) |
| `services[]` | website services = the CRM Website "On the website" rule (active, online bookable, ≥ 1 active variant), site order; **one entry per English name** (R28: a treatment in two menus shows once — durations joined, lowest public price, first id / description / photo / category) | design list (whole) when empty |
| `.id`, `.name`, `.category`, `.description` | uuid; name / category / description in the locale (English fallback) | description: matched |
| `.durations` | active variant lengths, unique, ascending | — |
| `.price` | lowest public price (`services.show_price`, else the spa default) as a number; `null` when hidden / on request | **never inherited** |
| `.image` / `.image_alt` | `services.image_url` (absolute) / the service name | matched image / its alt |
| `.note` | — | matched (else '') |
| `staff[]` | active staff with **Show on website** on (default off), by sort; **left out while they have no photo** (CRM or the matched design item; R28 D2: no empty frames, the therapist select follows) | `[]` (owner R26 (2): never the design's people; designs hide an empty team, BE RELAX `data-if="staff"`) |
| `.name`, `.specialty`, `.photo` | display name (typed, never translated), first line of the short bio (≤ 80), photo | matched specialty / photo — same name only, never another person's photo |
| everything else | — | design (journey, experience, story texts, message templates, booking url / label / image, theme, unknown keys) |

## 4. Delivery

- **literal designs**: the live page (`/site-html`), frames (Phone fixes, legacy, previews, editor) and share links
  get the design with **only the literal's JSON range replaced** by the merged contract. The JSON is script-safe
  (`<`, `>`, `&`, U+2028, U+2029 as `\uXXXX`; lone surrogates escaped by JSON.stringify), so it can't close the
  script or open a comment. Every other byte is the stored file (plus the R24 invisible additions).
- **endpoint-only designs**: the live page is byte for byte the stored file and fetches `crm-data.json` itself;
  frames (which have no site URL to fetch from) get one `<script>window.CRM_DATA=…;</script>` before the design's
  first script.
- **endpoint designs with defaults (R28 P5):** the first `<script type="application/json" id="crm-defaults">{…}</script>`
  (a JSON object of at most 512 KB; ignored when the design also has a literal) is the design's own data: the slots a
  spa edits, the base the frames inject (defaults + the spa's content + the CRM), and the base of
  `crm-data.json?page=` (§5). The live page stays byte for byte and fetches `{{crm_data_url}}`.
- **contract v2** (§9): the merged JSON carries `locale` (last key); on Arabic pages the design's reviewed
  `contract.l10n.ar` texts go in first (`contractLocaleData`), then the spa's content (`overlayHtmlContent`).
  **Arabic precedence (integrator decision, 2026-10-13):** content Arabic > the design's `l10n.ar` > content
  English > design English, per path, for texts and tags alike: a value a spa set in English only yields to the
  design's reviewed Arabic on `/ar` (where `l10n.ar` has no entry for that path, its English shows); D5 Write texts
  then drafts the missing Arabic only (`{t: {ar}}`, the stored English kept; the `arabic` leftovers first). Fields
  declared `locales: ['en']` always show English; `spa.short_name` is a name, so a spa's English one stays. v1
  designs get exactly the R26 / P4 JSON.
- Per request, no stale cache: content-addressed caches only (parsed design by `file:sha256`, output by
  `file:sha256 | mode | hash(CRM JSON)`, plus `| locale` for v2 designs or content, plus a hash of the content
  values when there is content); a CRM change makes a new key.
- **`contract.inline` (§10, owner 2026-10-13):** the first-screen pictures a design names come as `data:` URIs inside
  the JSON on the live page and share links (+ `inline_originals`); the output key adds a hash of that plan.
- **`contract.inline_fonts` (§11, Decision B, owner 2026-10-14):** the woff2 fonts a design declares for a locale come
  as `data:` URIs in `inline_fonts` on that locale's live page and share links only; the output key adds their hash.
- Template apply, "Save site as template", JSON export and the connector read the **stored** design (the design's
  own defaults).
- `{{placeholders}}` in CRM text are filled like any design text (JS-string-safe inside the script).

## 5. Endpoints (spa public site host)

`{site}` = `{slug}.{platform root}`, the spa's own domain, or `/s/{slug}` (path routing). The proxy rewrites them with
the API headers (`default-src 'none'`, no nonce / COOP), never looks them up as a design page; POST / OPTIONS are never
redirected; a GET of `crm-data.json` on the temporary address 301s to the own domain with `Access-Control-Allow-Origin: *`.
`crm-enquiry` is a reserved page slug.

- **`GET|HEAD {site}/crm-data.json`** (+ OPTIONS): the CRM-only contract (§3 without a design; empty lists stay
  empty; `?lang=ar`) with `locale` (`en` / `ar`, R28 P5). Public fields only. **`?page={slug}`** (R28 P5): the
  newest published version of that visible page — an endpoint design's `crm-defaults` (Arabic: its `l10n.ar` first)
  with the page's website content over it, merged with the CRM, `booking.form_endpoint` for that page; a literal
  design (it never fetches) or a page without defaults gives the CRM-only reply; an unknown, hidden or invalid page
  too (still 200). Designs fetch it through the placeholder **`{{crm_data_url}}`** =
  `{site}/crm-data.json?page={slug}` (+ `&lang=ar` on Arabic pages). `Access-Control-Allow-Origin: *`, `Cache-Control: no-store`,
  `x-robots-tag: noindex`; 120/min per IP; 404 for an unknown site.
- **`POST {site}/crm-enquiry`** (+ OPTIONS preflight: 204, `*`, `POST, OPTIONS`, `content-type, accept`, 600 s).
  Only for a spa whose live site has a contract design (the newest published version of a visible page, cached by
  those version ids): **404** for every other spa, before anything else (their inbox stays behind the EnquiryForm's
  Turnstile). Body (the design's header): `{spa, service_id, service_name, duration_minutes, guests, date
  "YYYY-MM-DD", time "HH:MM", staff_id, name, phone, notes, source, submitted_at}`. Order: contract site (404) →
  body ≤ 8 KB (413) → `application/json` (415) → Origin `null` / same origin (none or other → 403) → JSON (400) → honeypot (`company`/`website`/`url`/`hp`
  filled → 200, nothing stored) → zod (400 `{ok:false,error:'invalid',fields}`: name 1–80, phone any valid number,
  service id or name, duration 5–600, guests 1–10, date real and Dubai today −1 … +120 days, time 00:00–23:59, notes
  ≤ 1000) → site takes bookings (503) → per IP 5/h + 20/day (production) and **per spa 30/h + 150/day
  (always)** (429 `rate_limited`, `Retry-After`) → service / staff names resolved server-side (a website service /
  an opted-in person, else the typed service name, no ids) → a **website enquiry** with `booking`
  (`site_enquiries.booking`: service, serviceId, durationMin, date, time, guests, staff, staffId; notes = message) →
  audit `site.enquiry.received` `{kind: 'booking'}` → bell/push `enquiry.site` → **201 `{ok:true}`** (Candlelight
  only reads `res.ok`). No booking is made; the spa confirms on WhatsApp (Inbox → Enquiries "Booking request",
  "Reply on WhatsApp" names the date, time and the service only when the CRM resolved it — the visitor's typed text
  never goes into the spa's message). No email / SMS. No Turnstile (the sandboxed design can't run it): the contract
  site gate, honeypot, both limits, the Origin check, the JSON content type and server-side resolution stand in.
  A request refused by a limit gets 429; Candlelight then shows "did not go through … send it to us on WhatsApp"
  with the request summary, so a visitor is never stuck.

## 6. Performance (BE RELAX file, 4,595,748 bytes, Node 22)

| Step | ms |
|---|---|
| Detect + parse the 4.5 MB literal (once per stored design) | ~11 |
| Merge + memoised serialise + splice, cold / warm memo | 30 / 9–13 (GC spikes to ~60) |
| Plain `JSON.stringify` of the merged data, for comparison | 17–50 |
| Output cache hit (same design + same CRM data) | ~0 |
| `htmlDesignDocument(top)` on the same file (R24, unchanged) | ~30 |
| A design without the contract | < 0.1 (string test) |

## 7. Fidelity guarantees

- No contract → the very same string (html-fidelity / html-upload unchanged).
- literal → only the JSON range differs (e2e `html-crm.spec.ts` compares the page from `<body>` with the literal cut
  out); endpoint-only live page → byte for byte.
- v1 (R28 P5): the same JSON, keys and cache keys as before (core snapshot test); no `locale`.
- v2, English, no CRM and no content → the very same string; a v2 Arabic preview → only the literal range changes
  (the l10n texts and `locale: 'ar'`). The design sets `<html lang>` itself; no RTL (owner D3).
- Path routing limit: a relative `crm-data.json` from `/s/{slug}` (no trailing slash) resolves to `/s/crm-data.json`
  and misses; production uses host routing, and the literal form (recommended) needs no fetch.

## 8. Authoring a contract design

Render every business value from `window.CRM_DATA` (§2), keep sensible defaults in the literal (they show when the CRM
has nothing, and for spas that pick the design as a template — don't embed one spa's operational data in a design
meant for many), post the booking form as JSON to `booking.form_endpoint` and treat any 2xx as success, fall back to
WhatsApp when it is `null` (and on any non-2xx). Staff appear only when the spa switches "Show on website" on — on
every website: block sites' Team sections follow the same switch (migration 0050 switched it on for the staff a live
Team section showed then: active + bookable). Book links: keep your own target (`#book`, the form) in the literal —
the CRM never sets `booking.url`. Two logos: `logo_on_dark` is kept for the spa the design names; the CRM logo fills
`logo_on_light`.

**No delay on a reload (owner 2026-10-13; BE RELAX v2.5, measured in Chromium 141):** the live page is sandboxed, so a
reload reuses nothing from the browser cache and no connection: the first screen has to come inside the HTML.
- `contract.inline` (§10) names only what the first screen shows: the first scene's picture (its default a copy that
  fits the cap) and the header logo of the theme the page starts in. The live page always starts in the design's
  default theme (the sandbox's in-memory storage keeps no theme choice): BE RELAX inlines `spa.logo_on_dark`, never
  `logo_on_light`, which loads after the page has.
- Latin fonts as `@font-face` data: URIs inside the design (OFL fonts allow it; Google's family names, `unicode-range`,
  `font-display`); no Google Fonts stylesheet (render-blocking and fetched again on every reload).
- `<link rel="expect" href="#{marker}" blocking="render">` in `<head>` + the marker element right after the script that
  builds the first screen: Chromium 124+ keeps the previous page until the finished first screen (CPU 4× slower:
  without it 4 of 5 reloads showed 1–31 background-only frames, with it 0 of 5); Safari and Firefox ignore it.
- `decoding="sync"` on the inlined pictures and logos (decoded with the frame they first show in).
- A sharper original after load (`inline_originals[path]`, else the design's own copy table) only where the browser's
  srcset would take it — Chromium 141: the first candidate dense enough wins (sizes × devicePixelRatio > the copy's
  width; no geometric mean; e.g. 1680 px+ at 1x, 1280 px at 1.25x) — swapped in only once `img.decode()` resolves.
- Fonts only one locale needs (BE RELAX's 4 Arabic faces, ~190 KB: without inlining, a 0.1–0.5 s heading font swap on
  `/ar` reloads): declare them in `contract.inline_fonts` (§11) and use `CRM_DATA.inline_fonts[url]` before the url.
  Keep the file urls as the fallback, from the page's own host (`url(/designs/…)` first, the absolute URL after it;
  preloads the same), so a font not inlined that load still shares the page's one connection.

## 9. Contract v2 (R28 P5, authoring rules)

A v2 design is one file every spa can use: nothing a visitor reads is fixed in it. Core: `crmContractManifest`,
`contractField`, `englishOnly`, `systemCopy`, `crmDesignData` (html-crm.ts), `contractLocaleData`, `carryHtmlContent`,
`htmlDesignOwnPins` (html-content.ts), `htmlDesignReport` (html-report.ts: the upload / Studio report, never blocks).

- **Neutral defaults:** `spa.name` and `spa.short_name` `"Your Spa"`; logos `""`; `contact.whatsapp_number` `""`,
  `contact.phones` `[]`; `location` all `""`; `hours` `[]`; `staff` `[]`; no real spa's name, phone, address or
  alt text anywhere (the report warns: `named-spa`, `contact-in-defaults`, `logo-in-defaults`). A v2 design is never
  a spa's "own design": an empty CRM value shows nothing (D1); a spa's own look (logos, short name, texts) is its
  website content — the merge never shows the design's own `short_name` / `logo_on_dark` / `logo_on_light` (§3).
  On a spa's move from its own v1 design (D4), its v1 texts are pinned as content unless the v2 default says the same
  once `{city}` / `{area}` / `{spa}` are filled with the v1 design's values (that default keeps its reviewed Arabic).
- **Ids on every repeatable item** (`{id: "welcome", …}`, unique, `[A-Za-z0-9_-]`): edits follow the item, not its
  position (`no-ids` otherwise).
- **`ui{}`:** every interface string the script writes (labels, buttons, form messages, aria labels, the WhatsApp
  summary), snake_case keys grouped by area (`ui.form.submit`, `ui.hours.days.mon`). Avoid key names ending in or
  containing `image|photo|logo|still|picture|poster|clip|video` and ending in `accent|colour` — they read as pictures,
  videos or colours (`ui-kind`).
- **Markup strings:** `data-crm-text="ui.nav.book"` — the script sets the element's `textContent` from that path (a
  missing key keeps the markup text, `''` empties it); `data-crm-attr="aria-label:ui.aria.menu_open;
  placeholder:ui.form.phone_hint"` for attributes (alt / placeholder / aria-label / title, `;`-separated). Keep the
  English text in the markup so the page looks the same before the script runs. The platform lists these texts with
  their `path` (a stored page text there becomes that value when a spa moves to the design — not when it is only
  part of what the script writes: an element with several text runs or `data-crm-tpl` (its text a template with
  `{days}` / `{hours}`) → dropped `part`; nor when the slot's text has `{tokens}` the old text lacks → `tokens`); a
  path that is no slot is reported (`bound-no-slot`).
- **Tokens:** `{time}`, `{name}`, `{city}` (single braces) are filled by the design's script and must stay in every
  translation; `{{spa_name}}`-style placeholders (double braces) are filled by the platform.
- **`contract{}`:** `{version: 2, locales: ["en", "ar"], fields: {pattern: {label?, group?, hint?, locales?}}, l10n:
  {ar: {concrete path: string | string[]}}}`. Field patterns: `journey[].clip` (any item), `ui.wa.*` (any
  descendant); exact pattern first, then the longest `.*` prefix. `locales: ["en"]` = English on every page (messages
  the spa's staff read, e.g. `ui.wa.*`, `contact.whatsapp_message`). `l10n.ar` = reviewed Arabic defaults (≤ 2000
  entries of ≤ 2000 chars; on `/ar` they also beat a spa's English-only value for the same path, §4); `ui.*` paths
  that are English-only or have reviewed Arabic are "system copy": Write texts
  never drafts them and readiness doesn't list them.
- **`locale`:** written by the platform (`en` / `ar`), never in the file (`locale-in-data`). The design sets only
  `document.documentElement.lang`, never `dir` (owner D3: Arabic texts in the design's own layout); add Arabic
  `@font-face` aliases with an Arabic `unicode-range` (`U+0600-06FF, U+0750-077F, U+0870-08FF, U+FB50-FDFF,
  U+FE70-FEFF`) or a Google Fonts family named "… Arabic" (`no-arabic-font`).
- **Team cards:** the first element of the `data-crm-list="staff"` template carries `data-if="photo"`
  (`staff-no-photo-guard`).
- **Videos:** `clip: null` / `clipMobile: null` on an item declare video slots (a spa uploads an MP4 / WebM ≤ 8 MB or
  pastes an https link).
- **Title:** `<title>{{spa_name}}</title>`; the script never sets `document.title` (`fixed-title`).
- **Endpoint form:** `<script type="application/json" id="crm-defaults">{…}</script>` (≤ 512 KB) + `<meta
  name="crm-endpoint" content="{{crm_data_url}}">`; the script fetches the meta's URL (it returns the defaults with
  the spa's content and the CRM). The literal form (`window.CRM_DATA = {…}`) needs no fetch and is recommended.

## 10. `contract.inline`: first-screen pictures inside the page (owner 2026-10-13)

Owner (2026-10-13, after screen recordings of reloads): "i don't want to see delay when i reload the website". The
live page is the design document under a CSP sandbox (opaque origin, R24: never allow-same-origin), so the browser
keys every subresource by a per-document nonce: nothing is reused from its cache on a reload and every first-screen
picture downloads again and pops in after the text. The only way to have no visible delay is to deliver those
pictures inside the HTML.

- **Declare:** `contract.inline: ["spa.logo_on_dark", "journey[welcome].image"]` — CRM_DATA
  paths (item id `journey[welcome]` or index `journey[0]`; ≤ 16, ≤ 200 chars each; v1 or v2). Only pictures the
  first screen shows; everything below it stays lazy (`loading="lazy"` / the design's own lazy loading).
- **What the platform does** (live page `/site-html`, the live page's frames, share links `/website/preview?token=`;
  never the Studio editor or console previews): after the CRM merge and the spa's content, each declared value that
  is a platform picture — this spa's own public `/files/{uuid}` (relative, or absolute on a platform host / this
  spa's own domain) or a static design file `/designs/{design}/{name}.{webp|png|jpg|jpeg|avif}` (relative or
  absolute on our hosts) — is read server-side (the spa's tenant transaction for /files; `public/designs` on disk;
  **never fetched from a URL**: other hosts are left as they are), sniffed (PNG / JPEG / WebP / AVIF / GIF only, never
  SVG) and, when ≤ 80 KB with the page's running total ≤ 240 KB (raw bytes, per occurrence, in declared order: one
  that would pass the total is skipped), replaced by `data:{type};base64,…`. `inline_originals` (last key) records
  `{path: original url}` for each one, so a design can upgrade to a sharper `srcset` after load.
- **Anything else stays as it is:** another spa's file, private files, design documents, template files (an
  uploaded template's own `/files/{id}/{name}`), unknown hosts, query strings (`?w=480`), larger pictures, read errors, reads not done within 300 ms
  (the render never waits longer: a late read keeps going and serves the next load).
- **R24 / R26:** the design document never changes; only values inside `window.CRM_DATA` do (endpoint-only designs'
  live page fetches `crm-data.json`, which is not inlined — the fetch itself is a round trip; use the literal form).
- **Caches:** pictures in a process-wide LRU (≤ 32 MB; file ids keyed per spa, misses remembered 60 s, read errors
  30 s; one spa's file rows of a render read in one tenant transaction, bucket objects downloaded after it with a 5 s
  limit, so a slow bucket never holds a db connection); the output
  cache key adds a hash of the plan (paths + urls), and the plan is made from the request's merged data, so a new CRM
  logo (a new file id) shows on the next load. Code: `@spa/core` html-crm-inline.ts, `@spa/services` crmInlineFiles / crmInlineFileBytes,
  web `server/crm-inline.ts` (`crmInlinePlan`, `pageCrmInline`), `designWithCrm(…, {inline})`.
- **Authoring:** point the first screen's default picture at a small copy (BE RELAX v2.5: the 1600w welcome still
  `4d56333a0e00bb38.webp`, 58 KB, instead of the 2400w 197 KB one) so it fits the cap; inline Latin fonts in the
  design file itself (the platform inlines only the one-locale fonts §11 declares, never a design's @font-face). The
  full design-side checklist (render-blocking marker, sync decode, sharper swap after `decode()`, one-locale fonts)
  is §8 "No delay on a reload".

## 11. `contract.inline_fonts`: one locale's fonts inside the page (Decision B, owner 2026-10-14)

Owner (2026-10-14, Decision B): "put the Arabic fonts inside the Arabic page, so its heading doesn't flicker on
reload. Yes". The sandboxed live page reuses nothing from the browser cache (§10), so BE RELAX's four Arabic faces
(45,688 + 56,536 + 42,848 + 45,296 bytes, `/designs/be-relax/{sha16}.woff2`) download on every `/ar` reload and the
heading swaps its font 0.1–0.5 s after the first frame. Latin fonts live in the design file itself (§8); a font only
one locale needs would cost every other locale's page its bytes there, so the platform delivers it on that locale.

- **Declare** (contract v1 or v2): `contract.inline_fonts: { "ar": ["/designs/be-relax/16734a5adb27b0f3.woff2", …] }`
  — keys are page locales (`en` | `ar`), ≤ 16 urls a locale, each ≤ 2,000 chars, **exactly as the design's own
  `@font-face` src names it** (the output key is that string, byte for byte). A url is a static design file
  `/designs/{design}/{name}.woff2`, relative or absolute on a platform host / this spa's own domain (the host rules of
  §10; no query, fragment, credentials or %-escapes). Declare one form per file (relative recommended): each declared
  url counts against the budget, so the relative and the absolute form of one file cost it twice.
- **What the platform does** (live page `/site-html`, the live page's frames, share links `/website/preview?token=`;
  never the Studio editor or console previews), **only when the response's locale is one of the keys**: each declared
  url is read from `public/designs` on disk (**never fetched from a URL**), must start with the WOFF2 signature
  `wOF2`, ≤ 150 KB each, the running total ≤ 400 KB (raw bytes, per declared url, in declared order: one that would
  pass the total is skipped) — a budget separate from the pictures' 240 KB. The result is the reserved key
  `inline_fonts` (after `inline_originals`, the last key):

  ```
  window.CRM_DATA = {
    …,
    "contract": { …, "inline_fonts": { "ar": ["/designs/be-relax/16734a5adb27b0f3.woff2", …] } },
    …,
    "inline_originals": { … },            // only when contract.inline inlined pictures (§10)
    "inline_fonts": {
      "/designs/be-relax/16734a5adb27b0f3.woff2": "data:font/woff2;base64,d09GMgABAAAA…",
      …
    }
  }
  ```

  A url missing from `inline_fonts` (not read within the deadline, a read error, over a cap, not ours, not WOFF2)
  simply has no entry: the design's own url loads as before (the next load usually has it). Other locales' responses
  (English for an `ar` list) never carry the key, and designs that declare nothing get exactly the §10 output.
- **Anything else is never inlined:** other hosts, uploaded `/files`, `.woff` / `.ttf` / `.otf` / pictures, a `.woff2`
  whose bytes are not WOFF2, files over 150 KB, reads not done within 300 ms.
- **Reliability (as §10):** one 300 ms deadline shared with the pictures (both plans run together; a late read keeps
  going and fills the cache for the next load); the same process-wide LRU (≤ 32 MB, pictures and fonts together; a
  design font is one entry shared by every spa), misses remembered 60 s, read errors 30 s; the output cache key adds
  `|fo:{hash(urls + sizes)}` (design files are content-hashed: the bytes behind a url never change).
- **Reserved:** `inline_fonts` is a platform root like `inline_originals`: never a Website content slot, never shown in
  the console's Website content, never overlaid or set by a connector; a value the design's own literal has there is
  replaced whenever the platform sets the key.
- **R24 / R26:** the design document never changes (its `@font-face` rules included); only the value of
  `window.CRM_DATA` does. Endpoint-only designs' live page fetches `crm-data.json`, which carries no fonts (§10).
- **Design side:** before the first paint of the locale's page, for each face use `CRM_DATA.inline_fonts[url]` when
  present, its url otherwise — e.g. write the locale's `@font-face` rules from the script with
  `src: url(<data URI>) format("woff2"), url(/designs/…) format("woff2"), url(https://…) format("woff2")`, or
  `new FontFace(family, 'url(' + data + ')', descriptors)` + `document.fonts.add()` — keeping the render-blocking
  marker of §8 after the first screen. Never on other locales: their data has no key.
- Code: `@spa/core` html-crm-inline.ts (`crmInlineFontUrls`, `crmInlineFontSource`, `isWoff2` / `woff2DataUri`,
  `planCrmInlineFonts`, `applyCrmInlineFonts`, `crmInlineFontsKey`, the loader's `loadFont`), html-content.ts
  (`inline_fonts` reserved), web `server/crm-inline.ts` (`crmInlinePlan` → `{inline, fonts}`, `pageCrmInline` →
  `SiteMeta.crmFonts`), `designWithCrm(…, {inline, fonts})`; e2e `html-crm.spec.ts` (contract.inline test).
