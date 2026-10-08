# Spamanagement.co — Website design 01 · Mint Cloud

Implementation guide for the marketing website. `01-mint-cloud.html` is the complete working page; everything below is copied from it, so a developer can rebuild it piece by piece on the real site.

## 1. Summary
| | |
|---|---|
| Purpose | Marketing website that presents Spamanagement.co to spa owners and collects demo requests |
| Colours | White with deep navy and mint green |
| Hero sentence | **Run your spa from one place.** |
| Hero layout | Split layout: the sentence on the left; a live-looking dashboard on the right, tilted in 3D, with three floating notification cards (new booking, WhatsApp confirmation, revenue). |
| Hero motion | The dashboard straightens from its 3D tilt as you scroll and follows the mouse; the cards float and drift upward. |
| Product tour | Tabs: six tabs on the left (Dashboard, Bookings, Store & POS, HR & staff, Accounting, Social media) switch the app screen on the right. They move on by themselves every 5 seconds with a progress line, pausing while the mouse is over them. Clicking a tab works even without JavaScript. |
| Background | Soft mint, sky and peach light drifting slowly behind the whole page. |
| Sections entering | Cards rise up from below with a soft 3D tilt., linked to scrolling (reverses when scrolling back up) |
| Top bar | Slides away when scrolling down and comes back when scrolling up (fades away when scrolling down where JavaScript is blocked) |
| Languages / modes | English and Arabic (full right-to-left) · light and dark |
| Phone | Same content and motion; layouts stack into one column |

## 2. Page structure (in order)
1. **Top bar:** logo, Modules, Product tour, How it works, Plans, FAQ, language (ع / EN), light/dark, "Book a demo".
2. **Hero** (above).
3. **Strip:** "Made for day spas, massage centers, hammams and beauty lounges" plus the six module names with icons.
4. **Modules:** six cards, one per module:
   - Bookings & calendar
   - Spa management
   - Store & POS
   - HR & staff
   - Accounting
   - Social media
5. **Product tour** (above).
6. **Why spas choose it:** six benefits:
   - WhatsApp reminders
   - Arabic & English
   - VAT-ready invoices
   - Multi-branch
   - Roles & permissions
   - Any device
7. **How it works:** 1 Book a demo → 2 We set it up → 3 Go live.
8. **Plans:** Essential, Professional ("Most popular") and Multi-branch, each with a feature list and a **Request pricing** button. No prices are shown.
9. **FAQ:** five questions. These use plain HTML `<details>`, so they open and close without JavaScript.
10. **Free demo form:** name, spa name, phone/WhatsApp, email, number of branches, modules wanted. It opens WhatsApp (or an email) with the request already written. If the visitor came from a plan button, the plan is included.
11. **Footer** and a floating WhatsApp button.

## 3. Fonts
```html
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">
```

## 4. Colours
| Role | Variable | Light | Dark |
|---|---|---|---|
| Page background | `--bg` | `#F7FAFA` | `#0B1520` |
| Cards | `--surface` | `#FFFFFF` | `#111E2B` |
| Main text | `--text` | `#0E1B2C` | `#E6EEF3` |
| Secondary text | `--muted` | `#5A6B7B` | `#98A9B8` |
| Buttons / accent | `--accent` | `#13836A` | `#2BC79B` |
| Accent text | `--accent-ink` | `#0F7A62` | `#5FDAB5` |
| Text on buttons | `--on-accent` | `#FFFFFF` | `#06231B` |
| Second accent | `--accent2` | `#9EE6CF` | `#9EE6CF` |

The `--ui-*` variables colour the app screens inside the page; `--demo-bg` / `--demo-text` colour the demo section.

```css
:root{--bg:#F7FAFA;--bg2:#EEF5F4;--surface:#FFFFFF;--text:#0E1B2C;--muted:#5A6B7B;--accent:#13836A;--accent-ink:#0F7A62;--on-accent:#FFFFFF;--accent2:#9EE6CF;--line:rgba(14,27,44,.08);--line2:rgba(14,27,44,.15);--glow:rgba(19,131,106,.30);--head:"Plus Jakarta Sans",sans-serif;--font:"Inter",sans-serif;--ui-bg:#F3F6F8;--ui-bar:#FFFFFF;--ui-side:#0E1B2C;--ui-side-ic:#8EA0B3;--ui-card:#FFFFFF;--ui-line:rgba(14,27,44,.08);--ui-text:#0E1B2C;--ui-muted:#6B7A8A;--demo-bg:#0E1B2C;--demo-text:#EAF2F1;--t1:#BFEFE0;--t2:#D7F0FF;--t3:#FCE7D2;}[data-theme="dark"]{--bg:#0B1520;--bg2:#0F1C29;--surface:#111E2B;--text:#E6EEF3;--muted:#98A9B8;--accent:#2BC79B;--accent-ink:#5FDAB5;--on-accent:#06231B;--accent2:#9EE6CF;--line:rgba(230,238,243,.08);--line2:rgba(230,238,243,.15);--glow:rgba(43,199,155,.22);--ui-bg:#0F1A26;--ui-bar:#132131;--ui-side:#08111A;--ui-side-ic:#6F8396;--ui-card:#142333;--ui-line:rgba(230,238,243,.07);--ui-text:#E6EEF3;--ui-muted:#8FA1B2;--demo-bg:#13836A;--demo-text:#F2FBF8;--t1:#0F3B33;--t2:#13283C;--t3:#2A2420;}
```

## 5. Hero
```html
<header class="hero"><div class="wrap hgrid"><div class="hcopy"><span class="ey fin"><span data-i18n="hero.ey">Spa & wellness management software</span></span><h1 class="h1 fin d1"><span data-i18n="ha.l1">Run your spa</span> <em data-i18n="ha.l2">from one place.</em></h1><p class="hsub fin d2" data-i18n="hero.sub">Bookings, staff, store, accounting and social media — in one simple system made for spas and massage centers.</p><div class="ctas fin d3"><a href="#demo" class="btn btn-a"><span data-i18n="cta.demo">Book a free demo</span><svg class="fl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a><a href="#tour" class="btn btn-o"><span data-i18n="cta.tour">See how it works</span></a></div><div class="hnotes fin d4"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span data-i18n="hero.n1">Arabic & English</span></span><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span data-i18n="hero.n2">Works on any device</span></span><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span data-i18n="hero.n3">Setup help included</span></span></div></div><div class="hstage fin d2"><div class="htilt" id="htilt"><div class="uiw"><div class="ui"><div class="ui-top"><b></b><b></b><b></b><span class="ui-url">app.spamanagement.co</span><span class="ui-smp"><span data-i18n="u.sample">Sample data</span></span></div><div class="ui-body"><nav class="ui-side"><span class="ui-logo"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)"/><path d="M16 25c-5 0-8.5-3.2-8.5-7.6 3.4 0 6.6 1.6 8.5 4.3 1.9-2.7 5.1-4.3 8.5-4.3 0 4.4-3.5 7.6-8.5 7.6z" fill="var(--on-accent)"/><path d="M16 21.6c-2.2-2.7-2.7-6.5 0-10.8 2.7 4.3 2.2 8.1 0 10.8z" fill="var(--on-accent)" opacity=".75"/></svg></span><i class="on"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13.5h3v3h-3z"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 12.5H6z"/><path d="M9 8V6.5a3 3 0 016 0V8"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.8.2 5 2 5 5"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1"/></svg></i></nav><div class="ui-main"><div class="ui-h"><span data-i18n="u.dash">Dashboard</span><span class="ui-av"></span></div><div class="k3"><div class="kp"><small><span data-i18n="u.bk">Bookings today</span></small><b>24</b><em>+4</em></div><div class="kp"><small><span data-i18n="u.rev">Revenue today</span></small><b>AED 8,450</b><em>+12%</em></div><div class="kp"><small><span data-i18n="u.rooms">Rooms in use</span></small><b>6 / 8</b><em class="n">75%</em></div></div><div class="g2"><div class="card"><small><span data-i18n="u.week">This week</span></small><div class="bars"><i style="--h:46%"><span>M</span></i><i style="--h:62%"><span>T</span></i><i style="--h:55%"><span>W</span></i><i style="--h:78%"><span>T</span></i><i style="--h:92%"><span>F</span></i><i style="--h:100%"><span>S</span></i><i style="--h:70%"><span>S</span></i></div></div><div class="card"><small><span data-i18n="u.next">Next appointments</span></small><div class="ap"><b>14:00</b><span><span data-i18n="u.hot">Hot stone · 90 min</span></span><em style="--c:#2BB58C"></em></div><div class="ap"><b>14:30</b><span><span data-i18n="u.ham">Moroccan hammam</span></span><em style="--c:#E2A86B"></em></div><div class="ap"><b>15:00</b><span><span data-i18n="u.fac">Signature facial</span></span><em style="--c:#7C8CF8"></em></div><div class="ap"><b>15:30</b><span><span data-i18n="u.sw">Swedish · 60 min</span></span><em style="--c:#E07A9B"></em></div></div></div></div></div></div></div></div><div class="note n1" style=""><span class="ni"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13.5h3v3h-3z"/></svg></span><div><b data-i18n="n.bk">New booking</b><small data-i18n="n.bkd">Hot stone · Today 14:00</small></div></div><div class="note wa n2" style=""><span class="ni"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8.5 8.5 0 01-12.6 7.4L3 21l1.6-5.2A8.5 8.5 0 1121 12z"/></svg></span><div><b data-i18n="n.wa">Confirmed on WhatsApp</b><small data-i18n="n.wad">Reminder sent to client</small></div></div><div class="note n3" style=""><span class="ni"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></span><div><b data-i18n="n.rev">Revenue today</b><small data-i18n="n.revd">AED 8,450 · +12%</small></div></div></div></div></header>
```

