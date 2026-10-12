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
```

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
| `spa.short_name` | design's, if it is a whole-word start of the tenant name, else the tenant name | — |
| `spa.area_label` | The default branch's "Area shown on the website" (`branches.area_label` {en, ar?}, locale then English; R28 P3, pre-filled with the application's emirate) — an explicit one always wins; else the CRM city (the address's UAE city), and on the spa's own design its finer label first ("Al Zahiyah, Abu Dhabi") | — |
| `spa.logo_on_light` | the spa's CRM logo (`/files/{id}` on the public site origin; made for the light-only CRM) | design |
| `spa.logo_on_dark` | the design's, when the design is this spa's own and has one; else the CRM logo (never another spa's) | — |
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
- Per request, no stale cache: content-addressed caches only (parsed design by `file:sha256`, output by
  `file:sha256 | mode | hash(CRM JSON)`); a CRM change makes a new key.
- Template apply, "Save site as template", JSON export and the connector read the **stored** design (the design's
  own defaults).
- `{{placeholders}}` in CRM text are filled like any design text (JS-string-safe inside the script).

## 5. Endpoints (spa public site host)

`{site}` = `{slug}.{platform root}`, the spa's own domain, or `/s/{slug}` (path routing). The proxy rewrites them with
the API headers (`default-src 'none'`, no nonce / COOP), never looks them up as a design page; POST / OPTIONS are never
redirected; a GET of `crm-data.json` on the temporary address 301s to the own domain with `Access-Control-Allow-Origin: *`.
`crm-enquiry` is a reserved page slug.

- **`GET|HEAD {site}/crm-data.json`** (+ OPTIONS): the CRM-only contract (§3 without a design; empty lists stay
  empty; `?lang=ar`). Public fields only. `Access-Control-Allow-Origin: *`, `Cache-Control: no-store`,
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
