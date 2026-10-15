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
| `be-relax-v2.7.html` | `525ddf4f56118c33` | **Next:** sent to the owner 2026-10-14, waiting for Upload + Roll out. Final v2.6 plus the Arabic fonts read from `CRM_DATA.inline_fonts` (Decision B, contract §11). |

`qa-2026-10-14.md` is the full desktop, tablet, phone and functional QA of the live site (v2.4 at the time). The fixes went
into v2.6 and the platform (PLAN §14.8). Its screenshot paths pointed to a temporary folder that was not kept.
Older versions (v2–v2.5) were replaced and are not kept here.