## 6. Product tour
```html
<section class="sec" id="tour"><div class="wrap"><div class="shead"><span class="ey" data-i18n="tour.ey">Product tour</span><h2 class="h2"><span data-i18n="tour.h1">See your spa</span> <em data-i18n="tour.h2">at a glance.</em></h2><p class="lead" data-i18n="tour.lead">Every screen is built for busy front desks: big buttons, clear colours and no clutter.</p></div><div class="tt"><input type="radio" name="tt" id="tt0" class="tt-r" checked><input type="radio" name="tt" id="tt1" class="tt-r"><input type="radio" name="tt" id="tt2" class="tt-r"><input type="radio" name="tt" id="tt3" class="tt-r"><input type="radio" name="tt" id="tt4" class="tt-r"><input type="radio" name="tt" id="tt5" class="tt-r"><div class="tt-ls"><label for="tt0" class="tt-l"><b data-i18n="t0">Dashboard</b><span data-i18n="t0.d">Today's bookings, revenue and room use the moment you log in.</span><i class="tt-p"></i></label><label for="tt1" class="tt-l"><b data-i18n="t1">Bookings</b><span data-i18n="t1.d">Drag-and-drop calendar for every therapist and room.</span><i class="tt-p"></i></label><label for="tt2" class="tt-l"><b data-i18n="t2">Store & POS</b><span data-i18n="t2.d">Quick checkout for treatments, products and gift cards.</span><i class="tt-p"></i></label><label for="tt3" class="tt-l"><b data-i18n="t3">HR & staff</b><span data-i18n="t3.d">Who is on shift, who is on leave, and what each person earned.</span><i class="tt-p"></i></label><label for="tt4" class="tt-l"><b data-i18n="t4">Accounting</b><span data-i18n="t4.d">Invoices, expenses and VAT totals, always up to date.</span><i class="tt-p"></i></label><label for="tt5" class="tt-l"><b data-i18n="t5">Social media</b><span data-i18n="t5.d">Plan posts for the week and answer every message from one inbox.</span><i class="tt-p"></i></label></div><div class="tt-st"><div class="tt-s uiw"><div class="ui"><div class="ui-top"><b></b><b></b><b></b><span class="ui-url">app.spamanagement.co</span><span class="ui-smp"><span data-i18n="u.sample">Sample data</span></span></div><div class="ui-body"><nav class="ui-side"><span class="ui-logo"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)"/><path d="M16 25c-5 0-8.5-3.2-8.5-7.6 3.4 0 6.6 1.6 8.5 4.3 1.9-2.7 5.1-4.3 8.5-4.3 0 4.4-3.5 7.6-8.5 7.6z" fill="var(--on-accent)"/><path d="M16 21.6c-2.2-2.7-2.7-6.5 0-10.8 2.7 4.3 2.2 8.1 0 10.8z" fill="var(--on-accent)" opacity=".75"/></svg></span><i class="on"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13.5h3v3h-3z"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 12.5H6z"/><path d="M9 8V6.5a3 3 0 016 0V8"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.8.2 5 2 5 5"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1"/></svg></i></nav><div class="ui-main"><div class="ui-h"><span data-i18n="u.dash">Dashboard</span><span class="ui-av"></span></div><div class="k3"><div class="kp"><small><span data-i18n="u.bk">Bookings today</span></small><b>24</b><em>+4</em></div><div class="kp"><small><span data-i18n="u.rev">Revenue today</span></small><b>AED 8,450</b><em>+12%</em></div><div class="kp"><small><span data-i18n="u.rooms">Rooms in use</span></small><b>6 / 8</b><em class="n">75%</em></div></div><div class="g2"><div class="card"><small><span data-i18n="u.week">This week</span></small><div class="bars"><i style="--h:46%"><span>M</span></i><i style="--h:62%"><span>T</span></i><i style="--h:55%"><span>W</span></i><i style="--h:78%"><span>T</span></i><i style="--h:92%"><span>F</span></i><i style="--h:100%"><span>S</span></i><i style="--h:70%"><span>S</span></i></div></div><div class="card"><small><span data-i18n="u.next">Next appointments</span></small><div class="ap"><b>14:00</b><span><span data-i18n="u.hot">Hot stone · 90 min</span></span><em style="--c:#2BB58C"></em></div><div class="ap"><b>14:30</b><span><span data-i18n="u.ham">Moroccan hammam</span></span><em style="--c:#E2A86B"></em></div><div class="ap"><b>15:00</b><span><span data-i18n="u.fac">Signature facial</span></span><em style="--c:#7C8CF8"></em></div><div class="ap"><b>15:30</b><span><span data-i18n="u.sw">Swedish · 60 min</span></span><em style="--c:#E07A9B"></em></div></div></div></div></div></div></div><div class="tt-s uiw"><div class="ui"><div class="ui-top"><b></b><b></b><b></b><span class="ui-url">app.spamanagement.co</span><span class="ui-smp"><span data-i18n="u.sample">Sample data</span></span></div><div class="ui-body"><nav class="ui-side"><span class="ui-logo"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)"/><path d="M16 25c-5 0-8.5-3.2-8.5-7.6 3.4 0 6.6 1.6 8.5 4.3 1.9-2.7 5.1-4.3 8.5-4.3 0 4.4-3.5 7.6-8.5 7.6z" fill="var(--on-accent)"/><path d="M16 21.6c-2.2-2.7-2.7-6.5 0-10.8 2.7 4.3 2.2 8.1 0 10.8z" fill="var(--on-accent)" opacity=".75"/></svg></span><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></i><i class="on"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13.5h3v3h-3z"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 12.5H6z"/><path d="M9 8V6.5a3 3 0 016 0V8"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.8.2 5 2 5 5"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1"/></svg></i></nav><div class="ui-main"><div class="ui-h"><span data-i18n="u.cal">Calendar</span><span class="ui-av"></span></div><div class="calw"><div class="cal-h"><span></span><span><i class="av" style="--c:#2BB58C">S</i>Sara</span><span><i class="av" style="--c:#E2A86B">L</i>Layla</span><span><i class="av" style="--c:#7C8CF8">M</i>Mira</span><span><i class="av" style="--c:#E07A9B">N</i>Nadia</span><span><i class="av" style="--c:#5BB7D5">H</i>Hana</span></div><div class="cal-g"><div class="cal-t"><span>10:00</span><span>11:00</span><span>12:00</span><span>13:00</span><span>14:00</span><span>15:00</span></div><div class="cal-c"><div class="ev" style="--t:0;--l:2;--c:#2BB58C"><span data-i18n="u.hot">Hot stone · 90 min</span></div><div class="ev" style="--t:3;--l:1.5;--c:#7C8CF8"><span data-i18n="u.sw">Swedish · 60 min</span></div></div><div class="cal-c"><div class="ev" style="--t:1;--l:2;--c:#E2A86B"><span data-i18n="u.ham">Moroccan hammam</span></div><div class="ev" style="--t:3.5;--l:1.5;--c:#7C8CF8"><span data-i18n="u.sw">Swedish · 60 min</span></div></div><div class="cal-c"><div class="ev" style="--t:0;--l:1;--c:#E07A9B"><span data-i18n="u.fac">Signature facial</span></div><div class="ev" style="--t:2;--l:2.5;--c:#2BB58C"><span data-i18n="u.cpl">Couples massage</span></div></div><div class="cal-c"><div class="ev" style="--t:1.5;--l:1.5;--c:#7C8CF8"><span data-i18n="u.dt">Deep tissue</span></div></div><div class="cal-c"><div class="ev" style="--t:0.5;--l:2;--c:#E2A86B"><span data-i18n="u.sw">Swedish · 60 min</span></div><div class="ev" style="--t:3;--l:1.5;--c:#E07A9B"><span data-i18n="u.fac">Signature facial</span></div></div></div></div></div></div></div></div><div class="tt-s uiw"><div class="ui"><div class="ui-top"><b></b><b></b><b></b><span class="ui-url">app.spamanagement.co</span><span class="ui-smp"><span data-i18n="u.sample">Sample data</span></span></div><div class="ui-body"><nav class="ui-side"><span class="ui-logo"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)"/><path d="M16 25c-5 0-8.5-3.2-8.5-7.6 3.4 0 6.6 1.6 8.5 4.3 1.9-2.7 5.1-4.3 8.5-4.3 0 4.4-3.5 7.6-8.5 7.6z" fill="var(--on-accent)"/><path d="M16 21.6c-2.2-2.7-2.7-6.5 0-10.8 2.7 4.3 2.2 8.1 0 10.8z" fill="var(--on-accent)" opacity=".75"/></svg></span><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13.5h3v3h-3z"/></svg></i><i class="on"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 12.5H6z"/><path d="M9 8V6.5a3 3 0 016 0V8"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.8.2 5 2 5 5"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1"/></svg></i></nav><div class="ui-main"><div class="ui-h"><span data-i18n="u.store">Store</span><span class="ui-av"></span></div><div class="pos"><div class="pg"><div class="pi"><i style="--c:#E2A86B"></i><span><span data-i18n="u.oil">Argan oil</span></span><b>AED 95</b></div><div class="pi"><i style="--c:#2BB58C"></i><span><span data-i18n="u.scrub">Body scrub</span></span><b>AED 120</b></div><div class="pi"><i style="--c:#E07A9B"></i><span><span data-i18n="u.candle">Spa candle</span></span><b>AED 75</b></div><div class="pi"><i style="--c:#7C8CF8"></i><span><span data-i18n="u.gift">Gift card</span></span><b>AED 500</b></div><div class="pi"><i style="--c:#5BB7D5"></i><span><span data-i18n="u.hot">Hot stone · 90 min</span></span><b>AED 420</b></div><div class="pi"><i style="--c:#C9A27A"></i><span><span data-i18n="u.ham">Moroccan hammam</span></span><b>AED 350</b></div></div><div class="cart"><small><span data-i18n="u.cart">Current sale</span></small><div class="cl"><span><span data-i18n="u.hot">Hot stone · 90 min</span></span><b>420</b></div><div class="cl"><span><span data-i18n="u.oil">Argan oil</span></span><b>95</b></div><div class="cl"><span><span data-i18n="u.gift">Gift card</span></span><b>500</b></div><div class="ct"><span><span data-i18n="u.total">Total</span></span><b>AED 1,015</b></div><span class="pay"><span data-i18n="u.charge">Charge</span></span></div></div></div></div></div></div><div class="tt-s uiw"><div class="ui"><div class="ui-top"><b></b><b></b><b></b><span class="ui-url">app.spamanagement.co</span><span class="ui-smp"><span data-i18n="u.sample">Sample data</span></span></div><div class="ui-body"><nav class="ui-side"><span class="ui-logo"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)"/><path d="M16 25c-5 0-8.5-3.2-8.5-7.6 3.4 0 6.6 1.6 8.5 4.3 1.9-2.7 5.1-4.3 8.5-4.3 0 4.4-3.5 7.6-8.5 7.6z" fill="var(--on-accent)"/><path d="M16 21.6c-2.2-2.7-2.7-6.5 0-10.8 2.7 4.3 2.2 8.1 0 10.8z" fill="var(--on-accent)" opacity=".75"/></svg></span><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13.5h3v3h-3z"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 12.5H6z"/><path d="M9 8V6.5a3 3 0 016 0V8"/></svg></i><i class="on"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.8.2 5 2 5 5"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1"/></svg></i></nav><div class="ui-main"><div class="ui-h"><span data-i18n="u.staff">Staff</span><span class="ui-av"></span></div><div class="card tb"><div class="tr"><i class="av" style="--c:#2BB58C">S</i><b>Sara</b><span><span data-i18n="u.th">Therapist</span></span><span class="mono">10:00–18:00</span><em class="st on"><span data-i18n="u.on">On shift</span></em><span class="mono">AED 1,240</span></div><div class="tr"><i class="av" style="--c:#E2A86B">L</i><b>Layla</b><span><span data-i18n="u.th">Therapist</span></span><span class="mono">12:00–20:00</span><em class="st on"><span data-i18n="u.on">On shift</span></em><span class="mono">AED 1,105</span></div><div class="tr"><i class="av" style="--c:#7C8CF8">M</i><b>Mira</b><span><span data-i18n="u.th">Therapist</span></span><span class="mono">—</span><em class="st off"><span data-i18n="u.off">Day off</span></em><span class="mono">AED 980</span></div><div class="tr"><i class="av" style="--c:#E07A9B">N</i><b>Nadia</b><span><span data-i18n="u.th">Therapist</span></span><span class="mono">14:00–22:00</span><em class="st on"><span data-i18n="u.on">On shift</span></em><span class="mono">AED 1,320</span></div><div class="tr"><i class="av" style="--c:#5BB7D5">H</i><b>Hana</b><span><span data-i18n="u.th">Therapist</span></span><span class="mono">—</span><em class="st leave"><span data-i18n="u.leave">On leave</span></em><span class="mono">AED 760</span></div><div class="tr"><i class="av" style="--c:#C9A27A">O</i><b>Omar</b><span><span data-i18n="u.rec">Receptionist</span></span><span class="mono">09:00–17:00</span><em class="st on"><span data-i18n="u.on">On shift</span></em><span class="mono">AED —</span></div></div></div></div></div></div><div class="tt-s uiw"><div class="ui"><div class="ui-top"><b></b><b></b><b></b><span class="ui-url">app.spamanagement.co</span><span class="ui-smp"><span data-i18n="u.sample">Sample data</span></span></div><div class="ui-body"><nav class="ui-side"><span class="ui-logo"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)"/><path d="M16 25c-5 0-8.5-3.2-8.5-7.6 3.4 0 6.6 1.6 8.5 4.3 1.9-2.7 5.1-4.3 8.5-4.3 0 4.4-3.5 7.6-8.5 7.6z" fill="var(--on-accent)"/><path d="M16 21.6c-2.2-2.7-2.7-6.5 0-10.8 2.7 4.3 2.2 8.1 0 10.8z" fill="var(--on-accent)" opacity=".75"/></svg></span><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13.5h3v3h-3z"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 12.5H6z"/><path d="M9 8V6.5a3 3 0 016 0V8"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.8.2 5 2 5 5"/></svg></i><i class="on"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1"/></svg></i></nav><div class="ui-main"><div class="ui-h"><span data-i18n="u.inv">Invoices</span><span class="ui-av"></span></div><div class="g2 acc"><div class="card tb"><div class="tr"><b class="mono">INV-1048</b><span><span data-i18n="u.cpl">Couples massage</span></span><span class="mono">AED 840</span><em class="st paid"><span data-i18n="u.paid">Paid</span></em></div><div class="tr"><b class="mono">INV-1047</b><span><span data-i18n="u.hot">Hot stone · 90 min</span></span><span class="mono">AED 420</span><em class="st paid"><span data-i18n="u.paid">Paid</span></em></div><div class="tr"><b class="mono">INV-1046</b><span><span data-i18n="u.gift">Gift card</span></span><span class="mono">AED 500</span><em class="st due"><span data-i18n="u.due">Due</span></em></div><div class="tr"><b class="mono">INV-1045</b><span><span data-i18n="u.ham">Moroccan hammam</span></span><span class="mono">AED 350</span><em class="st paid"><span data-i18n="u.paid">Paid</span></em></div><div class="tr"><b class="mono">INV-1044</b><span><span data-i18n="u.fac">Signature facial</span></span><span class="mono">AED 390</span><em class="st paid"><span data-i18n="u.paid">Paid</span></em></div></div><div class="card"><small><span data-i18n="u.vat">VAT this month</span></small><b class="big">AED 6,214</b><svg class="ln" viewBox="0 0 100 40" preserveAspectRatio="none"><polyline points="0,32 14,28 28,30 42,20 56,22 70,12 84,14 100,6" fill="none" stroke="var(--accent)" stroke-width="2.2" vector-effect="non-scaling-stroke"/><polygon points="0,32 14,28 28,30 42,20 56,22 70,12 84,14 100,6 100,40 0,40" fill="var(--accent)" opacity=".12"/></svg></div></div></div></div></div></div><div class="tt-s uiw"><div class="ui"><div class="ui-top"><b></b><b></b><b></b><span class="ui-url">app.spamanagement.co</span><span class="ui-smp"><span data-i18n="u.sample">Sample data</span></span></div><div class="ui-body"><nav class="ui-side"><span class="ui-logo"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)"/><path d="M16 25c-5 0-8.5-3.2-8.5-7.6 3.4 0 6.6 1.6 8.5 4.3 1.9-2.7 5.1-4.3 8.5-4.3 0 4.4-3.5 7.6-8.5 7.6z" fill="var(--on-accent)"/><path d="M16 21.6c-2.2-2.7-2.7-6.5 0-10.8 2.7 4.3 2.2 8.1 0 10.8z" fill="var(--on-accent)" opacity=".75"/></svg></span><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13.5h3v3h-3z"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 12.5H6z"/><path d="M9 8V6.5a3 3 0 016 0V8"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.8.2 5 2 5 5"/></svg></i><i class=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg></i><i class="on"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1"/></svg></i></nav><div class="ui-main"><div class="ui-h"><span data-i18n="u.posts">Scheduled posts</span><span class="ui-av"></span></div><div class="g2 soc"><div class="card"><small><span data-i18n="u.posts">Scheduled posts</span></small><div class="wk"><div><span>Mon</span><i style="--a:#E2A86B;--b:#F6D7B0"></i></div><div><span>Tue</span></div><div><span>Wed</span><i style="--a:#2BB58C;--b:#BDEBDD"></i></div><div><span>Thu</span><i style="--a:#7C8CF8;--b:#D9DEFF"></i></div><div><span>Fri</span><i style="--a:#E07A9B;--b:#F8D2DE"></i></div><div><span>Sat</span></div><div><span>Sun</span><i style="--a:#5BB7D5;--b:#CDEBF5"></i></div></div><div class="sch"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1"/></svg><span>Instagram · Fri 19:00</span><em><span data-i18n="u.sched">Scheduled</span></em></div></div><div class="card"><small><span data-i18n="u.inbox">Inbox</span></small><div class="msg"><i class="av" style="--c:#E07A9B">A</i><div><b>Aisha</b><span><span data-i18n="u.msg1">Hi! Any slot for 2 people tonight?</span></span></div><em>WA</em></div><div class="msg"><i class="av" style="--c:#7C8CF8">D</i><div><b>Dana</b><span><span data-i18n="u.msg2">Do you have hammam on Friday?</span></span></div><em>IG</em></div></div></div></div></div></div></div></div></div></div></section>
```

