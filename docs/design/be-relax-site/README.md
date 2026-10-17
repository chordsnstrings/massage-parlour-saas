# BE RELAX website design files

These are the HTML design files for the spa BE RELAX MASSAGE CENTER AND SPA (`be-relax-massage-center-and-spa`). Each one is
uploaded in Console → Site templates → the design's row → Upload new version, then Roll out. The platform renders an
uploaded design exactly as built (CLAUDE.md, R24). The CRM fills in live data such as services, prices, staff and
hours (`docs/design/html-crm-contract.md`).

The built-in pictures and fonts these files link to are in `apps/web/public/designs/be-relax/`. They are named by
content hash, so never rename or delete them: published designs link them.

| File | sha256 (first 16) | Status |
| --- | --- | --- |
| `be-relax-v2.6.html` | `6811917ddfc60018` | Previous (live 2026-10-14 → 2026-10-17). v2.5 plus the phone scroll fix and the QA fixes. |
| `be-relax-v2.7.html` | `10d4b1dcb58c8d62` | **Live** (uploaded + rolled out by the owner 2026-10-17; verified live: tags once, body unchanged, conversions fire): v2.6 + Google Ads tag `AW-18204116059` in the head only (body byte-identical): website call conversion for 02 557 6533; conversions (owner's labels): phone `tel:` click → "Phone Call" `Ti9ZCP_t5p8dENuIs-hD` (same action as the call conversion), WhatsApp click → `9PUCCPzt5p8dENuIs-hD`, booking request accepted by the CRM → "Completed Booking" `kFLlCPnt5p8dENuIs-hD`; Book button clicks = event only. Named events go to the account (`send_to: 'AW-18204116059'`) so they never reach the call-conversion target. |
| `be-relax-v2.7-arabic-fonts-unreleased.html` | `525ddf4f56118c33` | Never uploaded: final v2.6 + Arabic fonts from `CRM_DATA.inline_fonts` (Decision B). Its changes can be carried into a later version. |
| `be-relax-v2.8.html` | `ef21c75941f22eda` | **Ready to upload, not live yet.** The live v2.7 (Google Ads build) plus `"prefill":1` in its contract (nothing else changes; the Arabic-fonts changes are not in it): the platform fills the address, hours, phone numbers and links into the page's HTML for search engines (contract §12). |

`qa-2026-10-14.md` is the full desktop, tablet, phone and functional QA of the live site (v2.4 at the time). The fixes went
into v2.6 and the platform (PLAN §14.8). Its screenshot paths pointed to a temporary folder that was not kept.
Older versions (v2–v2.5) were replaced and are not kept here.
