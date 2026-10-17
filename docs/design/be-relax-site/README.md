# BE RELAX website design files

These are the HTML design files for the spa BE RELAX MASSAGE CENTER AND SPA (`be-relax-massage-center-and-spa`). Each one is
uploaded in Console → Site templates → the design's row → Upload new version, then Roll out. The platform renders an
uploaded design exactly as built (CLAUDE.md, R24). The CRM fills in live data such as services, prices, staff and
hours (`docs/design/html-crm-contract.md`).

The built-in pictures and fonts these files link to are in `apps/web/public/designs/be-relax/`. They are named by
content hash, so never rename or delete them: published designs link them.

| File | sha256 (first 16) | Status |
| --- | --- | --- |
| `be-relax-v2.6.html` | `6811917ddfc60018` | **Live** (rolled out by the owner 2026-10-14). v2.5 plus the phone scroll fix and the QA fixes. |
| `be-relax-v2.7.html` | `fafd4d9718339059` | **Next (2026-10-17, owner):** v2.6 + Google Ads tag `AW-18204116059` in the head only (body byte-identical): website call conversion for 02 557 6533 (label `Ti9ZCP_t5p8dENuIs-hD`), click events `phone_call_click` / `whatsapp_click` / `book_click` / `booking_request_sent`; conversion labels for the clicks go in `SEND_TO` at the top of the block. |
| `be-relax-v2.7-arabic-fonts-unreleased.html` | `525ddf4f56118c33` | Never uploaded: final v2.6 + Arabic fonts from `CRM_DATA.inline_fonts` (Decision B). Its changes can be carried into a later version. |

`qa-2026-10-14.md` is the full desktop, tablet, phone and functional QA of the live site (v2.4 at the time). The fixes went
into v2.6 and the platform (PLAN §14.8). Its screenshot paths pointed to a temporary folder that was not kept.
Older versions (v2–v2.5) were replaced and are not kept here.