## 7. Design-specific CSS (hero, background, tour)
```css
.h1{font-size:clamp(36px,3.9vw,56px);font-weight:700}
.h1 em{font-style:normal;display:block;color:var(--accent-ink)}
.hsub{font-size:clamp(16px,1.5vw,19px);color:var(--muted);max-width:540px;margin-top:20px}
.ctas{display:flex;gap:12px;flex-wrap:wrap;margin-top:30px}
.hnotes{display:flex;gap:10px 22px;flex-wrap:wrap;margin-top:26px;font-size:14px;color:var(--muted)}
.hnotes span{display:flex;align-items:center;gap:7px}.hnotes svg{width:16px;height:16px;color:var(--accent-ink)}
.strip{padding:30px 0;border-block:1px solid var(--line);background:color-mix(in srgb,var(--surface) 60%,transparent)}
.strip p{text-align:center;color:var(--muted);font-size:14px;margin-bottom:16px}
.strip-i{display:flex;justify-content:center;flex-wrap:wrap;gap:12px 30px}
.strip-i span{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14.5px}.strip-i svg{width:20px;height:20px;color:var(--accent-ink)}
@media (max-width:640px){.ctas .btn{width:100%}}

.tt{display:grid;grid-template-columns:.75fr 1.25fr;gap:34px;margin-top:54px;align-items:center}
.tt-r{position:absolute;opacity:0;pointer-events:none}
.tt-ls{display:grid;gap:8px}
.tt-l{position:relative;display:block;padding:16px 20px;border-radius:16px;cursor:pointer;border:1px solid transparent;transition:background .3s,border-color .3s;overflow:hidden}
.tt-l b{display:block;font-size:17px}.tt-l span{display:block;color:var(--muted);font-size:14px;max-height:0;overflow:hidden;transition:max-height .4s,margin .4s}
.tt-l .tt-p{position:absolute;left:0;bottom:0;height:2px;width:100%;background:var(--accent);transform:scaleX(0);transform-origin:0 50%}
html[dir="rtl"] .tt-l .tt-p{transform-origin:100% 50%}
.tt-st{display:grid;perspective:1400px}
.tt-s{grid-area:1/1;opacity:0;transform:translateY(20px) rotateX(8deg);transition:opacity .6s,transform .8s cubic-bezier(.2,.7,.2,1);pointer-events:none}
#tt0:checked~.tt-ls .tt-l[for=tt0]{background:var(--surface);border-color:var(--line);box-shadow:0 14px 30px -18px var(--glow)}#tt0:checked~.tt-ls .tt-l[for=tt0] span{max-height:80px;margin-top:6px}#tt0:checked~.tt-st .tt-s:nth-child(1){opacity:1;transform:none;pointer-events:auto}
#tt1:checked~.tt-ls .tt-l[for=tt1]{background:var(--surface);border-color:var(--line);box-shadow:0 14px 30px -18px var(--glow)}#tt1:checked~.tt-ls .tt-l[for=tt1] span{max-height:80px;margin-top:6px}#tt1:checked~.tt-st .tt-s:nth-child(2){opacity:1;transform:none;pointer-events:auto}
#tt2:checked~.tt-ls .tt-l[for=tt2]{background:var(--surface);border-color:var(--line);box-shadow:0 14px 30px -18px var(--glow)}#tt2:checked~.tt-ls .tt-l[for=tt2] span{max-height:80px;margin-top:6px}#tt2:checked~.tt-st .tt-s:nth-child(3){opacity:1;transform:none;pointer-events:auto}
#tt3:checked~.tt-ls .tt-l[for=tt3]{background:var(--surface);border-color:var(--line);box-shadow:0 14px 30px -18px var(--glow)}#tt3:checked~.tt-ls .tt-l[for=tt3] span{max-height:80px;margin-top:6px}#tt3:checked~.tt-st .tt-s:nth-child(4){opacity:1;transform:none;pointer-events:auto}
#tt4:checked~.tt-ls .tt-l[for=tt4]{background:var(--surface);border-color:var(--line);box-shadow:0 14px 30px -18px var(--glow)}#tt4:checked~.tt-ls .tt-l[for=tt4] span{max-height:80px;margin-top:6px}#tt4:checked~.tt-st .tt-s:nth-child(5){opacity:1;transform:none;pointer-events:auto}
#tt5:checked~.tt-ls .tt-l[for=tt5]{background:var(--surface);border-color:var(--line);box-shadow:0 14px 30px -18px var(--glow)}#tt5:checked~.tt-ls .tt-l[for=tt5] span{max-height:80px;margin-top:6px}#tt5:checked~.tt-st .tt-s:nth-child(6){opacity:1;transform:none;pointer-events:auto}

@media (max-width:980px){.tt{grid-template-columns:1fr}.tt-ls{display:flex;overflow-x:auto;gap:8px;scrollbar-width:none;order:0}.tt-ls::-webkit-scrollbar{display:none}.tt-l{flex:none;padding:10px 16px;border:1px solid var(--line)}.tt-l b{font-size:14px;white-space:nowrap}.tt-l span{display:none}.tt-st{order:1}}

#calm{position:fixed;inset:0;width:100vw;height:100lvh;z-index:0;pointer-events:none}
main,footer{position:relative;z-index:1}
.hero{min-height:100svh;display:flex;align-items:center;padding:120px 0 70px;position:relative}
.hgrid{display:grid;grid-template-columns:.85fr 1.15fr;gap:48px;align-items:center}
.hstage{position:relative;perspective:1600px}
.htilt{transform-style:preserve-3d;transform:rotateX(14deg) rotateY(-18deg) rotateZ(2deg);will-change:transform}
html[dir="rtl"] .htilt{transform:rotateX(14deg) rotateY(18deg) rotateZ(-2deg)}
.hstage .note.n1{top:-4%;inset-inline-start:-6%}.hstage .note.n2{bottom:8%;inset-inline-start:-10%}.hstage .note.n3{top:18%;inset-inline-end:-6%}
@media (max-width:980px){.hgrid{grid-template-columns:1fr;text-align:center}.hsub{margin-inline:auto}.ctas,.hnotes{justify-content:center}.hstage{margin-top:30px}.hstage .note.n1{inset-inline-start:0}.hstage .note.n2{inset-inline-start:0}.hstage .note.n3{inset-inline-end:0}}
@media (max-width:640px){.hstage .note.n3{display:none}.hstage .note.n1{top:-10%}.hstage .note.n2{bottom:-4%}}
```

