# R28 Dynamic HTML-design websites — build plan

Owner request 2026-10-12: "The website has to be dynamic, not static. You're creating static websites. Understand what
you need to do." Planned 2026-10-12 (4 code readers → 3 independent plans → judged + synthesized; claims checked in code).

**Owner decisions (2026-10-12):**
- **D1** — an empty CRM value (logo, phones, WhatsApp, address, hours, services) on a design made for another spa shows
  nothing; the design hides that block. Template previews and the spa's own design keep the design's values.
- **D2** — on HTML designs a therapist without a photo is hidden (team + therapist select) until a photo is added; the
  design's nameless photos are given to a real therapist only by a super-admin's explicit pick when filling the CRM.
- **D3** — Arabic: Arabic texts show inside the design's English (left-to-right) layout; no separate RTL rebuild of the
  design. The `/ar` address renders the content layer's Arabic values with English fallback.
- **Delivery** — phase by phase: each phase goes live when its checks pass.

**Goal:** everything a visitor sees comes from one of three places:
- **L1, CRM:** live, shows without a publish.
- **L2, per-spa website content:** goes through draft and publish.
- **L3, design defaults:** used only when nobody has set a value.

The stored file never changes. With no content set, the output is the very same string as today, so `html-fidelity`, `html-upload` and `html-crm` stay green without changes. The content layer changes only values: the `CRM_DATA` JSON range, text-node characters and attribute values. Layout, CSS and scripts are never touched. This goes into CLAUDE.md as a locked decision that extends R24.

## 1. Content model and storage

- **Precedence:**
  - Operational keys: L1 > L3 (neutral fallback per D1).
  - Design-owned keys: L2 > L3.
  - `logo_on_dark`: L2 > the spa's own design > CRM logo.
  - `area_label`: CRM only (branch area > CRM city > the design's value only when it is the spa's own design). The content layer refuses it, so it has one source.
- **New file `packages/core/src/html-content.ts`** (pure, client-safe):
  ```ts
  type Bi = { en: string; ar?: string }
  type HtmlContentValue = { t: Bi } | { tags: { en: string[]; ar?: string[] } } | { img: string; alt?: Bi }
                        | { video: string } | { on: boolean } | { hide: true }
  type HtmlDesignContent = { v: 1; data?: Record<string, HtmlContentValue>   // 'journey[welcome].title', 'spa.experience[1].text'
                                  texts?: Record<string, { src: string; t: Bi }> } // 'txt-n' | 'attr-n' | 'title' | 'meta-description'
  htmlContentSlots(literalData, html?) → HtmlContentSlot[]   // what can be edited, read from the literal
  overlayCrmData(designData, data, locale, filesOrigin)      // copy-on-write; empty content returns the same object (===)
  htmlContentErrors(content, slots) → string[]
  ```
- **What becomes a slot:**
  - Every string, boolean, string-array or null leaf of the literal, except these operational roots: `spa.name`, `short_name`, `area_label`, `logo_on_light`, `timezone`, `currency`, `contact.whatsapp_number`, `phones`, `location`, `hours`, `booking.url`, `form_endpoint`, `services`, `staff`.
  - Kind comes from the key name (image, photo, logo or still → picture; clip or video → video; long → multi-line text).
  - `focus` and `accent` become focal-point and colour fields.
  - Array items are addressed by `[id]` when they have one, otherwise `[n]`. Items are edited in place, never added or removed, because the scroll choreography depends on the 5 scenes.
  - Optional keys (`clip`, `clipMobile`) are offered only when the design declares them (the schema comment in v1, the manifest in v2).
- **Where it is stored:** a new block prop `content?: HtmlDesignContent` on `HtmlDesign` (`blocks/html-design.tsx`). Like `phoneFixes`, it has no Puck default.
  - It lives in `page_versions.data`, so draft, preview, share link, publish, versions, restore, F29 locks, edit stamps and template undo all work without new code.
