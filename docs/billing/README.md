# Client invoices (made by Claude for the owner, 2026-10-28)

Platform invoices that the owner sends by hand, outside the app's console billing. The amounts and plans follow PLAN §18.8.

## Invoices issued

| No. | Client | What | Amount |
| --- | --- | --- | --- |
| SM-INV-2026-013 (dated 9 Oct 2026; was 001) | Be Relax Massage Center and Spa LLC | Premium setup at the Standard price: 14,000 − 5,000 special offer = 9,000; **paid in full**, balance 0 | AED 9,000 |
| SM-INV-2026-014 (dated 1 Nov 2026; was 002) | Be Relax Massage Center and Spa LLC | November monthly fee (period 1–30 Nov 2026, one month): Premium at the full AED 3,000, **no special offer on the monthly fee** (owner 2026-11-01); **NOT PAID**, must be paid by 10 Nov 2026, then AED 3,000 by the 10th of every month | AED 3,000 |

Owner 2026-11-01: the setup invoice (013) is **PAID** in green (stamp, status, amount paid, balance 0); the November invoice (014) is **NOT PAID** in red (stamp, status, due, total row, payment line). Invoice numbers continue from 013 (owner 2026-11-01): the next is **SM-INV-2026-015**.

## Owner's rules for these invoices

- **Seller:** "Spa Management", legal name **1997labs Tech Solutions**, ask@spamanagement.co · 1997labs.com, and our phone numbers +971 50 315 3267 · +971 50 192 4021 (owner 2026-11-01).
  - Don't put a city or country under the seller.
  - Don't add bank details or the client's domain.
- **Logos:** the SM logo, with "Powered by" and the 1997 Labs logo under it on the left; the company block goes on the right.
- **No VAT:** don't mention VAT anywhere, including on the features list.
- **No signature or stamp:** instead, one small line: "This is an official invoice issued by 1997labs Tech Solutions (Spa Management); no stamp or signature is needed."
- **Special offer:** a highlighted row (lime background with a "SPECIAL OFFER" pill).
- **Languages:** say that the website is in 2 languages (EN + AR) and the CRM in 2 languages (EN + TH).
- **Setup invoice:** 2 pages. Page 2 is the features list, sections A–H. It leaves out AI and Instagram, campaigns, win-back, birthday and review-request messages, and branches.
- **Monthly invoice:** the "Includes" list covers:
  - hosting and SSL;
  - SEO care;
  - Google Business Profile care;
  - support 7 days a week;
  - daily backups and security updates;
  - new features and updates.
  - Google Ads care and advice (owner 2026-11-01).
- **File names (owner 2026-11-01):** "{Invoice no.} - {Spa legal name} - {contact}.pdf", e.g. "SM-INV-2026-013 - Be Relax Massage Center and Spa - Madam Mina.pdf" (Be Relax contact: Madam Mina).

## Files

- **`word/`:** editable Word templates for the owner, with [bracketed] fields. Word doesn't add up the amounts, so totals are typed by hand.
  - To rebuild them: `cd docs/billing/word && NODE_PATH=$(npm root -g) node make.cjs`. It uses `docx`, which the docx skill preinstalls.
  - To check the layout: convert to PDF with LibreOffice, then `pdftoppm`.
- **`pdf-html/`:** the HTML sources of the PDFs that were sent: the two Be Relax invoices (`be-relax-setup-SM-INV-2026-013.html`, `be-relax-nov-SM-INV-2026-014.html`) and the general proforma (`proforma.html`).
  - To render one: `node render.mjs "$PWD/<file>.html" out.pdf out.png`. It uses Playwright Chromium and adds the page footer ("Page x of y").