## 8. Shared CSS (layout, sections, buttons, forms, top bar)
```css
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
html,body{overflow-x:clip}
body{background:var(--bg);color:var(--text);font-family:var(--font);line-height:1.6;transition:background .4s,color .4s}
a{color:inherit;text-decoration:none}button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
svg{display:block}
html[dir="rtl"]{--font:"IBM Plex Sans Arabic",sans-serif;--head:"IBM Plex Sans Arabic",sans-serif}
.wrap{max-width:1200px;margin:0 auto;padding:0 20px}
h1,h2,h3{font-family:var(--head);letter-spacing:-.02em;line-height:1.08}
html[dir="rtl"] h1,html[dir="rtl"] h2,html[dir="rtl"] h3{letter-spacing:0;line-height:1.3}
/* nav */
.nav{position:fixed;inset:0 0 auto;z-index:60;background:color-mix(in srgb,var(--bg) 78%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid transparent;transition:transform .5s cubic-bezier(.2,.7,.2,1),opacity .4s,border-color .3s}
.nav.scrolled{border-color:var(--line)}
.nav.hide{transform:translateY(-105%);opacity:0}
@supports (animation-timeline:scroll()){html:not(.js) .nav{animation:navaway linear both;animation-timeline:scroll(root);animation-range:40px 260px}}
@keyframes navaway{to{transform:translateY(-105%);opacity:0}}
.nav .wrap{display:flex;align-items:center;gap:26px;height:70px}
.logo{display:flex;align-items:center;gap:10px;font-family:var(--head);font-weight:700;font-size:19px;letter-spacing:-.01em;direction:ltr}
.logo svg{width:32px;height:32px}.logo .dot{color:var(--accent-ink)}
.links{display:flex;gap:24px;font-size:14.5px;color:var(--muted)}.links a:hover{color:var(--text)}
.nav-r{margin-inline-start:auto;display:flex;gap:8px;align-items:center}
.ib{width:40px;height:40px;border-radius:12px;border:1px solid var(--line2);display:grid;place-items:center;font-size:13px;font-weight:700;color:var(--muted)}
.ib:hover{color:var(--text)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 24px;border-radius:var(--rb,14px);font-weight:600;font-size:15px;white-space:nowrap;transition:transform .25s,box-shadow .25s,background .25s}
.btn svg{width:18px;height:18px}
html[dir="rtl"] .btn svg.fl{transform:scaleX(-1)}
.btn-a{background:var(--accent);color:var(--on-accent);box-shadow:0 10px 30px -8px var(--glow)}.btn-a:hover{transform:translateY(-2px)}
.btn-o{border:1px solid var(--line2);background:color-mix(in srgb,var(--surface) 60%,transparent)}.btn-o:hover{border-color:var(--accent)}
.btn-sm{height:40px;padding:0 18px;font-size:14px}
.burger{display:none}.mmenu{display:none}
/* sections */
.sec{padding:110px 0;position:relative}
.ey{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink)}
html[dir="rtl"] .ey{letter-spacing:0;font-size:14px}
.h2{font-size:clamp(32px,4.4vw,54px);margin-top:12px}
.h2 em{font-style:normal;color:var(--accent-ink)}
.lead{color:var(--muted);font-size:17.5px;max-width:600px;margin-top:14px}
.shead{text-align:center}.shead .lead{margin-inline:auto}
/* modules */
.mods{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:54px}
.mod{position:relative;padding:28px 26px;border-radius:var(--rc,22px);background:var(--surface);border:1px solid var(--line);overflow:hidden;transition:border-color .3s,box-shadow .3s}
.mod:hover{border-color:color-mix(in srgb,var(--accent) 45%,transparent);box-shadow:0 26px 50px -20px var(--glow)}
.mod .mi{width:52px;height:52px;border-radius:15px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent-ink);margin-bottom:18px}
.mod .mi svg{width:26px;height:26px}
.mod h3{font-size:21px;margin-bottom:8px}.mod p{color:var(--muted);font-size:15px}
.mod .num{position:absolute;top:22px;inset-inline-end:24px;font-family:var(--head);font-weight:700;font-size:14px;color:var(--muted);opacity:.6}
/* benefits */
.bens{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:50px}
.ben{display:flex;gap:16px;align-items:flex-start;padding:22px;border-radius:18px;border:1px solid var(--line);background:color-mix(in srgb,var(--surface) 70%,transparent)}
.ben svg{width:26px;height:26px;color:var(--accent-ink);flex:none;margin-top:2px}
.ben b{display:block;font-size:17px;margin-bottom:4px}.ben span{color:var(--muted);font-size:14.5px}
/* steps */
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:54px;counter-reset:s}
.step{padding:30px 26px;border-radius:22px;background:var(--surface);border:1px solid var(--line);position:relative}
.step::before{counter-increment:s;content:"0" counter(s);display:block;font-family:var(--head);font-weight:700;font-size:44px;color:var(--accent);line-height:1;margin-bottom:16px}
.step h3{font-size:21px;margin-bottom:8px}.step p{color:var(--muted);font-size:15px}
/* plans */
.plans{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:54px;align-items:stretch}
.plan{padding:32px 28px;border-radius:24px;background:var(--surface);border:1px solid var(--line);display:flex;flex-direction:column;gap:14px;position:relative}
.plan.pop{border:2px solid var(--accent);box-shadow:0 30px 60px -24px var(--glow)}
.plan .tag{position:absolute;top:-13px;inset-inline-start:28px;padding:4px 12px;border-radius:99px;background:var(--accent);color:var(--on-accent);font-size:12px;font-weight:700}
.plan h3{font-size:24px}.plan>span{color:var(--muted);font-size:14.5px}
.plan ul{list-style:none;display:grid;gap:10px;margin:8px 0 10px;flex:1}
.plan li{display:flex;gap:10px;align-items:center;font-size:15px}.plan li svg{width:18px;height:18px;color:var(--accent-ink);flex:none}
.plan .btn{width:100%}
/* faq */
.faq{max-width:820px;margin:46px auto 0;display:grid;gap:12px}
.faq details{border:1px solid var(--line);border-radius:16px;background:var(--surface);padding:0 22px;transition:border-color .3s}
.faq details[open]{border-color:color-mix(in srgb,var(--accent) 45%,transparent)}
.faq summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:20px 0;font-weight:600;font-size:16.5px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";font-size:24px;font-weight:400;color:var(--accent-ink);transition:transform .3s}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq details p{color:var(--muted);padding-bottom:20px}
/* demo */
.demo{display:grid;grid-template-columns:.9fr 1.1fr;gap:44px;align-items:center;padding:clamp(28px,5vw,60px);border-radius:32px;background:var(--demo-bg);color:var(--demo-text);position:relative;overflow:hidden}
.demo .lead{color:color-mix(in srgb,var(--demo-text) 75%,transparent)}.demo .ey{color:var(--accent2)}.demo .h2 em{color:var(--accent2)}
form{display:grid;gap:12px;padding:26px;border-radius:22px;background:var(--surface);color:var(--text);border:1px solid var(--line)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
label{display:grid;gap:6px;font-size:13px;color:var(--muted);font-weight:500}
input,select{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line2);border-radius:12px;padding:12px 14px;width:100%;outline:none}
input:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 4px var(--glow)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chips label{display:inline-flex;flex-direction:row;align-items:center;gap:6px;padding:8px 12px;border:1px solid var(--line2);border-radius:99px;font-size:13px;color:var(--text);cursor:pointer}
.chips input{width:auto;accent-color:var(--accent)}
form .btn{width:100%}.fnote{font-size:12.5px;color:var(--muted);text-align:center}
footer{border-top:1px solid var(--line);padding:50px 0 30px;color:var(--muted);font-size:14px}
.fgrid{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:30px}
.fgrid b{display:block;color:var(--text);margin-bottom:12px;font-size:14px}.fgrid a{display:block;padding:4px 0}.fgrid a:hover{color:var(--text)}
.fbot{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-top:40px;padding-top:20px;border-top:1px solid var(--line);font-size:13px}
.fab{position:fixed;bottom:20px;inset-inline-end:20px;z-index:55;width:56px;height:56px;border-radius:50%;background:#25D366;color:#fff;display:grid;place-items:center;box-shadow:0 14px 30px rgba(0,0,0,.2)}.fab svg{width:28px;height:28px}
.fin{animation:fin .9s cubic-bezier(.2,.7,.2,1) both}.d1{animation-delay:.1s}.d2{animation-delay:.2s}.d3{animation-delay:.3s}.d4{animation-delay:.45s}
@keyframes fin{from{opacity:0;transform:translateY(18px)}}
.r3{will-change:transform,opacity}
@media (max-width:980px){
 .links,.nav-r .hm{display:none}.burger{display:grid}
 .mmenu{display:block;position:fixed;top:70px;left:0;right:0;z-index:59;background:var(--bg);border-bottom:1px solid var(--line);padding:6px 20px 20px;transform:translateY(-130%);transition:transform .35s}
 .mmenu.open{transform:none}.mmenu a{display:block;padding:14px 0;border-bottom:1px solid var(--line)}.mmenu .btn{width:100%;margin-top:14px;border:0}
 .mods,.bens,.plans{grid-template-columns:1fr 1fr}.steps{grid-template-columns:1fr}.demo{grid-template-columns:1fr}.fgrid{grid-template-columns:1fr 1fr}
}
@media (max-width:640px){
 .sec{padding:80px 0}.mods,.bens,.plans{grid-template-columns:1fr}.two{grid-template-columns:1fr}.nav-r .btn{display:none}
 .note{font-size:11px;padding:8px 10px;gap:8px;border-radius:12px}.note .ni{width:28px;height:28px}.note b{font-size:11.5px}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
```

