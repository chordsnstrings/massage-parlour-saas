# Owner's manuals

These are the Markdown sources of the four manuals sent to the owner:

| Manual | Source | Last PDF |
| --- | --- | --- |
| Platform Owner's Manual, English | `src/platform/en/` | 159 pages (updated for R24–R28) |
| Platform Owner's Manual, Arabic | `src/platform/ar/` | 180 pages |
| Spa Owner's Manual, English | `src/spa/en/` | 197 pages |
| Spa Owner's Manual, Thai | `src/spa/th/` | 207 pages |

`typeset/{platform,spa}/` holds the scripts that made the PDFs: `build.mjs`, `style.css` and `package.json`. They were run
from a temporary working folder with the screenshots alongside. The screenshots and PDFs are not in git; the owner has
the PDFs. Before rebuilding, check the paths in `build.mjs`.

The manuals describe the product as of R28 (2026-10-13). R29–R32 (console Google/Meta keys, weekly SEO check, Make
booking, booking ↔ sale order, daily sales sheet PDF) are not in them yet.