- **Validation:** `cleanHtmlDesignContent(data, tenantId, tx)` in `packages/services/src/site-edit.ts`. It runs in `saveDraft` (every HtmlDesign block), `runSiteEdit`, import and template save/apply. It refuses:
  - unknown or operational paths and wrong kinds;
  - `data:` and `javascript:` values;
  - texts over 2,000 characters, or more than 64 KB in total;
  - `/files` ids that are not this tenant's public files (checked with `withTenant`).

  `overlayCrmData` checks the whitelist again at render time.

  **As built:** there is no `cleanHtmlDesignContent` function (here and in §2, §6, §8 and P1 below). Validation is
  core `htmlContentErrors` (192 KB cap since P4) through services `htmlDesignContentErrors` on draft saves (shape
  only; malformed ids, private and other spas' files refused; own files deleted since and stale entries pass) and
  the `html_content` op (slots and ids against the stored design; only this spa's public files). Template apply
  copies content files (`materializeTemplatePageData` / `localiseHtmlDesignAssets`); "Save site as template"
  scrubs content in `sanitizeTemplatePages`.

## 2. Render integration points

1. **`apps/web/src/components/site/html-crm.ts`:** `designWithCrm(html, key, crm, {inject, content, locale, filesOrigin})`.
   - Change `if (!crm) return html` to `if (!crm && !content) return html`.
   - Merge: `mergeCrmContract(overlayCrmData(literal.data, content.data, locale, origin), crm)`; with no CRM (template preview), the overlay alone.
   - Cache key: `key|l/i|cyrb53(crm)|cyrb53(stableJson(resolvedForLocale))`. Empty content gives exactly today's key.
   - Copy-on-write keeps the `crmScriptJson` WeakMap hits for untouched subtrees, including the 4.4 MB of pictures.
2. **`packages/core/src/html-design.ts`:**
   - New `listHtmlDesignTexts(html)`: the same tokenizer as `scan` (skips script, style and comments) plus text nodes inside `a`, `button`, `option` and `template`; `<title>`; `meta[name=description]`; the attributes `alt`, `placeholder`, `aria-label` and `title`.
   - Each text has a `src` guard of at most 300 characters and a `group` from the nearest section, header, nav or footer.
   - Texts are marked `bound` when the design's script fills them (`data-crm*`, `data-item*`, `data-book-service`).
   - New `applyHtmlTextOverrides(html, texts, locale)` runs as the **first** step of `htmlDesignDocument`, so ids match the raw file, and before `fillSpans`, so `{{spa_name}}` inside an override is filled. It escapes HTML and attributes and keeps the node's surrounding whitespace.
   - A stale `src` is skipped at render and shown as outdated.
   - `HtmlDesignRender` gets `locale` and `texts`.
   - **As built (P4):** one walker (`textSites`, tokenized like `fillSpans`) lists text runs, alt / placeholder /
     aria-label / title attributes, the first `<title>` outside svg and the meta description with positional ids on
     the raw file (`txt-n`, `attr-n`, `title`, `meta-description`); only runs and values without `<` or `>` are listed
     (and numbered), and overrides escape `<`, `>`, quotes and `=`, so an override can never add markup, an attribute
     or a `src=` / `style=`; script bodies are skipped, so the ids survive the CRM splice. Texts are listed on every
     design, with or without `CRM_DATA`, `<template>` and `<option>` texts included; a run or value with an unknown
     or ambiguous character reference is not listed (common named ones are decoded; U+00A0 kept). `bound` (listing
     only; the render ignores it, writes refuse it) with `boundBy`: `crm` = `data-crm*` / `data-item*` /
     `data-book-service` on the element or an ancestor, and on a contract design (`CRM_DATA` literal or crm-endpoint
     meta) also text the design's JS writes; `script` = text the JS writes on a design without a contract
     (`.textContent` / `.innerText` / `.innerHTML` / `replaceChildren` / `append` / `insertAdjacentHTML` / jQuery
     `.text()` on `getElementById` / `querySelector('#…')` incl. `#id child` selectors and child access, directly, via a
     variable, a helper, a looped id array or a holder object; never attributes; listener-only and `#id + / ~`
     sibling ids stay editable; the `window.CRM_DATA` literal or injected body not read), `document.title =` for the
     title. Overrides: either language may be missing
     (Arabic only keeps the design's English); a value equal to the design text keeps its original bytes;
     `{{placeholders}}` in an override are plain escaped text (no map link). Pictures: `content.pictures: [{id, src, img}]`,
     replace-only, merged over the template's `images` by id (same src → its framing kept); no alt on pictures (the
     `<img alt>` is a page text: one source). Replace-only adjustments no longer get the forced fit (framed only with
     fit / x / y / align); a replaced `<img>` in a `<picture>` also sets its `<source srcset>`s; picture URLs refuse
     character references (a pasted `&amp;` is read as `&` first; `$` allowed) and get `&` escaped in attributes.
     Content cap 192 KB.
     `<input value>` and `og:*` are not texts in P4.
3. **Callers:** `blocks/html-design.tsx` (`meta.locale`), `app/site-html/route.ts` (`locale`) and `platform/(console)/templates/[id]/preview/page.tsx`.
4. **Copies:** `materializeTemplatePageData` and `localiseHtmlDesignAssets` (`site-html-assets.ts:369`) also make local copies of `/files` values in `content`. "Save site as template" carries `content` through `cleanHtmlDesignContent`. That lets a super-admin write neutral BE RELAX content once on a demo spa and save it as the template.
   - **As built (P4 review fixes):** the save scrubs `content` like other copy (`sanitizeTemplatePages` →
     `scrubHtmlContent`: emails, links and 9+ digit phones out of texts and tags in EN + AR, the spa's name →
     `{{spa_name}}`, blank texts dropped) and drops the source spa's own uploaded pictures / videos (`/files` values
     and content pictures; outside https links stay); the design file, `images` and src guards stay as built.
5. **Pop-in check:** P1 measures whether URL pictures pop in during the scroll scenes. If they do, `site-html` adds `<link rel=preload as=image>` for those pictures; this needs to be listed as an allowed invisible change. Embedding them as `data:` at render is the last resort.

## 3. Console editor (English)

- In the full-screen editor, the `content` field on `HtmlDesign` becomes visible: `{type:'custom', label:'Website content', render: HtmlContentField}`.
- New folder `components/site/editor/html-content/`: `field.tsx`, `slot-field.tsx`, `readiness.tsx`, `text-slots.tsx`.
- On HTML-design pages the editor selects the block on load and widens the panel.
- The slot list is built on the client from `designContract(meta.htmlDocs[file])`, which is already parsed and cached.
- **Sections:**
  - **From the CRM:** read-only, with "Edit in CRM" links: name, logo, phones, address and area, hours, services (missing photos flagged), team (hidden ones and why).
  - **Story:** 5 scenes with label, eyebrow (`{area}`/`{hours}` chips), title, body, tags, button switch, picture with focal point, accent, and video where declared.
  - **Your visit, Booking, WhatsApp messages, Logo on dark.**
  - **Page texts:** grouped and searchable; bound texts link to their data field.
  - **Pictures:** the existing `HtmlImageAdjuster` from `templates/html-images.tsx`.
- **Each field:** the design default as placeholder, "Reset to design", "Hide" only where a `data-if` covers it, `BilingualField` (follows the EN/AR switch and has AI rewrite and translate), and `imageField`/`MediaPicker` uploading into the spa's media library.
- The canvas reloads 800 ms after the last change. Autosave, undo, versions and publish are unchanged.
- **Readiness** uses `designLeftovers()` in core. It lists:
  - design-owned texts that are not overridden and mention the design's spa name, another UAE city (`UAE_CITIES`), phone numbers or emails that aren't the CRM's, or "Test Build";
  - untranslated AR fields;
  - stale overrides;
  - design photos never assigned.

  It also shows as a non-blocking warning in `publishCheckedAction` and `PublishSiteSheet`.
- **Spa page card** (`websites/[slug]/cards.tsx`): "Website content: N changes · M leftovers", plus "Edit content" and "Fill CRM from design". `ResolveRequestSheet` links straight to the field a change request is about.

**As built (P4, 2026-10-12)** — the editor part, where it differs from the plan above:
- One field file (`html-content-field.tsx`) plus `html-content-labels.ts` (labels shared with the publish sheet, and
  the page-text / picture listing cached per stored document, last 4) instead of the `html-content/` folder.
- **Page texts** on every design (with or without `CRM_DATA`; without it the CRM groups are hidden and a note says
  why): searchable, grouped by section with the page title + search description first, 200 rows at a time, rows
  only while open (open by default only without CRM groups). Each unbound text is a bilingual field named by kind +
  the design's words ("Heading: Our rituals") with a "Design" reset and the design text as hint; bound texts are
  read-only, worded by `boundBy` ("Filled by the design from the CRM" + "Go to field" for a `data-crm` slot;
  "Filled by the design's script"). An Arabic-only text is stored as `{ar}` only, so the English page keeps the
  design's own bytes. Outdated entries (the design changed there) show with Remove.
- Data-slot pictures and videos are stored only once the link is a complete `/files/…` or https one (the draft-save
  rule); a partial or invalid link stays in the field with an inline hint.
- **Pictures:** one URL / media-library field per design picture (replace-only, `/files` or https; the template's
  framing kept), not the `HtmlImageAdjuster`; a picture's description is its `alt` page text.
- Leftovers cover page texts and outdated entries and jump to their row. The editor's publish sheet shows them as a
  non-blocking "Website content checks" section (first 5, "Open Website content" selects the block); the console
  `PublishSiteSheet` warning and the spa page card are not in P4.
- Template adjuster (`templates/html-images.tsx`): Fill / Fit shows as chosen only for framed entries, and leaving
  the URL field untouched no longer adds an empty entry.

## 4. Filling the CRM on apply (preview, then confirm)

- **Matching** (`packages/core/src/html-crm-seed.ts`): `crmMatchScore` = exact `crmName`/`crmSlug` match, plus number words (4 ↔ four), a shared prefix of at least 5 letters (moroccan ↔ morocco) and token Jaccard ≥ 0.5.
  - The core helper `ownDesign(designData, tenantName)` is exported; `namesSpa` stays private.
- **Shared service logic** (`packages/services/src/catalog.ts`): `saveService`, `setServiceImage` and `setStaffPhoto`, moved out of `dashboard/[tenant]/services/actions.ts:177` and `staff/actions.ts:82` with the same rules (at least 1 variant, 10–480 minutes, `IMAGE_URL_PATTERN`, bio ≤ 120). The web actions keep zod, guard and audit.
- **`packages/services/src/design-seed.ts`:**
  - `planDesignSeed(tx, tenantId, literal)` is read-only. It returns the service pairings with scores, 160 px WebP thumbnails, the staff photo pool and the CRM staff list.
  - `applyDesignSeed(tx, tenantId, literal, choices, {userId})`:
    - pictures: decode the `data:` value, then `processImage`, then `createAsset`, tagged `['design', 'design:{sha8}:{path}']`; a re-run creates no duplicates;
    - fills `imageUrl` and `description` only where empty, unless "replace" is ticked; prices are never touched;
    - creates unmatched services only when ticked: the design's durations (60 min if none) and price on request;
    - sets a therapist photo only for a CRM staff member the super-admin picked; "Show on website" is switched on only when ticked;
    - every unassigned photo goes into the media library.
- **Console:** step 2 of `ApplyTemplateSheet` plus the card button open `seed-sheet.tsx`. The sheet says these are CRM changes that go live at once.
  - `seed-actions.ts` `seedCrmFromDesignAction`: `studioGuard(slug,'site.design')`, then `can('services.manage')` and `can('staff.manage')`, then zod, `withTenant`, `auditAs('site.design_seed')`, a revalidate of the services, staff and website paths, and `forgetHtmlDesignRoutes`.
  - The connector gets only a read-only `plan_design_seed`.

**As built (P3, 2026-10-12)** — where it differs from the plan above:
- Preview thumbnails are 96 px WebP made on the server (`designSeedThumb`), never the design's full `data:` pictures.
- Library tags are `['design', 'design:{sha8}']` (bytes hash, no path): the same picture twice is stored once. The tag
  is editable in the media library; changing it only means a re-run stores that picture again (no harm).
- The preview carries `designSeedHash(CRM_DATA)`; the apply re-reads the draft and refuses when it changed.
- One apply per spa at a time (`pg_advisory_xact_lock`); only active services are filled or matched.
- Created services: `NEW_SERVICE_DEFAULTS` (bookable online, so the website lists them; price on request).
- "Replace" overwrites the photo and the English description; an Arabic description the CRM has is kept.
- The template-apply action looks up the seed offer after the switch commits; a failure there only drops the offer.
- Connector `plan_design_seed`: therapist names only for those with "Show on website" (others `name: null`).

## 5. Fixes for what you saw live (P0, render-time, no republish needed)

All in `packages/core/src/html-crm.ts`:
- **Area label:** `area_label = crm.spa.area_label || (ownDesign ? design : '')`. last-test shows the city parsed from its address.
- **D1, empty CRM values:** when the design is not the spa's own, an empty CRM value (logos, WhatsApp, phones, address, hours, services) renders empty and the design hides the block. Template previews and a spa's own design keep the current rule.
- **Therapists without a photo:** when the design's staff items carry photos, CRM staff still without a photo after merging are left out of `staff[]`. That also removes them from the therapist select (D2).
- **Same name twice:** `collapseSameName` in `buildCrmContract`, so `crm-data.json` gets it too.
  - It groups by `crmName(name.en)`: durations combined, the lowest price, the first id (the enquiry lookup at `crm-feed-routes.ts:162` still works), the first description and photo, all match names.
  - This is the plan's default, recorded in `html-crm-contract.md` §3.

**Later, in P3:**
- New column `branches.area_label jsonb {en, ar?}`, migration `0051_r28_branch_area.sql`. It flows through `BranchInput`, `createBranch`/`updateBranch`, Settings → Branches and the default-branch form (EN + TH keys), `crmFeedFacts` and `buildCrmContract`. It is pre-filled from the application's emirate (`applications.ts:344`).
- Staff form hint `staff.form.sitePhotoNeeded` (EN + TH).
- `/files/upload` and the media picker accept `services.manage` or `staff.manage` for image uploads.

## 6. Ask AI, Write texts and the connector (one ops layer, drafts only)

- **New op `html_content`** `{page, set?, reset?: string[] | 'all', dry_run?}` in `site-edit.ts` and `site-kit/edit-ops.ts`. It is checked against the page design's slots (doc via `spaHtmlDocReader`) and `cleanHtmlDesignContent`, and needs `SITE_AI_EDITOR_EMAILS` + 2FA.
- **Connector** (`packages/ai/src/mcp/site-server.ts`):
  - `get_html_content`: slots grouped and paged, defaults (pictures as "embedded picture, 180 KB"), current values, leftovers;
  - `set_html_content`;
  - `add_image` already returns a usable `url`;
  - the `patch_html_design` description becomes "structure only; words and pictures → set_html_content".
- **Ask AI:** add `html_content` to the allow-list at `ai-edit-actions.ts:171`. `aiEditPlanAction` passes the slots and current values. `planSiteEdit` still never writes HTML.
- **Write texts:** `textSlots()` returns the unbound content texts for HTML pages instead of returning early at l.42, and `fillTextSlots` writes `content`. The prompt gets the spa's CRM facts and the leftovers, so one click drafts EN + AR for that spa.
- **As built (P4):** the connector's `get_html_content` lists every design (no CRM_DATA: page texts and pictures
  only), paged (`start` / `limit`, `textsTotal`) and searchable, with `leftovers`; `set_html_content` takes `texts`
  and `pictures` (the server fills the src guards and refuses bound ids). Ask AI sends an HTML-design page's content
  view (unbound texts, clipped) as `<content>` and gets one `html_content` op back (page texts as `{id, en, ar}`); a
  block page's prompt is byte-identical. Write texts: `textSlots(data, schema, {html})` = the design data's text /
  longtext values + the unbound page texts (title and meta description included; tags, pictures and CRM-filled texts
  never), leftovers first and named in the prompt with the `{{placeholder}}` and keep-the-length rules; the save
  writes only `content` (stale slots or a changed design file skip; content checks as on draft saves). All drafts.