## 9. App screens CSS
The app screens in the hero and tour are built with HTML and CSS, not images. Everything sizes from the box they sit in, so they stay sharp at any width. When the real system is ready you can replace each `.uiw` block with a real screenshot (`<img>`) of the same screen.
```css
/* ---------- mock app screens (scale with their container) ---------- */
.uiw{container-type:inline-size;width:100%}
.ui{--u:1.12cqw;font-size:var(--u);width:100%;aspect-ratio:16/10.4;display:flex;flex-direction:column;border-radius:1.4em;overflow:hidden;background:var(--ui-bg);color:var(--ui-text);border:1px solid var(--ui-line);box-shadow:0 40px 90px -20px rgba(10,30,40,.35);font-family:var(--font);text-align:start;direction:inherit}
.ui *{box-sizing:border-box}
.ui-top{display:flex;align-items:center;gap:.6em;padding:.9em 1.2em;background:var(--ui-bar);border-bottom:1px solid var(--ui-line)}
.ui-top b{width:.9em;height:.9em;border-radius:50%;background:#F2706A}.ui-top b+b{background:#F6C04F}.ui-top b+b+b{background:#4CC37A}
.ui-url{margin-inline-start:1em;padding:.3em 1.4em;border-radius:99px;background:var(--ui-bg);font-size:1em;color:var(--ui-muted);direction:ltr}
.ui-smp{margin-inline-start:auto;font-size:.9em;color:var(--ui-muted);border:1px dashed var(--ui-line);padding:.15em .8em;border-radius:99px}
.ui-body{flex:1;display:flex;min-height:0}
.ui-side{width:5.4em;background:var(--ui-side);display:flex;flex-direction:column;align-items:center;gap:1.1em;padding:1.2em 0}
.ui-logo svg{width:2.6em;height:2.6em;display:block}
.ui-side i{width:2.8em;height:2.8em;border-radius:.8em;display:grid;place-items:center;color:var(--ui-side-ic)}
.ui-side i svg{width:1.5em;height:1.5em}.ui-side i.on{background:var(--accent);color:var(--on-accent)}
.ui-main{flex:1;min-width:0;padding:1.4em 1.6em;display:flex;flex-direction:column;gap:1.2em;overflow:hidden}
.ui-h{display:flex;align-items:center;justify-content:space-between;font-family:var(--head);font-size:1.9em;font-weight:600}
.ui-av{width:1.5em;height:1.5em;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2))}
.ui small{display:block;font-size:1.05em;color:var(--ui-muted);margin-bottom:.6em}
.card{background:var(--ui-card);border:1px solid var(--ui-line);border-radius:1em;padding:1.1em 1.2em;min-height:0}
.k3{display:grid;grid-template-columns:repeat(3,1fr);gap:1em}
.kp{background:var(--ui-card);border:1px solid var(--ui-line);border-radius:1em;padding:1em 1.2em;position:relative}
.kp b{display:block;font-size:2.2em;font-weight:700;letter-spacing:-.02em;direction:ltr;text-align:start}
.kp em{position:absolute;top:1em;inset-inline-end:1em;font-style:normal;font-size:.95em;font-weight:700;color:#14915F;background:#DDF6EA;padding:.15em .6em;border-radius:99px}.kp em.n{color:var(--ui-muted);background:var(--ui-line)}
.g2{display:grid;grid-template-columns:1.25fr 1fr;gap:1em;flex:1;min-height:0}
.bars{display:flex;align-items:flex-end;gap:.8em;height:calc(100% - 3.4em)}
.bars i{flex:1;height:var(--h);border-radius:.5em .5em .2em .2em;background:linear-gradient(var(--accent),color-mix(in srgb,var(--accent) 45%,transparent));position:relative;transform-origin:bottom;animation:barup 1.2s cubic-bezier(.2,.7,.2,1) both}
.bars i:nth-child(2){animation-delay:.08s}.bars i:nth-child(3){animation-delay:.16s}.bars i:nth-child(4){animation-delay:.24s}.bars i:nth-child(5){animation-delay:.32s}.bars i:nth-child(6){animation-delay:.4s}.bars i:nth-child(7){animation-delay:.48s}
@keyframes barup{from{transform:scaleY(.1)}}
.bars span{position:absolute;bottom:-1.6em;left:0;right:0;text-align:center;font-size:.9em;color:var(--ui-muted)}
.ap{display:flex;align-items:center;gap:.8em;padding:.7em 0;border-bottom:1px solid var(--ui-line);font-size:1.05em}.ap:last-child{border:0}
.ap b{font-weight:700;direction:ltr}.ap span{flex:1;color:var(--ui-muted)}.ap em{width:.7em;height:.7em;border-radius:50%;background:var(--c)}
.calw{flex:1;display:flex;flex-direction:column;min-height:0;background:var(--ui-card);border:1px solid var(--ui-line);border-radius:1em;overflow:hidden}
.cal-h{display:grid;grid-template-columns:4em repeat(5,1fr);border-bottom:1px solid var(--ui-line)}
.cal-h span{display:flex;align-items:center;gap:.5em;padding:.7em .6em;font-size:1em;font-weight:600}
.av{width:1.8em;height:1.8em;border-radius:50%;background:var(--c);color:#fff;display:inline-grid;place-items:center;font-style:normal;font-size:.95em;font-weight:700;flex:none}
.cal-g{flex:1;display:grid;grid-template-columns:4em repeat(5,1fr);position:relative;background:repeating-linear-gradient(var(--ui-card) 0 calc(100%/6 - 1px),var(--ui-line) calc(100%/6 - 1px) calc(100%/6))}
.cal-t{display:grid;grid-template-rows:repeat(6,1fr);font-size:.9em;color:var(--ui-muted)}.cal-t span{padding:.3em .5em;direction:ltr}
.cal-c{position:relative;border-inline-start:1px solid var(--ui-line)}
.ev{position:absolute;inset-inline:.35em;top:calc(var(--t)*100%/6 + .25em);height:calc(var(--l)*100%/6 - .5em);border-radius:.6em;background:color-mix(in srgb,var(--c) 20%,var(--ui-card));border-inline-start:.35em solid var(--c);padding:.4em .6em;font-size:.95em;font-weight:600;overflow:hidden;animation:fin .8s both}
.pos{flex:1;display:grid;grid-template-columns:1.5fr 1fr;gap:1em;min-height:0}
.pg{display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:1fr;gap:.8em}
.pi{background:var(--ui-card);border:1px solid var(--ui-line);border-radius:1em;padding:.8em;display:flex;flex-direction:column;gap:.3em}
.pi i{flex:1;min-height:2em;border-radius:.6em;background:linear-gradient(135deg,var(--c),color-mix(in srgb,var(--c) 35%,#fff))}
.pi span{font-size:1em;font-weight:600}.pi b{font-size:1em;color:var(--ui-muted);direction:ltr;text-align:start}
.cart{background:var(--ui-card);border:1px solid var(--ui-line);border-radius:1em;padding:1.1em;display:flex;flex-direction:column;gap:.6em}
.cl,.ct{display:flex;justify-content:space-between;font-size:1.05em}.cl b{direction:ltr}.ct{margin-top:auto;padding-top:.7em;border-top:1px dashed var(--ui-line);font-weight:700;font-size:1.3em}.ct b{direction:ltr}
.pay{display:block;text-align:center;padding:.8em;border-radius:.8em;background:var(--accent);color:var(--on-accent);font-weight:700;font-size:1.15em}
.tb{flex:1;padding:.4em 1.2em;display:flex;flex-direction:column;justify-content:space-around}
.tr{display:grid;grid-template-columns:2em 1fr 1fr 1fr 1fr 1fr;align-items:center;gap:.8em;padding:.6em 0;border-bottom:1px solid var(--ui-line);font-size:1.05em}.tr:last-child{border:0}
.acc .tr{grid-template-columns:1.1fr 1.4fr 1fr .8fr}
.mono{direction:ltr;text-align:start;font-variant-numeric:tabular-nums;color:var(--ui-muted)}
.st{font-style:normal;font-weight:700;font-size:.9em;padding:.25em .7em;border-radius:99px;justify-self:start}
.st.on,.st.paid{color:#14915F;background:#DDF6EA}.st.off{color:#6B7280;background:#EEF0F3}.st.leave,.st.due{color:#B4690E;background:#FDEFD8}
.big{display:block;font-size:2.4em;font-weight:700;direction:ltr;text-align:start}.ln{width:100%;height:55%;margin-top:.6em}
.wk{display:grid;grid-template-columns:repeat(7,1fr);gap:.5em}.wk div{display:flex;flex-direction:column;gap:.4em;align-items:center;font-size:.9em;color:var(--ui-muted)}
.wk i{width:100%;aspect-ratio:1;border-radius:.6em;background:linear-gradient(135deg,var(--a),var(--b))}
.sch{display:flex;align-items:center;gap:.6em;margin-top:1em;padding:.7em .9em;border-radius:.8em;background:var(--ui-bg);font-size:1em}.sch svg{width:1.4em;height:1.4em;color:#E1306C}.sch span{direction:ltr}.sch em{margin-inline-start:auto;font-style:normal;font-weight:700;color:#14915F}
.msg{display:flex;gap:.7em;align-items:flex-start;padding:.7em 0;border-bottom:1px solid var(--ui-line)}.msg:last-child{border:0}.msg b{display:block;font-size:1.05em}.msg span{font-size:1em;color:var(--ui-muted)}.msg em{margin-inline-start:auto;font-style:normal;font-size:.85em;font-weight:700;padding:.1em .5em;border-radius:.4em;background:var(--ui-line)}
/* floating notification cards */
.note{position:absolute;z-index:4;display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:16px;background:var(--surface);border:1px solid var(--line);box-shadow:0 20px 40px -10px rgba(10,30,40,.25);font-size:13px;white-space:nowrap;will-change:transform}
.note .ni{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent-ink)}.note .ni svg{width:20px;height:20px}
.note.wa .ni{background:#DCF8E6;color:#128C4A}
.note b{display:block;font-size:13.5px}.note small{color:var(--muted)}
```

