# Spa dashboard redesign — spec ("Be Relax CRM" design → every spa)

Source: `/root/.claude/uploads/5580caeb-357f-5430-abff-e48afc8089c3/aa462eb3-be-relax-crm_2.html` (956 lines; CSS 13–345,
markup 347–388, JS 390–953: i18n 399–410, NAV 413–440, demo data 447–470, TH dictionary 474, helpers 475–480,
router 483–490, PAGES 493–949). All `Lnnn` refs below are to that file.

Owner decisions (2026-10-08): build everything in the design (look, shell, menu, pages, features) for ALL spas,
EXCEPT the brand logo → sidebar shows the spa's own logo + name. Dashboard languages **EN + TH only** (no Arabic; toggle
= `EN / ไทย`). Pages ~15–20 % more compact than the HTML (§D). Thai covers ALL dashboard UI/system text, names stay as
typed (§6). Super-admin console (`admin.` host, `apps/web/src/app/platform`) and the site editor chrome stay unchanged.

Scope rule: `apps/web/src/app/globals.css` tokens (`--bg #fafaf8`, sage accent, prefers-color-scheme dark) are shared
with super-admin, editor chrome and auth pages. The new look must be **scoped** (e.g. `crm.css` under a `.crm` wrapper
set by `dashboard/[tenant]/layout.tsx`, same pattern as marketing's `.mkt`), and a new `SpaShell` must replace
`AppShell` only in the tenant layout (AppShell/BottomNav stay for platform).

---

## 1. Tokens

### 1.1 Colour — light (the only mode the design defines) — L14–27
| Token | Value | Use |
|---|---|---|
| `--bg` | `#E7ECFB` | page ground (lavender) behind the framed window; also `<meta theme-color>` L8 |
| `--bg2` | `#F4F6FD` | website-preview gradient top L254 |
| `--surface` | `#FFFFFF` | app window, sidebar, cards, KPI tiles |
| `--surface2` | `#F6F8FD` | profile card, chat "them" bubble, q-item, jtabs track, kpi icon tile, walk-in event |
| `--text` | `#1A1F2E` | body text |
| `--muted` | `#737C8C` | secondary text, inactive nav, th |
| `--accent` | `#3B6FE0` | the one accent (blue) |
| `--accent-ink` | `#2F5FD0` | eyebrow text, active nav text, "hi" bars |
| `--on-accent` | `#FFFFFF` | text on accent |
| `--accent-grad` | `linear-gradient(135deg,#4C84F2,#3156D6)` | logo tile, profile avatar, Ask-AI button |
| `--line` / `--line2` | `rgba(26,31,46,.08)` / `.13` | hairlines / stronger borders, meters' track |
| `--glow` | `rgba(59,111,224,.18)` | accent shadows |
| `--tint1/2/3` | `#9DB8F2` / `#DCE6FB` / `#6E8FEC` | chart gradient (tint3), avatars, journey stage |
| `--ok` / `--ok-bg` | `#1FA865` / `rgba(31,168,101,.12)` | success pill, up delta |
| `--warn` / `--warn-bg` | `#C98A12` / `rgba(245,184,46,.18)` | warning pill |
| `--bad` / `--bad-bg` | `#E0552F` / `rgba(242,96,60,.14)` | danger pill, nav count, down delta, bell dot |
| `--info` / `--info-bg` | `#3B6FE0` / `rgba(59,111,224,.12)` | info pill, `.note` |
| `--blue` `--amber` `--orange` `--green` | `#3B6FE0` `#F5B82E` `#F2603C` `#28C877` | calendar events `.e1–.e4`, timeline chips, journey |
| extra literals | `#7A6CE0` (violet, VIP), `#3B9EE0`, `#E0559E`, `#5F6E7E` (avatar colours L448–470), `#5a4410` (text on amber L165/341), `#25D366` (WhatsApp tile L191) | |
| legacy glass | `--glass #FFF`, `--glass2 #F6F8FD`, `--glass-brd var(--line)`, `--hl transparent`, `--blur 0` (L26) | collapse into surface/surface2/line; no blur |

### 1.2 Colour — dark (NOT in the design; proposal, needs owner OK)
The design only has `toggleTheme()` (L392–393, references a missing `#themeicon`) and one dark rule
(`[data-theme="dark"] .nlink.on .cnt`, L62). Proposed dark set, same structure:
`--bg #0E1220 · --bg2 #131A2A · --surface #161C2C · --surface2 #1C2335 · --text #E6E9F2 · --muted #8C95A8 ·
--accent #5B8BF0 · --accent-ink #86A6F6 · --on-accent #FFFFFF · --accent-grad 135deg #5B8BF0→#3D63DA ·
--line rgba(230,233,242,.08) · --line2 rgba(230,233,242,.14) · --glow rgba(91,139,240,.28) · --tint1 #34497A ·
--tint2 #1D2945 · --tint3 #6E8FEC · --ok #3CCB85 · --warn #E3AE3C · --bad #F0775A · --info #5B8BF0` (bg tints at
~.16 alpha); frame shadow `0 20px 60px rgba(0,0,0,.45)`; card shadow none (hairline only).
Theme switch = `data-theme` on `<html>` (light/dark/system), remembered per user (cookie + `localStorage`), default system.

### 1.3 Fonts — L11, L23, L34–38
- UI = **Inter** everywhere (`--head`, `--serif`, `--font` all Inter, L23). Already bundled
  (`@fontsource-variable/inter`). Body 14 px / line-height 1.55, antialiased (L30).
- Thai: **Noto Sans Thai** 300–700 when `html[lang="th"]` (L38) → add `@fontsource-variable/noto-sans-thai`; Thai
  tables/events use `word-break:keep-all; line-break:normal` (L146).
- Drop: Manrope + Libre Baskerville (loaded L11, never used), IBM Plex Sans Arabic + all `html[dir=rtl]` rules
  (L37, 51, 55, 75, 102, 143, 180, 182, 264) and `.ar` (L153).
- Weights: headings 700 (L34) but most override to 600 (L49, 76, 106, 126); `.kpi .num`, `.bname b` etc. 800 (L35).
  Tabular figures via `.num-c` (L152) and legend values (L219).
- Type scale (original px): 9.5 brand tag · 10 nav group · 10.5 th / chart labels · 11 pill/eyebrow/crumb-small ·
  11.5 sub/delta · 12 labels · 12.5 notes/rows · 13 table/btn · 13.5 nav/inputs · 14 body · 15.5 team name ·
  17 card title · 18 brand · 21 page title · 22–26 donut/gift/preview · 27 KPI · 30 stat · 44 billing price.
- Letter-spacing: uppercase micro-labels .16–.2em (L50, 54, 74, 100), th .1em (L142), headings −.012/−.02em (L34–35).

### 1.4 Radii — L24, L42, misc
`--radius 16` (cards, stat, cal) · `--radius-sm 10` · `--rp 14` (arch cards, decorative squares) · app window 20 (L42;
16 ≤680) · nav link 11 · btn/iconbtn/search/seg 10 · inputs 11 · KPI 14 · pills 999 · events 10 · chips 7 ·
avatars 50 % (tav) / 9 (logo tile, profile avatar) · toggles 999 · bars 9.

### 1.5 Shadows
Window `0 20px 60px rgba(32,44,94,.12)` L42 · card/stat `0 1px 2px rgba(32,44,94,.04), 0 6px 20px rgba(32,44,94,.05)`
L103/122 · KPI `0 1px 2px …04, 0 4px 14px …04` L307 · accent glow `0 6px 16px var(--glow)` (logo tile L46, `.btn-a`
L296, Ask-AI L297) · btn hover `0 10px 24px var(--glow)` L115 · gift `0 20px 44px var(--glow)` L226 · jtabs active
`0 1px 3px rgba(32,44,94,.08)` L324 · mobile drawer `0 0 60px rgba(0,0,0,.25)` L263 · scrim `rgba(0,0,0,.4)` L284.

### 1.6 Spacing (original)
Window margin 14 (8 ≤680) · view padding 26 (16/14 ≤680), max-width 1260 (L94) · grid gap 16 (L109) · card padding 20 ·
stat 18/18/16 · KPI 16/16/12 · topbar 14×26 · brand 20/20/16 · nav scroll 6/12/20, link 9×12 gap 11 · side-foot 14 ·
table cell 12, th bottom 10 · list row 13 vertical · section spacing via inline `margin-bottom:16px`.

### 1.7 Breakpoints
`>1200` KPI row 5 cols → `≤1200` 3 (L287) · `≤1080` g4→2, g3→2, col-2/col-2b→1 (L260) · `≤860` sidebar becomes
off-canvas drawer, burger shows, profile text hidden (L261–269) · `≤760` KPI 2 cols, timeline text 10/9 px (L288) ·
`≤680` all grids 1 col, search hidden, compact topbar, window margin 8 (L270–283) · `≤480` KPI 1 col (L289).
Grid helpers: `.g4 .g3 .g2` equal; `.col-2` 1.6fr/1fr; `.col-2b` 1fr/1.6fr; `.kgrid` 5 equal (L110–111, 286).

## D. Density (owner: "page is a bit big — reduce it") — target ≈ 15–20 % more compact
Implement every size as a token on `.crm` (`--fs-*`, `--h-ctl`, `--pad-*`) so density is tuned in one place.
Thai floor: never below 12 px for Thai body text (taller glyphs); keep line-height 1.55 for `lang=th`.
Touch: on `(pointer:coarse)` keep ≥40 px controls / ≥44 px hit areas (PLAN §12.4).

| Item | Original (line) | Compact |
|---|---|---|
| Body font | 14 (L30) | **13** |
| Page title (crumb b) | 21 (L76) / 17 mobile | **18** / 16 |
| Crumb section label | 11 (L74) | 10 |
| Card title h3 | 17 (L106) | **15** |
| Card sub | 12 | 11.5 |
| Stat number | 30 (L126) | **24** |
| KPI number | 27 (L312) | **22** |
| Billing price | 44 (L825) | 36 |
| Gift/preview/donut headings | 26 / 26 / 22 | 22 / 22 / 18 |
| Brand name / tag | 18 / 9.5 (L49–50) | 15 / 9 |
| Nav link font / icon | 13.5 / 18 (L56–57) | **12.5** / 16 |
| Nav group label | 10 (L54), padding 16/12/7 | 9.5, padding 12/10/5 |
| Table th / td font | 10.5 / 13 (L142–144) | 10 / **12.5** |
| Pill | 11, pad 3×10 (L132) | 10.5, pad 2×8 |
| Button / small button font | 13 / 12 (L112, 118) | 12.5 / 11.5 |
| Note / list text | 12.5 | 12 |
| Sidebar width `--side` | 248 (L24) | **216** |
| Mobile drawer width | 276 (L263) | 256 |
| Window margin / radius | 14 / 20 (L42) | 10 / 16 |
| Topbar padding (≈ height) | 14×26 (≈70) (L72) | 10×20 (**≈56**) |
| Icon btn / search / seg / input height | 42 (L77, 81, 86, 223) | **36** |
| Button / small button height | 40 / 33 (L112, 118) | **34** / 28 |
| Nav link padding (row height) | 9×12 (≈39) | 7×10 (**≈32**), gap 9 |
| Brand block padding / logo tile | 20/20/16 / 34 | 16/16/12 / 30 |
| Profile card pad / avatar | 9×11 / 34 (L300–301) | 7×9 / 28 |
| Plan card padding | 13×14 (L64) | 10×12 |
| View padding | 26 (L94) | **20** (14 ≤680) |
| Grid gap | 16 (L109) | **12** |
| Card padding / header gap | 20 / 15 (L103, 105) | **16** / 12 |
| Stat padding / corner deco | 18/18/16 / 90 (L122–123) | 14/14/12 / 70 |
| KPI padding / icon tile | 16/16/12 / 26 (L307–309) | 12/12/10 / 22 |
| Table cell padding (row height) | 12 (≈45) (L144) | 9×10 (**≈36**) |
| Table avatar `.tav` | 32 (L150) | 28 |
| List row padding / icon tile | 13 / 38 (L170, 172) | 10 / 32 |
| Toggle | 40×23, knob 18 (L178–179) | 34×20, knob 15 |
| Calendar slot min-height / header pad | 64 / 12×10 (L157–160) | 52 / 9×8 |
| Event padding / font | 7×9 / 11.5 (L162) | 5×7 / 11 |
| Timeline cell min-height | 44 (L339) | 36 |
| Chat bubble pad / font | 9×13 / 13 (L186) | 7×11 / 12.5 |
| WhatsApp queue item pad / tile | 14 / 40 (L190–191) | 11 / 34 |
| Progress bar | 8 (L198) | 6 |
| Bar chart height | 150 (L203) | 120 |
| Jtabs button / segbar | 32 / 26 (L323, 325) | 28 / 20 |
| Radii `--radius` / `--radius-sm` / `--rp` | 16 / 10 / 14 | 12 / 8 / 12 |
| Field gap / label | 14 / 12 (L221–222) | 12 / 11.5 |

## 2. Shell

Layout L41–97, markup L350–388. A framed white "window" (`.app`, grid `var(--side) 1fr`, margin 14, radius 20, big soft
shadow) on the lavender `--bg`. Sidebar is sticky full-height; main column = sticky top bar + `.view` (max 1260).

### 2.1 Sidebar (`.side` L44, markup L353–372)
1. **Brand** (L45–51, markup L354–357): 34 px gradient tile + name (18 px) + uppercase tag. **Replace** with the spa's
   logo image (contain, rounded 9, 34→30 px) + `tenants.name`; tag = default branch / emirate (design: "Spa · Abu Dhabi").
   No logo → monogram tile (initials on `--accent-grad`, as L46). Never show the design's mark or "Be Relax".
2. **Profile card** (L299–305, markup L358–362): avatar initials (gradient), user name, `{Role} · {spa}`, chevron →
   menu: Account (profile, 2FA, push), switch spa (current `switchHref`), language, theme, sign out.
3. **Nav** (L52–62 + overrides L293–295, config L413–440, render L441–443): grouped buttons; group label uppercase
   10 px; link = icon 18 (stroke 1.6) + label + optional count badge (red pill, accent when active). Active = 12 %
   accent tint bg, `--accent-ink` text, accent icon (L293–295 override the older solid style L59–61).
   Groups and items (16):
   - **Workspace**: Dashboard (`overview`), Calendar (count = today's bookings, demo 14), Bookings, Inbox & follow-ups (count = queued messages, demo 6)
   - **People**: Clients, Services & menu, Team & roles
   - **Growth**: Marketing, Website studio, Reviews
   - **Finance**: Accounts, VAT & payroll, Billing
   - **System**: Automations, Settings, Coming next (`roadmap`)
   Each item is permission-gated as today (`can(ctx, perm)` in `[tenant]/layout.tsx`).
4. **Plan card** (`.side-foot .plan` L63–68, markup L364–371): plan name, "AI allowance · N % used this month",
   5 px meter, "Renews {date} · AED {price}/yr". Data: `subscriptions`/`plans`, AI spend vs `tenants.ai_budget_usd`.
   Show only to `billing.view`; others see AI meter only or nothing.

### 2.2 Top bar (`.topbar` L72–92, markup L376–384), left → right
burger (≤860 only) · **crumb**: small uppercase group name + page title (21 px; Dashboard title = "Good morning,
{first name}" time-of-day greeting, L490) · **saved chip** `.tchip` (green cloud-check "Data saved", L342–344, L379;
bind to last server-action result: saving… / saved / failed) · **search** (L77–80, placeholder "Search clients,
bookings, invoices…", 210–300 px) · **language seg** `.seg` (L85–87, L381) → `EN | ไทย` only · **bell** iconbtn with red
dot (L81–84, L382) · **Ask AI** gradient small button (L297–298, L383; label "Ask AI" — not the design brand) ·
**theme toggle** iconbtn (sun/moon, path data L393; the design has the function but no button — add it).
`.me` avatar chip (L88–91) is styled but unused; the profile card replaces it.

### 2.3 Mobile
- ≤860 (L261–269): single column; sidebar becomes a fixed drawer (276 px → 256 compact) sliding from the start edge
  (`transform .3s`), dimmed scrim (L284–285) closes it; route change closes it (L489); burger visible.
- ≤680 (L270–283): window margin 8, radius 16; view padding 16/14; search hidden (→ put a search icon button that
  opens a full-screen search sheet); crumb group label hidden, title ellipsis; saved chip + Ask-AI hidden (move Ask AI
  into the drawer/profile menu); lang seg 38 px; iconbtn 38; card headers wrap.
- PLAN §12.2/§12.4 specify a phone bottom tab bar (current `BottomNav`); the design uses the drawer → drawer wins
  for the spa dashboard (record in PLAN §12).

## 3. Component catalogue (class → CSS lines → used in)

| Component | Classes | CSS | Notes / used |
|---|---|---|---|
| Eyebrow | `.ey` | 100–102 | uppercase accent label with 20 px rule; services rituals, billing |
| Card | `.card`, `.card.arch`, `.card-h` (`h3`, `.sub`, `.act`) | 103–108 | everywhere; header = title+sub left, actions end |
| Grid | `.grid .g4 .g3 .g2 .col-2 .col-2b .kgrid` | 109–111, 286–289 | responsive collapse §1.7 |
| Buttons | `.btn` + `.btn-a` (primary), `.btn-o` (outline), `.btn-sm`, `.btn-gh` (ghost), `.aibtn` (gradient) | 112–119, 296–298 | icon 16 px stroke 1.8; primary lifts 1 px + glow on hover |
| Icon button | `.iconbtn`, `.dot` | 81–84 | top bar |
| Segmented control | `.seg button.on` | 85–87 | lang, calendar Day/Week/Month, bookings status filter |
| Search field | `.search` | 77–80 | top bar |
| Stat tile | `.stat` `.lab` `.num` `.chg.up/.dn` | 122–129 | helper `stat()` L479; corner accent square |
| KPI card | `.kpi .top .ic .row1 .num .sub .vd` + `.delta.up/.dn/.flat` | 306–320 | overview; footer "View details →" link |
| Pills | `.pill` + `.ok .warn .bad .info .acc`, `.dotc` | 132–138 | status, source, tags, counts |
| Table | `.tbl` `.tname` `.tav` `.muted` `.num-c` | 140–152 | sticky? (no) — add sticky th; ≤768 → stacked cards (PLAN §12.4) |
| Resource calendar | `.cal .ch .r .ct .cc` + `.ev.e1–e4 .walk .block` | 155–167 | therapist columns with room label; time rows |
| Weekly timeline | `.wk .wh .wt .wc .wchip.b/.g/.a/.o` | 334–341 | overview activity log |
| List row | `.row .ricon .rbody .rtime` | 169–177 | automations, marketing posts, docs, audit |
| Toggle | `.rtoggle(.off)` | 178–182 | automations, security (make it a real switch, role="switch") |
| Chat | `.chat .bub.them/.us .t` | 184–189 | AI receptionist transcript |
| WhatsApp queue item | `.q-item .qi .qb .hd .msg` | 190–195 | inbox; Send = wa.me link, Edit |
| Progress / meter | `.bar(.g/.w) i`, `.plan .meter` | 197–200, 66–67 | expenses, stock, AI usage |
| Bar chart | `.barchart .bc(.hi) i span` | 202–207 | sources, P&L months (implement with existing chart lib / Recharts per PLAN §12.5) |
| Donut + legend | `.donut .dc`, `.legend .lg .sw .lv` | 209–219 | donut defined but unused; legend used in marketing |
| Journey | `.jtabs`, `.segbar`, `.jlegend .jrow .sw .jn .jc .jp` | 321–333 | overview client journey |
| Form | `.fieldrow label`, `.inp` (focus border accent) | 221–224 | settings, website change request |
| Gift card | `.gift .gv` | 226–228 | accounts (gift-card visual with spa name) |
| Callout | `.note`, `.note.acc` | 230–233 | info notes on most pages |
| Hairline | `.hairline` | 235 | separators |
| Roadmap item | `.coming .ci` | 236–239 | coming-next page |
| Team card | `.team-card .tav .role .stats` | 241–247 | team page |
| Site preview | `.wstudio .wbar .wd .wurl .wprev .arch-ph` | 249–257 | website page (browser frame mock) |
| Status chip | `.tchip` | 342–344 | top bar saved chip |
| Profile card | `.profile .pav .pn .pc` | 299–305 | sidebar |
| Scrim / burger | `.scrim`, `.burger` | 284–285, 92 | mobile |
| Not in design | modals, sheets/drawers, dropdown menus, toasts, empty/loading/error states, date pickers, pagination | — | restyle existing `components/ui` (`sheet.tsx`, `form-sheet.tsx`, `toast.tsx`, `page.tsx` EmptyState, `table.tsx`, `badge.tsx`, `stat-card.tsx`, `card.tsx`, `button.tsx`, `input.tsx`, `form.tsx`) to these tokens inside `.crm` |

## 4. Motion (design) — implement with `motion` + PLAN §12.3 timings; `prefers-reduced-motion` → fades
| What | Spec | Line |
|---|---|---|
| Page enter | `fade` .4s ease: opacity 0→1, translateY 10px→0 | 95–97 |
| Nav link hover / state | all .18s; hover 7 % accent tint | 56, 58 |
| Active nav | (design: instant) → keep existing shared-layout pill (`layoutId="sidebar-active"`) | 293 |
| Buttons | .2s; primary hover translateY(−1px) + glow; outline hover accent border | 112, 115, 117 |
| Ask-AI hover | translateY(−1px) | 298 |
| Icon button hover | .2s colour + accent border | 81–82 |
| Table row hover | background .15s → 5 % accent | 147–148 |
| KPI hover | "View details" turns accent | 316 |
| Toggle knob | slide .2s | 179 |
| Bar chart / stage bar | height/flex .3s (animate draw-in on mount) | 205, 326 |
| Mobile drawer | transform .3s slide + scrim | 263–265, 284 |
| Additions from PLAN §12.3 | KPI number tickers, staggered card reveal (30 ms), skeleton→content crossfade | — |

## 5. Pages (16 NAV ids)

1. **overview — Dashboard** (L496–554). Purpose: today at a glance. Layout: `.kgrid` 5 KPIs → `.col-2` (activity log |
   client journey) → full-width priority bookings card.
   KPIs (`.kpi` with icon, value, delta pill, sub, "View details"): Total clients (+8.2 %, all active), Bookings today
   (+3, incl. walk-ins), Occupancy (78 %, Stable, rooms·therapists), Revenue month (AED, +5.9 %, net), Messages to send
   (count, ready in WhatsApp queue). Activity log: week grid Mon–Sun (today highlighted), hour rows, coloured chips for
   team/system actions (follow-up, reminder, offer, VIP, thank-you); "Weekly ▾" period button. Client journey: tabs
   Stage/Source/Service; stacked segment bar + legend rows (Lead 29 %, Booked, Visited, Repeat, VIP; count + %).
   Priority bookings table (today + tomorrow): client avatar+name, service·duration, therapist, when, amount, stage
   (coloured dash + label: Confirmed, VIP·repeat, Deposit due, Win-back, New lead); actions Sort, Filter, Open calendar.
2. **calendar** (L557–583). Toolbar: seg Day/Week/Month, "Today · Thu 8 Oct" pill, branch dropdown, New booking.
   Note: therapist + room reserved together, DB blocks double booking. Resource grid: columns = therapists (with room
   label), rows = hours; event cards `.e1–.e4` by colour, walk-in dashed, break hatched. Below: 3 stats (Booked today
   14/20 slots filled; Walk-ins rotated; Late-night after 8 pm).
3. **bookings** (L586–610). Toolbar: status seg All/Confirmed/Pending/Cancelled; Export; New booking. Table: client,
   service, therapist, when, source pill (Website/AI chat/Instagram/Walk-in/Win-back), amount, status pill
   (Confirmed/Deposit due/Pending/Checked in).
4. **inbox — Inbox & follow-ups** (L682–714). `.col-2`: left = WhatsApp queue card ("Written for you. Send from your own
   number in one tap", N ready; items: type pill Confirmation / Day-before reminder / Quiet-slot offer, recipient,
   message preview, Send + Edit) + Campaigns table (name, running/scheduled pill, reach) with New campaign; right =
   AI receptionist card (Online pill; chat transcript website/Instagram; note bookings land on calendar; stats Chats
   handled 7d (82 % no staff), Booked by AI (count + AED)).
5. **clients** (L613–631). 4 stats: Total clients (+this month), Active packages (+AED balance), Birthdays this month
   (auto-greeted), Win-back targets (lapsed 60+ days). Note: therapists never see phone numbers. Table: client
   (avatar, name, tag pill VIP/Regular/Win-back/New), masked phone, visits, lifetime spend, package/card, birthday, last
   visit, View.
6. **services — Services & menu** (L634–653). Header "Treatment menu" + sub "Open daily 10:00–22:00 · prices exclude
   5 % VAT" + Add treatment. Table: treatment, durations (60 · 90 min), prices per duration, booked 30 d, stock linked,
   Live pill. 3 "Ritual" cards (eyebrow, name, contents · duration, price).
7. **team — Team & roles** (L656–679). Note: roles list. 4 team cards: avatar, name, role, speciality pill, stats
   (bookings today, rating, commission %), document status pill (valid / visa expires in N days). `.col-2`: Roles &
   permissions matrix (Owner/Manager/Receptionist/Therapist/Accountant × Sees phone/Accounts/Settings) | Document
   expiry list (person, document, expiry date, days-left pill) + note "alerts sent to your phone".
8. **marketing** (L717–747). 4 stats: IG posts scheduled (next), New followers 30 d, Reviews synced (avg), Booking
   clicks (cookieless). `.col-2`: Instagram posts written & scheduled by AI (time, caption, Approved/Draft pill,
   Approve all) | Where bookings come from (bar chart Website/Instagram/Google/WhatsApp/Walk-in, highlight top; legend
   most-booked section, top source by revenue). Card "AI site writer" (EN/AR) with Weekly insights + Morning digest notes.
9. **website — Website studio** (L873–901). `.col-2b`: left = Your website (domain, languages, Live pill, browser-frame
   preview with hero) + Change requests (list with Done / In studio / Awaiting your photo pills; input "Describe a
   change…" + Send); right = Site at a glance (Visitors 30 d, Booking conversion) + Domain & security (domain, SSL,
   languages, Arabic site published — ✓ pills).
10. **reviews** (L750–764). 4 stats: Google rating (count), New this month, Awaiting reply (AI drafted), Reply rate
    (within 2 h). List: reviewer avatar/name, stars pill, text, either "Your reply:" box or Approve AI reply + Edit;
    status pill (Reply posted / AI reply ready).
11. **accounts** (L767–797). 4 stats: Revenue month (MoM), Expenses, Net profit (margin), VAT due (quarter).
    `.col-2`: Recent transactions table (date, description, method pill Card/Cash/Bank, amount; refunds red) + note
    "payments are recorded, never processed" | P&L bar chart (4 months) + Expenses by AI-scanned receipts (category
    bars). `.g3`: Packages (count, balance, expire overnight) · Gift cards (card visual) · Stock (% bars, auto-deducted).
12. **vat — VAT & payroll** (L800–817). `.col-2`: VAT return quarter card (due-date pill; standard-rated sales, output
    VAT, input VAT, net payable; Export FTA return) | Payroll & WPS (therapist, base, commission, total; Generate WPS SIF
    file). Note: figures recalc from posted sales/refunds/tips.
13. **billing** (L820–844). `.col-2`: subscription card (plan, AED 24,000/yr, excl. VAT, renew date, 5 feature ticks,
    Pay invoice by card, "or bank transfer or cash") | Invoices table (number, date, amount, Paid/Due) + AI usage this
    month (% pill + bar + note).
14. **automations** (L847–870). Header "Runs on its own" + "9 active" pill. `.col-2`: list of 9 automations (icon,
    name, description · schedule, toggle): confirmations & reminders, quiet-slot offers (11:00 · 16:00), Instagram
    posts, Google reviews sync (2 h), close expired packages (nightly), document expiry alerts (daily), morning digest &
    weekly insights (08:00), nightly backups, domains & SSL | Last 24 hours log (time, event, done pill) + note.
15. **settings** (L904–934). `.col-2`: Spa profile form (business name, branch, hours, currency, VAT/TRN) + Import /
    export (Import clients & menu, Export everything) | Security (2FA required for owner & managers toggle; mask client
    phones for therapists toggle; audit log On) + Audit log list (who, what, time).
16. **roadmap — Coming next** (L937–949). 2-col list of planned items (Waitlist, Merge duplicate clients, Equipment as
    bookable resource, Staff time clock & leave, Booking widget for existing sites, Reserve with Google) with "Planned"
    pill + note "everything included in your one plan".

## 6. i18n

### 6.1 In the design
- Chrome strings: `I` map of `[en, ar, th]` arrays (L400–409) applied to `[data-i]` (L410).
- Nav: `en/ar/th` per item, groups `[en, ar, th]` (L413–440).
- Page strings: inline `t(en, ar, th)` (L476) — most calls pass only EN+AR; Thai comes from the **`TH` dictionary**
  (L474, ~400 EN→TH pairs, keyed by the English sentence). `tx(arr)` (L477) picks the array index, Thai falls back to
  `TH[en]`. `aed()` (L478) prefixes "AED " (AR suffix variant to drop). `setLang` (L395) flips `lang`/`dir`.
- Demo data strings (therapist roles/specialities, service names, client tags) carry EN/AR pairs (L447–470); Thai for
  them via `TH` (e.g. "Deep Tissue · 90" → นวดกดจุดลึก).
- **Drop**: every AR column/arg, `ع` button, RTL rules and Arabic font (§1.3). Use the `TH` dictionary as the seed
  glossary for the Thai catalogue (terms: พนักงานนวด therapist, ทรีตเมนต์ treatment, การจอง booking, ดิรฮัม AED in prose).

### 6.2 i18n coverage (owner: Thai applies to EVERYTHING in the spa dashboard)
**Rule — names are never translated.** User-entered/proper names stay exactly as typed: client, staff, spa, branch,
room, service/treatment, variant, product, package, gift-card, campaign, segment, template, document names, and any
free text (notes, messages, captions). Only UI text and system messages are translated. (So the design's Thai service
names are NOT to be built; the DB `Bilingual {en, ar}` names are for the public site — dashboard shows the EN name, or
the name as entered.) Customer-facing output (WhatsApp texts, public site, receipts given to clients) keeps the spa's
customer language (EN/AR), not the staff member's dashboard language.

**Catalogue approach**
- `apps/web/src/i18n/` (or `packages/core/src/i18n` if the worker/services need it): `en.ts` = source of truth
  (typed nested keys, ICU-style `{count}` placeholders + plural rules via `Intl.PluralRules`), `th.ts` typed as
  `Messages` (missing key = type error; CI check). Small in-house `t(key, params)`; no new runtime dependency needed
  (next-intl optional). Namespaces per area: `shell`, `nav`, `common` (buttons, statuses, empty states), `calendar`,
  `clients`, `pos`, `accounts`, `errors`, `validation`, `notifications`, …
- Server components: `const t = await getT()` (reads locale from session user → cookie → `en`); client components get
  a `<I18nProvider messages locale>` from the tenant layout, only the namespaces they need.
- Formatting: one `fmt` module replacing `apps/web/src/lib/utils.ts` hard-coded `en-AE`/`en-GB` formatters (L7, 21,
  30). Thai: `th-TH-u-ca-gregory-nu-latn` (Gregorian years + Latin digits, matching the design's "2027"), currency
  stays "AED 1,234" (design keeps the "AED " prefix in TH), times 24 h, timezone Asia/Dubai, business-date rules unchanged.
- Enum/status labels (`booking_status`, `booking_source`, `sale_status`, `payment_method_kind`, `outbox_status`,
  `reply_status`, `post_status`, `payroll_status`, `gift_card_status`, `client_package_status`, `domain_status`,
  `site_studio_status`, `change_request_status`, …): translate at render via `t('enum.bookingStatus.confirmed')`;
  never store translated text. System role names (Owner/Manager/Receptionist/Therapist/Accountant + 6th) and permission
  labels/descriptions (`packages/core/src/permissions.ts` L13, L97…) become keys; custom role names stay as typed.

**Server-side messages**
- `DomainError` (`packages/services/src/errors.ts` L9; 156 throws in 18 files under `packages/services/src`) →
  add `key` + `params` (keep English `message` for logs/tests): `new DomainError('booking.slotTaken', {…}, 'slot_taken')`.
  The action layer (`lib/action.ts` / wherever `DomainError → fail` happens) translates with the caller's locale.
- `fail('…')` literals in actions: 261 calls under `apps/web/src/app/dashboard` → `fail(t('…'))` (action resolves
  locale from the session it already loads in `guard`).
- zod (v4.6): 72 inline custom messages in dashboard actions → catalogue keys; set a locale error map per request
  (`z.config(...)` with a Thai map; check whether zod 4 ships `locales.th`, else write one for the ~10 issue codes).
- Better Auth errors (login, 2FA, reset) shown on `(auth)` pages → map error codes to keys.
- Push / in-app notifications (`packages/services/src/notify.ts`, worker digest/insights/document reminders in
  `apps/worker/src/jobs/*.ts`) → build title/body from keys in the **recipient's** locale at send time.
- Staff emails (`packages/core/src/email.ts` `sendStaffEmail`: invites, password reset, 2FA) → recipient's locale
  (invitee: inviter's choice or EN until they pick).
- AI output shown to staff (weekly insights, digest, receipt-scan categories): pass the staff locale to the prompt
  where the text is for staff; content for customers (captions, review replies, WhatsApp drafts) stays EN/AR.
- Exports/reports (CSV headers, P&L/VAT export, WPS SIF): CSV headers translated? → **no** for FTA/WPS formats
  (fixed formats); yes for human reports. Decide per export.

**Per-user preference**
- Add `user.locale` (`'en' | 'th'`, default `'en'`) via Better Auth `additionalFields` (users span tenants, so not on
  `members`). Toggle in the top bar writes it (+ a `locale` cookie so login/signup/invite pages before sign-in follow
  the last choice). `<html lang>` set server-side from it (drives Noto Sans Thai).

**Checklist of string sources to convert (grep-level, no full scans)**
1. Shell/nav: `apps/web/src/app/dashboard/[tenant]/layout.tsx` (nav labels, groups, banners),
   `components/shell/{app-shell,nav,user-menu}.tsx` → new `SpaShell`.
2. Pages: `apps/web/src/app/dashboard/[tenant]/**/page.tsx`, `*-client.tsx`, `*.tsx` (JSX text, `title=`, `label=`,
   `hint=`, `placeholder=`, `aria-label=`) — grep `label="|title="|placeholder="|hint="|>[A-Z][a-z]`.
3. Actions: `dashboard/[tenant]/**/actions.ts` — grep `fail\(`, `z\.` messages, `revalidate`-adjacent success text.
4. Shared UI: `apps/web/src/components/{ui,kpis,calendar,clients,pos,messages,inbox,campaigns,documents,data,
   integrations,media,push}/` — toasts (`toast.` 119 calls under `apps/web/src`), empty states, confirm dialogs.
5. Auth & account: `dashboard/(auth)/**` (login, signup, invite, 2FA, forgot/reset) and `dashboard/account/**`.
6. Services: `packages/services/src/**` — grep `new DomainError\(` (156) and any returned label strings
   (e.g. `report.ts` in `packages/core/src`).
7. Core: `packages/core/src/permissions.ts` (permission + role labels/descriptions), `booking.ts` (slot/booking
   messages), `report.ts`, `email.ts`.
8. Worker: `apps/worker/src/jobs/{engage,tenant-jobs,campaigns,gbp,instagram,domains}.ts` — grep `title:|body:|subject:`.
9. Formatting: `apps/web/src/lib/utils.ts` (L7 `en-AE`, L21/L30 `en-GB`, L41) + any `toLocale*`/`Intl.` in
   `components/` → `fmt` module.
10. Enums: `packages/db/src/schema/*.ts` `pgEnum(` lists (≈40) → `enum.*` keys.
11. Excluded: public site/booking (`components/site`, `components/booking`, `app/site`), marketing, super-admin
    (`app/platform`), editor chrome, customer WhatsApp templates (`packages/core/src/whatsapp.ts`, DB templates).

## 7. Gap analysis vs current dashboard (`apps/web/src/app/dashboard/[tenant]/`)

| Design page | Status | Current route(s) | Missing vs design |
|---|---|---|---|
| overview | partial | `/` (page.tsx: `kpis`, `upcomingItems`, `peakHours`, revenue sparkline, insights card, setup checklist) | 5-KPI row w/ deltas + View details (total clients, occupancy, messages-to-send); weekly activity-log timeline; client journey (stage/source/service); priority bookings table w/ sort/filter |
| calendar | partial | `/calendar` (`components/calendar`: resource-grid, agenda, walk-ins, booking sheets, branch) | Week + Month views (day only today); today pill; 3 day stats; nav count badge |
| bookings | **missing** | (bookings only via calendar/agenda) | list route w/ status filter, source pills, amount, export CSV; "Deposit due" status (no deposit concept in schema) |
| inbox | partial (split) | `/messages` (+templates; WhatsApp outbox), `/inbox` (Instagram DMs, AI `dm` agent), `/campaigns` | merged page; AI receptionist on the **website** (only Instagram DMs + booking form exist); 7-day chat stats, booked-by-AI value; nav count |
| clients | partial | `/clients` (+[id], intake; tags, visits, last visit) | 4 stats (active packages+balance, birthdays this month, win-back 60 d+); lifetime spend, package/card, birthday columns; phone-mask note (perm `clients.phone` exists) |
| services | partial | `/services` (variants, consumables) | booked-30 d column, stock-linked summary, Live pill, hours/VAT subtitle; **Rituals/bundles** (no bundle model; packages ≠ bundles) |
| team | partial (split) | `/staff` (+[id]), `/team` (+roles), `/documents` | staff cards (bookings today, **rating** — no per-therapist rating source, commission %, doc status); roles matrix summary; doc-expiry days-left list |
| marketing | partial (split) | `/ai/content` (IG posts), `/campaigns` (+segments), `/analytics`, `/ai` | IG **followers** count (needs insights permission); Approve-all; sources bar chart on this page; AI site writer card; digest/insights cards |
| website | exists | `/website` (read-only studio: live link, preview, status, request change, approve) + `/media` | browser-frame preview, Site-at-a-glance stats (data in analytics), Domain & security card (data in `/settings/domains`) |
| reviews | partial | `/ai/reviews` (GBP sync, AI draft, approve, editor) | top-level route; 4 stats (rating, new, awaiting, reply rate ≤2 h) |
| accounts | partial | `/accounts` (P&L, VAT, expenses + receipt scan, journal, export) | KPI tiles; recent-transactions table w/ method pill; 4-month P&L bars; expense category bars; summary cards for packages / gift cards / stock |
| vat | exists (split) | `/accounts` VAT tab, `/payroll` (+[runId], WPS SIF) | combined page layout; due-date pill |
| billing | partial | `/billing` (invoices, Stripe pay-by-card for platform invoices) | plan card w/ features + renewal; AI usage bar (lives on `/ai`) |
| automations | **missing** | worker jobs exist (CODEMAP: slot-filler 10:30/15:30, instagram-publish, gbp-reviews-sync 2 h, packages-expire 04:10, document-reminders 09:00, daily-digest 09:30, weekly-insights Mon 08:00, db-backup 03:30, verify-custom-domains 10 min; reminders via outbox) | page; **per-tenant toggles** (`TenantSettings` has only `wps`); per-tenant run log (pg-boss history is global → tenant-scoped `job_runs` or derive from outbox/audit); backups + domain/SSL must be locked "always on" |
| settings | partial | `/settings` (branch incl. legal name/TRN, hours, intake, integrations, domains, data import/export + import history) | spa-profile card layout (currency read-only AED); **enforce 2FA for owner/managers** policy; mask-phones toggle (map to `clients.phone` on therapist/accountant roles); **audit-log viewer** (`audit_log` table exists; only import history shown) |
| roadmap | **missing** | — | static/platform-managed "Coming next" list |

**Shell features missing:** global search; notifications bell + in-app notification list (push exists, no inbox);
Ask-AI assistant (only `/ai/try` agent tester); saved-status chip; manual theme toggle (dark is prefers-color-scheme
only); language switch + whole i18n layer; plan/AI meter card; spa logo; nav counts; drawer nav on mobile.

**Top missing features (build order suggestion):** i18n EN/TH layer + `user.locale` → scoped tokens + SpaShell
(logo, profile, grouped nav, plan card, top bar) → Bookings list → Automations (toggles + log) → Overview widgets
(activity timeline, client journey, priority bookings) → Calendar week/month → audit-log viewer + 2FA policy → global
search + notifications → Ask AI → rituals/bundles, therapist ratings, deposits, website AI chat, IG followers
(need product decisions, see §8).

**Current features with no home in the design's menu** (proposed home):
- **Sales / POS** (`/sales`, `/sales/new`, `[id]`, `close` daily close, receipts) — core front-desk flow; the design has
  no POS → **add a "Sales" item to Workspace** (owner to confirm) or a "Checkout" action on bookings + "Daily close" in Accounts.
- Packages & gift cards (`/packages`) → Accounts "Packages" / "Gift cards" cards drill-down (or Services tab).
- Inventory (`/inventory`) → Accounts "Stock" card drill-down (or Services tab "Products & stock").
- Payroll runs (`/payroll/[runId]`) → VAT & payroll. Documents (`/documents`) → Team & roles.
- Media library (`/media`) → Website studio tab. Message templates (`/messages/templates`) + segments
  (`/campaigns/segments`) → Inbox & follow-ups tabs.
- Analytics (`/analytics`) → Marketing tab (or Dashboard "View details").
- AI studio (`/ai` settings: agent modes/autopilot, `/ai/try`) → Settings › AI, or Automations.
- Settings subpages (hours, intake, integrations, domains, data) → Settings tabs. Client intake → Clients.
- Account (`/account`: profile, 2FA, push) + Switch spa → profile-card menu.

## 8. Conflicts with locked rules / PLAN

1. **WhatsApp click-to-send only.** Copy implying automatic sending must change to "queued / ready to send": "Offer
   sent to 18 lapsed clients" (TH dict L474 "Gap spotted"), "Confirmation sent" (AI chat L706), "auto-greeted"
   birthdays (L617), "Quiet-slot offer → 18 clients · done" (L866), campaigns "running" (L696), "Twice a day to lapsed
   clients" (L853). Queue "Send" = per-recipient wa.me link (one tap each), never bulk/automated send.
2. **Payments recorded, never processed.** L780 is consistent. "Deposit due" (L544, L599) → deposits may only be
   recorded (no online collection); not in schema today. "Pay invoice by card" (L831) is platform SaaS billing →
   allowed by PLAN §14.3 (Stripe Checkout for platform invoices), but CLAUDE.md's locked line still says "SaaS billing
   also manual. Stripe later" → update CLAUDE.md.
3. **Website Studio = super-admin edits only.** "AI site writer — drafts your website copy" (L742) and "Swap hero
   photo" imply spa-side editing → spa may only send change requests; the AI writer card should cover campaign/social
   copy, or draft a change-request text. Change-request flow (L884–886) matches §14.4.
4. **AI model IDs in DB.** Design names none. "Ask Be Relax AI" → "Ask AI", routed through the ModelArk gateway with
   `ai_model_config`. AI usage % = spend vs `ai_budget_usd`.
5. **Pricing.** Invoice "SPA-AI-OCT AED 620 Due" (L837) implies AI overage billing, contradicting "no add-ons, ever"
   (L949) and the flat AED 24,000 plan → don't build overage invoices unless owner decides.
6. **Arabic.** Design ships AR + RTL; owner: dashboard EN+TH only. PLAN §12.2 (IBM Plex Arabic "when the dashboard gets
   AR") and §13 P4 "dashboard AR" must be updated; tenant sites stay EN+AR (unchanged).
7. **PLAN §12 design system** (warm snow + sage, radius 12, no shadow at rest, weights ≤600, phone bottom tab bar,
   sidebar collapsible to 72 px, max width 1440) is superseded for the spa dashboard only; super-admin keeps §12 →
   record as §12.x "Spa dashboard look (owner 2026-10-08)".
8. **Integrations (§8).** IG followers count needs an insights permission not in the §8 list. GBP reply posting needs
   API approval → keep manual "copy reply" fallback state. Website AI receptionist chat is a new channel (only IG DMs
   exist). "Reserve with Google" on roadmap = P4 (OK as "Planned").
9. **Automations toggles**: backups and domain/SSL checks are platform duties → shown, not switchable.
10. **Copy truthfulness (§14.3)**: demo numbers/claims ("82 % with no staff", "sent to your phone at 8:00") must come
    from real data/schedules (digest runs 09:30, slot-filler 10:30/15:30, not 08:00/11:00/16:00).
11. Phone masking statement (L620) vs settings toggle (L926) — consistent with `clients.phone` permission.
12. Sample links (`belax.ae/book`, `berelaxspa.ae`) → `publicSiteUrl` / `canonicalUrls()`.
13. "Prices exclude 5 % VAT" (L635) — confirm against how service prices are stored (VAT-inclusive vs exclusive).

## 9. Spa logo
- `packages/db/src/schema/platform.ts` `tenants` (L107–134): `slug, name, legalName, trn, status, planId,
  defaultLocale, timezone, aiBudgetUsd, settings (TenantSettings = { wps? } L103–105)` — **no logo field**.
- `packages/db/src/schema/site.ts` `sites.theme` (L55): free-form `ThemeTokens = Record<string, string|number>` jsonb,
  default `{}` — no typed logo key; `grep -i logo packages/db/src/schema` = 0 hits.
- Onboarding captures **no logo**: signup (`dashboard/(auth)/signup/actions.ts` L14–21) = businessName, slug, name,
  email, password; `provisionTenant` (`server/provision.ts` L22–72) inserts tenant (slug, name, planId, status), default
  branch, roles, owner member, subscription.
- Needed: `tenants.logo_file_id` (→ `files`, public URL via `canonicalUrls()`), upload in Settings › Spa profile and an
  optional onboarding step (setup checklist on Home); the studio may reuse it for the site header. Fallback = initials
  monogram on `--accent-grad`.
