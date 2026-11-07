# Owner's manuals

These are the Markdown sources of the four manuals sent to the owner:

| Manual | Source | Last PDF |
| --- | --- | --- |
| Platform Owner's Manual, English | `src/platform/en/` | 159 pages (updated for R24–R28) |
| Platform Owner's Manual, Arabic | `src/platform/ar/` | 180 pages |
| Spa Owner's Manual, English | `src/spa/en/` | 197 pages |
| Spa Owner's Manual, Thai | `src/spa/th/` | 207 pages |

`typeset-{platform,spa}/` holds the scripts that made the PDFs: `build.mjs`, `style.css`, `package.json` and
`assets/logo.svg`, plus `pdfinfo.py` for the platform manual. The layout matches the original working folder: `build.mjs`
reads `../src/` and writes `../out/`.
The Markdown links its screenshots as `../../../shots/{platform,spa}/…`, which means `docs/manuals/shots/`. Those 234 PNGs
(58 MB) and the PDFs are not in git, and the owner has the PDFs. A rebuild needs the screenshots shot again or restored
into `docs/manuals/shots/`.

The manuals describe the product as of R28 (2026-10-13). R29–R32 (console Google/Meta keys, weekly SEO check, Make
booking, booking ↔ sale order, daily sales sheet PDF) are not in them yet.
