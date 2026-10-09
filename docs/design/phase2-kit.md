# Phase 2 page kit — how to convert a spa-dashboard screen (PLAN §14.6, crm-spec §3/§5/§6)

Gallery: `app.localhost:3000/dev/kit/crm` (`?lang=th` for Thai sizes). CSS: `app/dashboard/[tenant]/crm-kit.css`
(scoped `:where(:root:has(.crm))`, `@layer components` so Tailwind utilities still override; sizes = `--crm-*` tokens
in `crm.css`, incl. Thai ≥12 px and coarse-pointer ≥40 px overrides). Base UI kit (`components/ui/*`) is themed
via `--ui-*` hooks inside `.crm` only — keep using `Button`, `Input`/`Select`/`Textarea`, `Field`, `ActionForm`,
`FormSheet`, `Sheet`, `DataTable` (stacks ≤768 px), `EmptyState`, `PageHeader`, `toast`.
Colours + fonts (brand look, PLAN §18.6): use the tokens, never literals — `--crm-text/-muted`, `--crm-surface/-surface2`,
`--crm-page`, `--crm-accent/-accent-ink` (green), `--crm-lime/-lime-soft/-lime-ink` (small highlights only),
`--crm-ok/-warn/-bad/-info` + `-bg`; fonts `--crm-font` / `--crm-head` / `--crm-num` (Thai stacks swap in by `lang`).

## Components (`import { … } from '@/components/crm'`; server-safe unless noted; never contain English)
| Component | Props | Classes |
|---|---|---|
| `Card` | `title? sub? actions? footer? headingAs? arch? flush? as?` + HTML attrs | `.crm-card` `.crm-card-h` `.crm-sub` `.crm-act` `.crm-card-f` |
| `CardHeader` | `title sub? actions? as?` | `.crm-card-h` |
| `Grid` / `Stack` | `cols: g1·g2·g3·g4·col-2·col-2b·kgrid` (g4 of Stat/Kpi + kgrid stay 2 cols on phones) / – | `.crm-grid .crm-g4 …` (§1.7 collapse) `.crm-stack` |
| `Stat` | `label value unit? change?{text,dir} icon?` (corner deco only with icon) | `.crm-stat .crm-lab .crm-n .crm-chg[data-dir]` |
| `Kpi` / `Delta` | `label value icon? delta?{text,dir} sub? href? linkLabel?` / `dir` | `.crm-kpi .crm-ktop … .crm-vd` `.crm-delta[data-dir=up·down·flat]` |
| `Pill` | `tone?: neutral·ok·warn·bad·info·acc` `dot?`; `statusTone(status)` | `.crm-pill[data-tone]` `.crm-dotc` |
| `Avatar` / `TName` | `name src? color? size?: sm·md·lg` / `name sub? src?` | `.crm-tav` `.crm-tname` |
| `ListRow` | `icon? title body? time? end? href?` | `.crm-row .crm-ricon .crm-rbody .crm-rtime .crm-rend` |
| `Toggle` (client) | `label checked?/defaultChecked? onChange? name? disabled?` — `role="switch"` | `.crm-toggle[aria-checked]` |
| `Seg` | `items[{value,label,href?,title?}] value label onChange? fill?` (links = server; buttons = from client) | `.crm-segctl` |
| `SectionTabs` | `items[{value,label,href}] value label` | `.crm-tabs .crm-tab` |
| `Meter` | `value max? label valueText? showLabel? tone?` (role=progressbar) | `.crm-bar[data-tone] i` |
| `BarChart` | `data[{label,value,hi?,title?}] label max? height?` | `.crm-barchart .crm-bc[data-hi]` |
| `Legend` / `SegBar` | `items[{label,value?,color?}]` / `items[{value,color,title?}] label`; `CHART_COLOURS` | `.crm-legend …` `.crm-segbar` |
| `Note` / `Eyebrow` / `Hairline` | `tone?: info·acc·warn icon?` / – / – | `.crm-note[data-tone]` `.crm-ey` `.crm-hairline` |
| `TeamCard` | `name subtitle? src? color? stats?[{label,value}]` | `.crm-team-card` |
| `Chat` / `Bubble` | `label` / `from: them·us time?` | `.crm-chat .crm-bub[data-from]` |
| `QueueItem` | `header message? actions?` (Send = wa.me link) | `.crm-q-item .crm-qi .crm-qb .crm-hd .crm-msg` |
| `GiftCardVisual` / `SiteFrame` / `ComingItem` | `top value bottom?` / `url children` / `icon? pill?` | `.crm-gift` `.crm-wstudio` `.crm-coming` |
Raw tables: `.crm-tbl-wrap` > `table.crm-tbl[data-stack=true]` (sticky th; ≤768 px rows stack — give each `td`
`data-label={t(…)}`), `.crm-num-c` for numbers. Raw fields: `.crm-fieldrow` + `.crm-inp`. Other: `.crm-muted`, `.crm-num`.