## 7. Contract v2 and designs without CRM_DATA (P5)

- **`docs/design/html-crm-contract.md` §9** describes v2:
  - neutral defaults (no real spa's name, phones, address or alt text);
  - an `id` on every repeatable item;
  - `ui{}` for every script string, plus `data-crm-text` / `data-crm-attr` bindings for markup strings;
  - `contract{version:2, locales, fields}`;
  - the platform supplies `locale` in the JSON; Arabic values show in the design's own layout (D3: no RTL rebuild); an Arabic-capable font is recommended;
  - `data-if="photo"` on staff cards.
- **`htmlDesignReport(html)`** in core: contract none / v1 / v2, slot counts and warnings, shown in `TemplateUploadSheet` and on the Studio page. It never blocks an upload.
- **BE RELAX v2** is made once through the connector as a new template version; you sign off the look.
  - `carryHtmlContent(old, newSlots)` keeps values whose path or text `src` still exists, so spas keep their edits when they move to v2. Undo still works.
  - **Owner decisions (2026-10-13):** **D4** spas already on BE RELAX v1 are switched to v2 **automatically** once the owner signs off the look (live at once, their edits carried by `carryHtmlContent`; undo per spa still works). **D5** applying BE RELAX v2 (a new apply or the automatic switch) also runs Write texts for its HTML pages at once: EN + AR drafts from the spa's CRM facts and leftovers (drafts only; publish as usual).
- **Endpoint-only designs:** `crm-data.json?page=` merges the published block's `content`.
- **Designs without CRM_DATA:** they still get page texts, pictures and placeholders. The card says "Not connected to the CRM" and offers a connector conversion into a draft.
- **Video:** `/files/upload` gets a video kind (mp4/webm, ≤ 8 MB, under `site.design`).
- **As built (P5, platform):**
  - **Template versions:** on the same `site_templates` row (`version`, `history`, `pending`; migration 0052). "Upload
    new version" (`/files/templates?kind=version&id=`) stores the pending one with its report — invisible to apply.
    **Roll out = sign-off** (`signOffTemplateVersion`, one transaction; the update only applies while the pending sha
    is the reviewed one and the version has not moved — else "changed meanwhile"): pending → pages, the old sha →
    history. A "Replace" upload of an HTML row also makes the replaced file an older version (`pushTemplateVersion`).
    "Upload new version" prefills the current version's Phone fixes and picture adjustments (re-pointed at the new
    file's pictures by `src`, services site-kit `repointHtmlImageAdjustments`).
  - **Who switches:** spas whose LIVE HtmlDesign file is one of the old versions' shas (`spasOnTemplateVersions`, one
    entry per spa with every visible page still on an old sha; BE RELAX v1 has no `/files` references, so a spa's copy
    keeps the template's sha). A spa with no page on an old sha but another live sha (patched, localised, applied but
    never published, an earlier undo) → listed as skipped, never overwritten. A click switches spas until 25 are
    switched or ~30 s are spent; spas it cannot switch don't count and the sheet sends them back (`later`) so the next
    click tries the others first ("Run again for the rest").
  - **The switch** (`upgradeHtmlDesignLive`, in the spa's own transaction; all of the spa's old-version pages in a
    savepoint, or none): never `publishPage` — its own published row per page (`insertVersion`), so draft themes and
    pending renames stay unpublished; content = `carryHtmlContent` (with the old file for pairing) +
    `htmlDesignOwnPins` (embedded logos stored as the spa's files); props: the spa's own Phone fixes kept on, its own picture
    adjustments kept for pictures still in the new file that the new version sets none for; settings equal to the old
    version's (only inherited) follow the new version (`upgradedProps(…, fromProps)`); each
    working draft carried (same old file) or kept, moved after the new live row; ONE `templateUndo.live` holding every
    page → Undo re-publishes the previous versions as new rows, puts the drafts back and sets `sites.template_hold`
    (later rollouts of that version skip the spa). An editor lock on any page, a content check that fails on any page
    (savepoint rolled back, nothing written), or a spa already on the new file → skipped with the reason.
  - **D5:** `sites.text_run` queue (`queueSiteTexts`, in the apply's / switch's own transaction — console apply:
    reads in a savepoint, a failure records a skipped line instead; connector `apply_template`: same transaction; the
    rollout: ONE run with all switched pages) → `@spa/ai` `runQueuedSiteTexts` (atomic claim; gate re-checked for the
    super-admin who queued it; `htmlOnly`, `onlyDefaults`, `keepUndo`, `designSha`) right after the response
    (`after()`), the worker's `site-texts-queue` cron sweeps queued (> 3 min) and stale running (> 15 min) runs. Only
    contract v2 pages; skipped with a reason on the card for the spa's own old design (O1) or a clicker without the AI
    gate. System copy (`ui.*` the design translates or keeps English) is never drafted (only the Arabic of the spa's
    own English, below); a draft losing a `{token}` is
    skipped. **Decision (integrator, 2026-10-13):** on `/ar` of a v2 design the order is content Arabic > the design's
    `l10n.ar` > content English > design English (contract doc §4); so a value the spa wrote in English only (leftover
    reason `arabic`; not a field the contract keeps English) is an `arabicOnly` slot: only its Arabic is drafted, the
    stored English kept (`{t: {en: stored, ar}}`), listed right after the leftovers — with `onlyDefaults`, and on
    translated system copy in either mode.
  - **Feed + render:** `crm-data.json` + `locale`; `?page=` = that live page's `crm-defaults` + content, then the CRM
    (literal designs: the CRM alone); `{{crm_data_url}}` placeholder; `designWithCrm` writes `locale` into v2 data and
    `l10n.ar` on Arabic (v1 output and keys as in P4). Video: upload body cap 8 MB, `SlotVideo` upload button; a
    picture file in a video slot (or the reverse) is refused on save.
  - **Console:** report panel in the upload sheet, report in the upload message / audit, Pages card badge + line +
    warnings + connector prompt, rollout sheet (carry dry run per spa: pages, edits kept / not kept, made for this spa,
    keeps its phone fixes / N picture adjustments, has a draft; a pending version's Phone fixes and picture-adjustment
    differences against the current one; skipped spas with reasons), live Undo bar copy.
  - **Owner open points (review, 2026-10-13):** O5 the Arabic defaults need native review; O6 two v2 default
    pictures (`spa.experience_image`, `booking.image`) show BE RELAX branding on bottle labels — the owner supplies
    neutral photos (until then any other spa applying v2 should replace them); before the Roll out set BE RELAX's
    branch "Area shown on the website" to "Al Zahiyah, Abu Dhabi" so its first scene matches v1.

## 8. Tests

**Core (Vitest):**
- `html-content.test.ts`:
  - slot snapshot from a BE RELAX fixture (stripped literal);
  - a deep-frozen input is never mutated, and empty content returns the same object;
  - operational paths refused;
  - `[id]` addressing;
  - AR → EN → design fallback;
  - hide;
  - leftovers.
- `html-design.test.ts`:
  - text ids are the same before and after the CRM splice;
  - escaping, kept whitespace, stale `src` skipped;
  - no overrides gives the very same string;
  - **skeleton property:** tags, CSS and scripts unchanged except the literal and the overridden values;
  - a replace-only picture adds no forced fit, and old adjustments give the same output.
- `html-crm.test.ts`: area label, D1 fallback, photo-less staff, `collapseSameName`.
- `html-crm-seed.test.ts`: the fuzzy pairs from live data.

**Services (`spa_test`, under `/tmp/e2e.lock`):**
- `design-seed.test.ts`: RLS between tenants; only empty fields filled; a re-run creates no duplicate assets; prices never touched.
- Parity of the moved `saveService`.
- `cleanHtmlDesignContent` and the `html_content` op (drafts only, another tenant's `/files` refused).
- `branches.area_label`.

**Web unit:** `designWithCrm` with no content gives the same string and key as R26; changed content gives a new key.

**E2E:**
- New `html-content.spec.ts`:
  - edit a scene title and picture, a heading, then reset one;
  - the draft preview changes and the live page does not;
  - publish, and the live page changes;
  - the stored sha is unchanged and the leftover warning clears.
- New `design-seed.spec.ts`: apply, pair, confirm; the CRM gets the photos; no empty frames on the site.
- Extend `site-mcp.spec.ts` and `packages/ai/test/site-mcp.test.ts`.
- `html-fidelity`, `html-upload` and `html-crm` stay unchanged and green.
- The Thai parity test covers the new keys.

## 9. Docs

- `html-crm-contract.md`: the layers, the precedence table, seeding, §9 v2.
- `docs/CODEMAP.md`: "HTML designs" plus a new "Website content (R28)" entry.
- `docs/PLAN.md` §14.8 R28.
- `CLAUDE.md`: a locked-decision line (content overlays change values only, R24 kept; the D1–D3 outcomes).
- New Thai strings flagged for your team's review.
- Docs are merged into `claude/intelligent-heisenberg-g9e81o` with each phase; code goes through the normal review path.

## 10. Phases

Each phase runs typecheck, lint, the touched packages' tests and that phase's e2e spec. The full suite runs only in P6.

| # | Work | Hours | What you see afterwards |
|---|---|---|---|
| P0 | §5 merge fixes in core (area label, D1, photo-less staff, same-name collapse) + tests + docs | 3 | Same day, no republish: last-test shows its own city, no BE RELAX phones or logos on other spas, no empty therapist frames, each treatment once |
| P1 | `html-content.ts`, `designWithCrm` options and cache key, 3 callers, `content` prop, `cleanHtmlDesignContent`, file copy rules, the `html_content` op + `get/set_html_content`, pop-in check | 12 | You can ask Claude to "rewrite last-test's journey for Dubai and swap scene 2's picture": it becomes a draft, you preview and publish. The file is untouched |
| P2 | Console "Website content" field (CRM summary, Story, Visit, Booking, Messages, Logo), readiness and leftovers, card, publish warnings | 10 | Every story text and picture is a plain field with uploads and focal points, with a list of what still mentions BE RELAX or Abu Dhabi |
| P3 | `catalog.ts` move, `design-seed.ts`, matcher, seed sheet, migration 0051 area field, staff photo hint, upload permission fix | 10 | Applying BE RELAX fills the CRM: treatments get their photos, missing ones can be created, therapist photos are assigned by click, each branch has its area field |
| P4 | Page texts, attributes, title and meta description; per-spa Pictures; replace-only fit fix; Ask AI + Write texts on content. **Done 2026-10-13 (PR pending):** A core + render + `html_content` op + draft-save check, B Ask AI / Write texts / connector, C editor; as built: the "As built (P4)" notes in §2 (item 2), §3 and §6, review fixes below the table | 9 | Every heading, button, nav label and the page title is editable; one click drafts all of a spa's texts in EN + AR |
| P5 | Contract v2 doc, upload report, BE RELAX v2 (ui dictionary, bindings, `data-if` on photos, neutral defaults; Arabic texts in the same layout per D3), `carryHtmlContent`, `crm-data.json?page=`, video upload. **Built 2026-10-13 (A core, B platform, C BE RELAX v2 file):** template versions + Roll out = sign-off (D4: live at once, content carried, own look pinned, per-spa undo + hold), D5 Write texts queue (web `after()` + worker sweep), report in upload / Pages card, `?page=` + locale + `{{crm_data_url}}`, video upload in the editor; as built: §7 "As built (P5, platform)" | 11 + your look review | System and form messages are editable too; Arabic texts on BE RELAX; each upload shows how dynamic the design is; BE RELAX spas move to v2 when you click Roll out |
| P6 | Build + full e2e (`E2E_SERVER=start`) + walkthrough on last-test + final docs. **Done 2026-10-13:** all unit tests (core 501, db 19, auth 13, services 656, ai 77, worker 42) and the full Playwright suite on the production build (135 passed, 2 skipped by design: thumbnail / screenshot generators) on release cca4874; last-test was deleted by the owner, the walkthrough is the e2e suite + the BE RELAX v1 → v2 visual check (0 px with the same CRM data). Releases: P0+fix #43, P1 #44, P2 #45, P3 #46, P4 #47, P5 #48 | 3 | Release |

**Total: about 58 h.** P0–P2 already make each spa's site its own; P3–P5 complete it.

**Review fixes (P4, 2026-10-13)** — after the A / B / C review, before release:
- **Core + op:** picture URLs are swapped with replacer functions (`$&` stays text), `&` escaped in `src` / `srcset`
  / style attributes (raw in `<style>` bodies), and character references refused in picture URLs (a pasted `&amp;`
  read as `&` first; `$` allowed again, core `htmlImageUrl`); a text is script-bound only where the design's JS
  replaces it (`scriptTextIds`, one pass per script, timing-tested on 1 MB scripts and long accessor chains; text
  writes, `replaceChildren` and jQuery `.empty()` refills on the element itself, `#id tag` (that tag only), looped id
  arrays and holder objects count; `+=`, appends, writes through child access, listener / read-only ids stay editable — a footer whose year a script writes keeps its
  other texts editable and checked) and says by what (`boundBy` `crm` on a
  contract design — `CRM_DATA` literal or crm-endpoint meta — or for `data-crm*`, `script` only without a contract;
  op errors "filled from the CRM — change it in the CRM" / "filled by the design's script — change it in the design
  file (patch_html_design)"); common named references decoded, U+00A0 kept, a run with an unknown reference not
  listed; an override equal to the design text keeps the original bytes; `{{placeholders}}` in an override are
  plain escaped text; `t.en` optional (Arabic-only entries leave the English page byte-identical; the op's `en` null
  / left out keeps the stored English, `''` drops it); leftovers skip a design text only when its entry has
  non-blank English; `htmlContentView` with a clip marks cut texts / values `cut: true` + their full `length`.
- **Ask AI, Write texts, connector, draft saves:** the Arabic-only rule for AI (`set_html_content` and Ask AI take
  `{id, ar}` without English, and data values `{t: {ar}}`: the stored English, else the design's, is kept; `en: ''`
  = the design's English; an Arabic-only value whose English is still the design's stays checked for leftovers); an
  AI never translates a `cut` entry (HTML_CONTENT_RULES, get / set_html_content descriptions; a whole new English with
  its Arabic is fine): Ask AI's dry run and Apply pass `runSiteEdit({htmlContent: {clip: 160}})`, which drops a cut
  entry without new English or with English built from the visible fragment (same first 40 characters or most of its
  words) — and any entry that doesn't fit (unknown / bound id, cut-short copy, bad value, foreign file) — with a
  note instead of failing the op; the connector's `get_html_content` `ids` (≤ 50) returns entries whole so they can
  be read before translating; a cut-short English copy is refused, the whole design text echoed (one ending in "…"
  itself) is not; leftovers first in Write texts; a draft save refuses malformed ids, private and other spas' file
  ids and tolerates the spa's own files deleted since; framed pages get the title / description overrides in their
  metadata; template content localised (its `/files` values copied) on apply like the design's other files, and
  scrubbed on "Save site as template" (§2 item 4).
- **Editor:** an Arabic-only edit stores `{ar}` (never the listed design text as English); bound texts are worded
  by `boundBy`; data-slot pictures / videos are stored only as a complete `/files/…` or https link (inline hint).
- **E2E (`html-crm.spec.ts` "R28 P4"):** the leftover list names the heading before the edit and drops it after;
  the page title is reset with its "Design" button (canvas title back) and set again; an Arabic-only button text
  shows on `?lang=ar` next to the English fallback of an English-only text, while the English page keeps the
  design's words; the contract fixture's script-written text reads "Filled by the design from the CRM (#spa)".
  `site-mcp.spec.ts`: the script-bound error names `patch_html_design`.
- **Docs:** PLAN §14.8 owner note — empty `{id, src}` adjustments (an image card opened without changes) also lose
  the forced cover / centred; this phase row.