## 10. Motion and behaviour (JavaScript)
Section entrance used in this design:
```js
const REVEAL=(u,k,m)=>`translateY(${u*70}px) rotateX(${u*28}deg)`; // u: 1 = hidden … 0 = in place, k = card position in its row, m = phone
```
Design motion (hero, background, tour):
```js
/* tour tabs: autoplay every 5 s with progress line; clicking a tab is pure CSS */
(function(){ const rs=[...document.querySelectorAll(".tt-r")], ps=[...document.querySelectorAll(".tt-p")], box=document.querySelector(".tt"); let cur=0,t0=performance.now(),hold=0;
 rs.forEach((r,k)=>r.addEventListener("change",()=>{ cur=k; t0=performance.now(); hold=performance.now(); }));
 box.addEventListener("pointerenter",()=>hold=Infinity); box.addEventListener("pointerleave",()=>{hold=performance.now(); t0=performance.now();});
 LOOP.push(()=>{ const p=(performance.now()-t0)/5000; ps.forEach((e,k)=>e.style.transform=`scaleX(${k===cur?cl(p):0})`); const r=box.getBoundingClientRect();
  if(p>=1 && !reduce && hold!==Infinity && r.top<innerHeight && r.bottom>0){ cur=(cur+1)%rs.length; rs[cur].checked=true; t0=performance.now(); } else if(p>=1) t0=performance.now(); }); })();

/* soft mint aurora background */
(function(){ const cv=document.getElementById("calm"), x=cv.getContext("2d"); let W,H,C={};
 const pal=()=>{C={a:rgb(css("--t1")),b:rgb(css("--t2")),c:rgb(css("--t3"))}}; window.__onTheme=pal; pal();
 function size(){ const d=.4; W=innerWidth; H=innerHeight; cv.width=W*d; cv.height=H*d; x.setTransform(d,0,0,d,0,0); } size(); addEventListener("resize",size);
 const B=[["a",.55,.3,.25,.05,.04,0],["b",.5,.32,.3,.04,.05,2],["c",.42,.3,.3,.06,.035,4],["a",.38,.25,.32,.035,.055,5.5]];
 function draw(n){ const t=n/1000; x.clearRect(0,0,W,H); const R=Math.max(W,H), s=scrollY*.0004;
  for(const [c,r,ax,ay,sx,sy,ph] of B){ const px=W*(.6+ax*Math.sin(t*sx+ph+s)), py=H*(.4+ay*Math.cos(t*sy+ph-s)); const g=x.createRadialGradient(px,py,0,px,py,R*r); g.addColorStop(0,`rgba(${C[c]},.55)`); g.addColorStop(1,`rgba(${C[c]},0)`); x.fillStyle=g; x.fillRect(0,0,W,H); }
  if(!reduce) requestAnimationFrame(draw); } requestAnimationFrame(draw); })();
/* hero: dashboard flattens in 3D as you scroll, follows the mouse; notes float */
(function(){ const tl=document.getElementById("htilt"), ns=[...document.querySelectorAll(".hstage .note")]; let sx=0,sy=0;
 LOOP.push(t=>{ const h=cl(scrollY/(innerHeight*.8)), m=innerWidth<=980, rtl=document.documentElement.dir==="rtl"?-1:1; sx+=((m?Math.sin(t*.4)*.3:mx)-sx)*.06; sy+=((m?Math.cos(t*.3)*.2:my)-sy)*.06;
  const k=1-ez(h); tl.style.transform=`rotateX(${14*k-sy*6}deg) rotateY(${rtl*(-18*k+sx*8)}deg) rotateZ(${rtl*2*k}deg) translateZ(${h*40}px)`;
  ns.forEach((n,i)=>n.style.transform=`translate3d(${sx*(i+1)*10}px,${Math.sin(t*1.1+i*2)*8-h*(60+i*30)}px,0)`); }); })();
```
Shared engine:
- Settings (`WHATSAPP_NUMBER`, `CONTACT_EMAIL`).
- Arabic/English switching and light/dark.
- Demo form → WhatsApp or email.
- Top bar hide/show.
- Scroll-linked 3D entrance and helpers.
```js
document.documentElement.classList.add("js");
/* ===== CONFIG: where demo requests go ===== */
const WHATSAPP_NUMBER = "";            // e.g. "9715XXXXXXXX" — demo requests open WhatsApp with the details
const CONTACT_EMAIL = "";              // e.g. "hello@spamanagement.co" — used if no WhatsApp number is set
const BRAND = "Spamanagement.co";
const AR = @AR@;
const EN={}; document.querySelectorAll("[data-i18n]").forEach(el=>{ if(!(el.dataset.i18n in EN)) EN[el.dataset.i18n]=el.textContent; });
const sg=k=>{try{return localStorage.getItem(k)}catch(e){return null}}, ss=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
let lang="en";
function applyLang(l){ lang=l; const d=l==="ar"?AR:EN; document.documentElement.lang=l; document.documentElement.dir=l==="ar"?"rtl":"ltr";
 document.querySelectorAll("[data-i18n]").forEach(el=>{ const v=d[el.dataset.i18n]; if(v!==undefined) el.textContent=v; });
 document.getElementById("langBtn").textContent=l==="ar"?"EN":"ع"; ss("crm_lang_@K@",l); setWa(); }
document.getElementById("langBtn").onclick=()=>applyLang(lang==="en"?"ar":"en");
const SUN='<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', MOON='<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>';
function applyTheme(th){ document.documentElement.dataset.theme=th; document.getElementById("themeIco").innerHTML=th==="dark"?SUN:MOON; ss("crm_theme_@K@",th); if(window.__onTheme) window.__onTheme(th); }
document.getElementById("themeBtn").onclick=()=>applyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark");
const waLink=t=>"https://wa.me/"+WHATSAPP_NUMBER+(t?"?text="+encodeURIComponent(t):"");
function setWa(){ document.querySelectorAll("[data-wa]").forEach(a=>{ a.href=waLink(lang==="ar"?"مرحباً، أود معرفة المزيد عن "+BRAND+".":"Hello, I would like to know more about "+BRAND+"."); a.target="_blank"; a.rel="noopener"; }); }
document.querySelectorAll("[data-plan]").forEach(a=>a.addEventListener("click",()=>{ document.getElementById("fplan").value=a.dataset.plan; }));
document.getElementById("dform").addEventListener("submit",e=>{ e.preventDefault(); const f=e.target; let ok=true;
 f.querySelectorAll("[required]").forEach(i=>{ if(!i.value.trim()){ i.style.borderColor="#d9534f"; ok=false; } else i.style.borderColor=""; }); if(!ok) return;
 const d=new FormData(f), mods=d.getAll("mods").join(", "), ar=lang==="ar";
 const msg=(ar?"طلب عرض — ":"Demo request — ")+BRAND+"\n"+(ar?"الاسم: ":"Name: ")+d.get("name")+"\n"+(ar?"السبا: ":"Spa: ")+d.get("spa")+"\n"+(ar?"الهاتف: ":"Phone: ")+d.get("phone")+(d.get("email")?"\n"+(ar?"البريد: ":"Email: ")+d.get("email"):"")+"\n"+(ar?"الفروع: ":"Branches: ")+d.get("br")+(mods?"\n"+(ar?"الوحدات: ":"Modules: ")+mods:"")+(d.get("plan")?"\n"+(ar?"الباقة: ":"Plan: ")+d.get("plan"):"");
 if(WHATSAPP_NUMBER) window.open(waLink(msg),"_blank","noopener"); else if(CONTACT_EMAIL) location.href="mailto:"+CONTACT_EMAIL+"?subject="+encodeURIComponent((ar?"طلب عرض":"Demo request")+" — "+d.get("spa"))+"&body="+encodeURIComponent(msg); else window.open(waLink(msg),"_blank","noopener"); });
/* top bar: hides on scroll down, returns on scroll up */
(function(){ const nv=document.getElementById("nav"), mm=document.getElementById("mmenu"); let ly=scrollY, acc=0;
 addEventListener("scroll",()=>{ const y=scrollY, d=y-ly; ly=y; nv.classList.toggle("scrolled",y>10); if(mm.classList.contains("open")){ nv.classList.remove("hide"); return; }
  acc=(Math.sign(d)===Math.sign(acc))?acc+d:d; if(y<120||acc<-14) nv.classList.remove("hide"); else if(acc>14) nv.classList.add("hide"); },{passive:true});
 nv.addEventListener("focusin",()=>nv.classList.remove("hide")); })();
document.getElementById("burger").onclick=()=>document.getElementById("mmenu").classList.toggle("open");
document.querySelectorAll("#mmenu a").forEach(a=>a.onclick=()=>document.getElementById("mmenu").classList.remove("open"));
document.getElementById("yr").textContent=new Date().getFullYear();
/* helpers */
const cl=(v,a=0,b=1)=>Math.min(b,Math.max(a,v)), ez=x=>1-Math.pow(1-x,3), prog=s=>{const r=s.getBoundingClientRect();return cl(-r.top/(r.height-innerHeight))};
const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches; let mx=0,my=0; addEventListener("pointermove",e=>{mx=e.clientX/innerWidth-.5;my=e.clientY/innerHeight-.5},{passive:true});
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const rgb=h=>{h=h.replace("#",""); if(h.length===3) h=h.split("").map(c=>c+c).join(""); return [0,2,4].map(i=>parseInt(h.substr(i,2),16)).join(",");};
/* sections enter in 3D, linked to scroll (reverses when scrolling back up) */
const R3E=[...document.querySelectorAll(".shead,.mod,.ben,.step,.plan,.faq details,.demo>div:first-child,#dform")];
R3E.forEach(el=>{ el.classList.add("r3"); el._k=[...el.parentElement.children].indexOf(el)%3; el._tx=el._ty=el._hx=el._hy=0;
 if(el.matches(".mod,.plan,.step")){ el.addEventListener("pointermove",e=>{const r=el.getBoundingClientRect(); el._tx=(e.clientX-r.left)/r.width-.5; el._ty=(e.clientY-r.top)/r.height-.5;}); el.addEventListener("pointerleave",()=>{el._tx=el._ty=0}); } });
function revFx(){ const vh=innerHeight, m=innerWidth<700;
 for(const el of R3E){ const r=el.getBoundingClientRect(); const vis=!(r.top>vh+150||r.bottom<-150); if(!vis && el._done) continue; el._done=!vis;
  const q=ez(cl((vh-r.top)/(vh*.6)-(m?0:el._k*.08))), u=1-q; el._hx+=(el._tx-el._hx)*.12; el._hy+=(el._ty-el._hy)*.12;
  el.style.transform=`perspective(1100px) ${REVEAL(u,el._k,m)} rotateX(${-el._hy*7}deg) rotateY(${el._hx*9}deg)`; el.style.opacity=(.08+.92*q).toFixed(3); } }
const LOOP=[]; let T0=performance.now();
function frame(now){ const t=(now-T0)/1000; revFx(); LOOP.forEach(f=>f(t)); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
```