## i18n
- **Keys** live per namespace: `packages/core/src/i18n/en/<ns>.ts` + `th/<ns>.ts` (same keys; a missing/extra TH key
  is a type error; `pnpm --filter @spa/core test` checks placeholders). Edit ONLY your area's files, never
  `en.ts`/`th.ts` (aggregators). Namespaces: common, shell, nav, role, errors, validation, logo, ui (`en-ui.ts`) +
  overview, calendar, bookings, clients, sales, services, packages, inventory, team, staff, documents, roles, inbox,
  messages, campaigns, marketing, ai, analytics, reviews, website, media, accounts, payroll, billing, settings,
  account, auth, enums, permissions, domain (= `errors.domain`). Shared words → `common` (add, don't duplicate).
  Placeholders `{name}`; plurals `{ one, other }` + `count` (Thai needs only `other`). A param may be a nested
  message `{ key }` (translated first). Thai glossary: th.ts header; Thai copy needs native review.
- **Server**: `const { t, fmt, locale } = await getI18n()` (or `await getT()`) from `@/i18n/server`.
  **Client**: `const { t, fmt } = useI18n()` / `useT()` from `@/i18n/client`.
- **Enums**: `enumLabel(t, 'bookingStatus', b.status)` (all pgEnums in `enums.*`, unknown → raw value);
  tone via `statusTone`. **Permissions/roles**: `permissionLabel(t, 'clients.phone')`, `permissionGroupLabel(t, 'pos')`,
  `roleName(t, role)` / `roleDescription(t, role)` (system roles translated, custom names as typed) — `@spa/core/i18n`.
- **Action results**: `ok('settings.saved')`, `fail('errors.forbidden')`, `fail({ key, params })`; client shows
  `resultText(t, result)` (ActionForm/FormSheet already do). Plain strings still work (stay English).
- **DomainError**: `failDomain(e)` maps the services' English message → `errors.domain.*` automatically
  (`apps/web/src/i18n/domain-errors.ts`, derived from `en/domain.ts`; `{x}` parts become regex captures, status words
  via `errors.domain.word.*`). New service message → copy its exact text into `en/domain.ts` + Thai; unknown → English.
- **Zod**: write keys as messages — `z.string().min(1, 'validation.required')`; `fromZod(err)` passes them through
  and `FieldError` renders `t.maybe(key) ?? text`. Field errors carry no params (use a fixed key).
- **Shared pieces used outside the dashboard provider** (Puck editor, signup, platform) put their strings in `ui`
  (`en-ui.ts` + `th/ui.ts`, e.g. `ui.media.*`): `useT()` outside the provider falls back to English `ui` only.
- Confirm-then-run buttons: `useConfirmAction()` from `services/services-client` (toasts `resultText`).
- **Never translate typed names** (clients, staff, services, products, rooms, custom roles, spa name, messages).
- **Formatting**: dates/times/numbers/money via `fmt` (`date dateShort weekdayDate dateTime time monthYear monthShort
  number percent aed`) — strings are built from our own name tables, so server and browser output match (hydration-safe). `lib/utils` `formatAed/formatDate/formatDateTime` are English-only legacy: converted screens use `fmt`.

## Per-screen conversion checklist
1. Layout per crm-spec §5 for the page: `PageHeader` → `Grid`/`Card`/`Stat`/`Kpi`… from this kit; no new ad-hoc CSS
   (missing piece → add to crm-kit.css + gallery, tell the lead).
2. Every JSX string → key: headings, labels, placeholders, `aria-label`/`title`/`alt`, buttons, table headers +
   `data-label`, empty states, toasts, confirm dialogs, sheet titles/descriptions, `ok`/`fail` messages, zod messages,
   `<title>`/metadata. Enum values → `enumLabel`; permissions/roles → helpers.
3. Dates, times, numbers, AED, percentages → `fmt` (never `toLocaleString`, never hand-built strings).
4. **E2E**: before changing any English text, `grep -n "<text>" apps/web/e2e/<area>.spec.ts`; keep EN copy identical
   where a spec asserts it (or update the spec in the same change). Run the one spec for the flow.
5. Check `?lang=th` quickly (no overflow; Thai ≥12 px) and 360 px width; `cd apps/web && npx tsc --noEmit`,
   `npx biome check --write <files>`, `pnpm --filter @spa/core test`.
