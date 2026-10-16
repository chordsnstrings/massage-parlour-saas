# Handover: start here (state on 2026-10-15)

For a developer joining the project. Rules and decisions are in `CLAUDE.md`. The plan and every owner request are in
`docs/PLAN.md`. The code layout is in `docs/CODEMAP.md`. This file covers only the current state and how to work alongside
the existing flow.

## Where things stand

- Everything built so far is merged into the default branch `claude/intelligent-heisenberg-g9e81o` and is live at
  https://spamanagement.co:
  - phases P1–P3;
  - the spa dashboard redesign;
  - owner requests R1–R32, except R22 (paused), R27 (not building), R31 (planned) and the held Google fixes below;
  - fix backlog F1–F32.
- The last release is PR #55 (R32: booking ↔ sale order + daily sales sheet PDF), live 2026-10-15.
- Production runs `deploy/green`: the last commit of the default branch whose CI passed. It catches up with the default
  branch about half an hour after each merge (see "How a change reaches production").
- All older feature branches were squash-merged and released. The only unmerged work is the two branches below, plus
  open Dependabot PRs #39 (GitHub Actions), #40 (npm minor/patch) and #41 (TypeScript 5.9 → 7.0: risky, test before
  merging), and the old initial PR #1 into `main`, which can be closed.

## Work on GitHub that is not merged

| Branch | What it is | Status | Before merging |
| --- | --- | --- | --- |
| `claude/held-google-fixes-review-replies` | R29 Google Business Profile setup fixes: shared Google account, one spa per location, 30-day review cache, reconnect after the OAuth client changes, privacy wording. Also "Review replies" dropped for now: the dashboard Reviews page shows "Coming soon" (owner 2026-10-13). | Built and reviewed, **held until the owner approves the privacy wording**. | Merge the default branch in. Then delete the branch's own migrations 0057/0058 (SQL files + `meta/*_snapshot.json` + their `_journal.json` entries) and run `pnpm db:generate` again, because the default branch already has 0057–0059. Never renumber migrations by hand (PLAN §14.8 "Migration order"). |
| `claude/paused-r22-console-arabic` | R22: super-admin console in Arabic. An unfinished foundation. | **Paused by the owner** 2026-10-10 ("console keep english for now"). | Don't merge. Restart from it only if the owner asks. |

## Open items