## 11. Text (English / Arabic)
The full Arabic list is in the `AR` object in the HTML; the main lines are:

| Text | English | Arabic |
|---|---|---|
| Hero line 1 | Run your spa | أدر السبا |
| Hero line 2 | from one place. | من مكان واحد. |
| `hero.ey` | Spa & wellness management software | نظام إدارة السبا ومراكز العافية |
| `hero.sub` | Bookings, staff, store, accounting and social media — in one simple system made for spas and massage centers. | الحجوزات والموظفون والمتجر والحسابات ووسائل التواصل — في نظام واحد بسيط مصمم للسبا ومراكز المساج. |
| `cta.demo` | Book a free demo | احجز عرضاً مجانياً |
| `cta.tour` | See how it works | شاهد كيف يعمل |
| `strip` | Made for day spas, massage centers, hammams and beauty lounges | مصمم للسبا ومراكز المساج والحمّامات وصالونات التجميل |
| `mod.h1` | Six modules. | ست وحدات. |
| `mod.h2` | One calm dashboard. | لوحة تحكم واحدة هادئة. |
| `m1.t` | Bookings & calendar | الحجوزات والتقويم |
| `m1.d` | Online and walk-in bookings, therapist and room calendar, reminders and no-show tracking. | حجوزات عبر الإنترنت وحضورية، تقويم للمعالجين والغرف، تذكيرات ومتابعة عدم الحضور. |
| `m2.t` | Spa management | إدارة السبا |
| `m2.d` | Rooms, treatments, packages, memberships and client profiles with visit history. | الغرف والعلاجات والباقات والعضويات وملفات العملاء مع سجل الزيارات. |
| `m3.t` | Store & POS | المتجر ونقاط البيع |
| `m3.d` | Sell products, gift cards and packages at the desk or online, with stock alerts. | بيع المنتجات وبطاقات الهدايا والباقات في الاستقبال أو عبر الإنترنت مع تنبيهات المخزون. |
| `m4.t` | HR & staff | الموارد البشرية |
| `m4.d` | Shifts, attendance, leave, commissions and staff documents in one place. | المناوبات والحضور والإجازات والعمولات ووثائق الموظفين في مكان واحد. |
| `m5.t` | Accounting | الحسابات |
| `m5.d` | Invoices, expenses, VAT-ready reports and daily cash closing. | الفواتير والمصروفات وتقارير جاهزة لضريبة القيمة المضافة وإقفال الصندوق اليومي. |
| `m6.t` | Social media | وسائل التواصل |
| `m6.d` | Plan and schedule posts, reply to messages and turn chats into bookings. | خطط وجدول المنشورات، رد على الرسائل وحوّل المحادثات إلى حجوزات. |
| `tour.h1` | See your spa | شاهد السبا الخاص بك |
| `tour.h2` | at a glance. | بنظرة واحدة. |
| `b.h1` | Simple for your team. | بسيط لفريقك. |
| `b.h2` | Powerful for you. | قوي لك. |
| `b1.t` | WhatsApp reminders | تذكيرات واتساب |
| `b2.t` | Arabic & English | العربية والإنجليزية |
| `b3.t` | VAT-ready invoices | فواتير جاهزة للضريبة |
| `b4.t` | Multi-branch | فروع متعددة |
| `b5.t` | Roles & permissions | الصلاحيات |
| `b6.t` | Any device | أي جهاز |
| `how.h1` | Live in | جاهز خلال |
| `how.h2` | three steps. | ثلاث خطوات. |
| `s1.t` | Book a demo | احجز عرضاً |
| `s2.t` | We set it up | نجهّزه لك |
| `s3.t` | Go live | ابدأ العمل |
| `p1.t` | Essential | الأساسية |
| `p2.t` | Professional | الاحترافية |
| `p3.t` | Multi-branch | الفروع المتعددة |
| `p.ask` | Request pricing | اطلب السعر |
| `d.h1` | See it with | شاهده مع |
| `d.h2` | your own spa. | السبا الخاص بك. |
| `d.send` | Request my demo | اطلب العرض |

## 12. Before going live
1. **Where demo requests go:** set `const WHATSAPP_NUMBER = "";` (e.g. "9715XXXXXXXX") and/or `const CONTACT_EMAIL = "";`. If only the email is set, the form opens an email.
2. **Features:** confirm every feature listed (modules, WhatsApp reminders, VAT-ready invoices, multi-branch, roles, Arabic/English, data import, setup help) matches what the system really offers; remove anything not yet built.
3. **Plans:** confirm the plan names and what each includes; add prices if you want them shown.
4. **App screens:** they use sample data and say "Sample data". Replace them with real screenshots when the system is ready.
5. **Arabic:** have the text checked by a native speaker.
6. **Legal:** add your privacy policy and terms links to the footer before collecting form data.