**Waiting for an owner decision (don't build before the owner says "go"):**
- **Google branch:** approve the privacy wording on the branch above, then release it.
- **R32 cancelled bookings:** how cancelled bookings count on the daily sheet. The owner said "ask me later". Today they are
  not on the sheet and not sales.
- **Confirm three R32 rules:**
  - a walk-in's own-client flag is fixed at start;
  - a session left unpaid on a closed day can be finished only by an owner or manager;
  - status changes on a closed day are locked only when they reverse commission.
- **R31 Sales & Marketing + AI sales agent** (PLAN §14.8): planned; building starts only when the owner approves the plan.
- **Optional "AI key" card** in Console → Settings, so the AI key (`ARK_API_KEY`) is set like the Google/Meta keys (~1.5 h).
- **Text fix:** the spa dashboard's Settings → Instagram & Google cards name server variables. They should say the
  platform admin adds the keys in Console → Settings. This needs three changes:
  - the Google text, EN + TH i18n `settings` (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`);
  - the Instagram text "Once the keys below are set on the server" and `META_WEBHOOK_VERIFY_TOKEN`;
  - the key chips in `components/integrations/instagram-card.tsx`, which come from services `missingMetaEnv`.

**Owner setup (no code):**
- **Google and Meta keys:** enter the platform keys in Console → Settings, on the Google card and the Meta card
  (`docs/INTEGRATIONS.md`). Until then spas see "Not configured yet" instead of the Connect buttons.
- **AI key:** add `ARK_API_KEY` to the server secrets (`deploy/droplet/README.md` → "Secrets without SSH"). This needs the
  droplet's `/opt/spa/secrets.key`, and the new file must keep every key the current one holds. AI is a Premium feature.
- **BE RELAX:**
  - upload design v2.7: Console → Site templates → its row → Upload new version → Roll out (`docs/design/be-relax-site/`);
  - in the spa's Settings → Profile → Daily sales sheet, enter the 4 phone lines;
  - rename the 11 staff currently called "Therapist".
- **Native review:** the new Thai strings (list in PLAN §14.8, R32 entry).

## Access a new developer needs (the owner gives these privately, never in git or chat)

- **GitHub:** collaborator on `chordsnstrings/massage-parlour-saas` (repo Settings → Collaborators).
- **Production super-admin login** (only if needed):
  1. Add the email to `PLATFORM_ADMIN_EMAILS` in `deploy/droplet/compose.yml`, in both places (the shared env and the
     `migrate` service). A merge to the default branch deploys it.
  2. Create the login at `https://admin.spamanagement.co/join`.
  3. Verify the email, then enrol 2FA.
- **Server secrets** (only for changing production secrets): the server key `/opt/spa/secrets.key` decrypts
  `deploy/droplet/secrets.env.enc` (steps in `deploy/droplet/README.md`). SSH to the droplet is through the owner's
  DigitalOcean account.
- **Deploy status:** `https://spamanagement.co/_status/deploy.json` (basic auth user `ops`).

## How a change reaches production

1. Branch from the latest default branch: `git fetch origin && git checkout -b my-change origin/claude/intelligent-heisenberg-g9e81o`.
2. Code, then run the checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` and the Playwright spec for the touched flow.
   After a schema edit, run `pnpm db:generate`. CI's `guards` job fails when a schema change has no migration.
3. Open a pull request into `claude/intelligent-heisenberg-g9e81o`. CI runs lint, typecheck, unit/DB tests, build and the
   full e2e suite. It takes about 25–30 min on Chrome for Testing 153, with a 50-min limit.
4. Squash-merge when CI is green. CI runs again on the merged commit, and when it passes the `promote` job moves
   `deploy/green` there (forward only; a red push never deploys). The droplet checks `deploy/green` every 2 minutes,
   rebuilds and runs migrations first. A merge is live about half an hour later.
5. Confirm at https://spamanagement.co/api/health, which shows the release commit.

Never push straight to the default branch, never force-push it, and never move `deploy/green` by hand. Docs go through
a PR too, either in the same PR as the code or in their own (owner 2026-10-16). The only exception is the owner's
Claude session (`claude/laughing-faraday-fjgrsu`), which keeps its owner-approved direct pushes for memory and docs
upkeep.

## Working alongside Claude

- Claude works on `claude/laughing-faraday-fjgrsu` and releases through PRs from it. Before starting, tell the owner which
  area you take, so two people don't edit the same files at once. Pull the default branch often.
- **Migrations are numbered in order** (`packages/db/drizzle`). If two open PRs both add one, whoever merges second
  merges the default branch in, deletes their own migration and regenerates it with `pnpm db:generate`.
  - Never hand-renumber. Older `when` timestamps make `runMigrations` refuse to run, and the production migrate fails.
- **Dashboard text** is EN + TH only, through `@spa/core/i18n` keys. Tenant websites are EN + AR. The console is English.
  New Thai/Arabic text needs native review by the owner's team.
- **Shared test database:** DB unit tests and e2e both use and reset `spa_test`. Don't run both at once.
- **Docs in the same PR:** record decisions and changed structure in `CLAUDE.md` / `docs/PLAN.md` / `docs/CODEMAP.md`.
- **Owner rules** that come up most (full list in `CLAUDE.md`):
  - ask the owner before coding a new feature (owner 2026-10-15);
  - customer messages are WhatsApp click-to-send only;
  - payments are recorded, never processed;
  - the only email address is ask@spamanagement.co;
  - uploaded HTML designs render exactly as built.

## What is in the repo besides the code

- `docs/design/be-relax-site/`: the BE RELAX website design versions (v2.6 live, v2.7 next) and the 2026-10-14 QA report.
- `docs/manuals/`: Markdown sources of the four owner's manuals (Platform EN/AR, Spa EN/TH) and the scripts that
  typeset them. The PDFs (16–27 MB each) and the 234 screenshots (58 MB) are not in git; the owner has the PDFs.

## Not in git (by design)

- **Production data:** spas, bookings, sales, uploaded designs, photos and files are in Postgres and file storage on the
  droplet. Backups are covered in `deploy/droplet/README.md`.
- **Secrets:** they live in the droplet's environment and the encrypted `deploy/droplet/secrets.env.enc`. Local
  development uses `.env` copied from `.env.example`.
