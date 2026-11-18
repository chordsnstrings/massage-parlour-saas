# 19. How changes reach production

## What this is for

How new features and fixes go live, how to check that an update worked, and how to undo one. You never need to log in to the server: updates arrive by themselves once a change is approved.

## From request to live

1. **You ask Claude for a change.** Claude works on a copy of the code and opens a pull request (PR) on GitHub. A PR is a proposed change that you can read before it goes live.
2. **Automatic checks run.** GitHub's automatic checks (called CI) run on every PR: code style, type checks, tests, a full build and browser tests that click through the app, plus checks on database changes, on the security of outside software packages and on the server settings.
3. **You approve.** When the checks are green and you are happy, the PR is merged into the deploy branch. This is the branch the live server follows.
4. **The deploy branch is checked again.** When CI is green on the deploy branch too, it marks that version as safe to deploy ("deploy/green").
5. **The server updates itself.** Every 2 minutes the server looks for a new safe version. When it finds one, it:
   - builds the new version,
   - backs up the database,
   - updates the database structure and restarts the platform,
   - checks for up to 5 minutes that the platform answers.
6. **If anything fails, the server goes back to the last good version on its own.** It reports the update as **failed** and does not try that version again every 2 minutes. A fix needs a new change.

A change usually reaches the live platform about 20 minutes after it is merged: the time CI needs, plus up to 2 minutes.

> **Important:** Only versions that passed every check are deployed. A change that has not passed CI never reaches the live platform.

> **Tip:** The deploy branch is called **claude/intelligent-heisenberg-g9e81o**. It is also the default branch on GitHub. Every change merged into it goes to the live platform, so only approved PRs should be merged there.

## Check a deploy on the Overview

1. Click **Overview** in the sidebar.
2. In the **Server health** card, read the **Last deploy** row. It shows the result and the short code of the version, for example "ok · 7f3c2a1 · deployed 7f3c2a1".

   ![The last deploy on the Overview page.](../../../shots/platform/dep-overview-row.png)

   *In the screenshot:*

   1. **Last deploy**: the result (**ok**) and the version (**7f3c2a1**).

3. If the badge is red and says **failed**, the server is back on the previous version. Ask Claude to check the build log.

> **Tip:** You also get an email when a deploy fails, if email is set up (chapter 15).

## Check a deploy on the status page

The server has its own status page, protected by a password.

1. Open **https://spamanagement.co/_status/deploy.json** in your browser.
2. Sign in with the user name **ops** and the status password. The status password (STATUS_PASSWORD) was made when the server was set up. Keep it in your password manager.
3. Read the result:
   - **state**: **ok**, **building**, **rolling_back** or **failed**.
   - **commit**: the version that is live.
4. The same folder has three more pages:
   - **gate.json**: the newest version on the deploy branch compared with the newest version that passed CI.
   - **build.log**: the log of the last update.
   - **runtime.txt**: the state of each part of the server and its last log lines. Passwords and keys are hidden.

Without the password, you can still open **https://app.spamanagement.co/api/health**. It shows **ok: true** and the version (**release**) when the platform is working.

> **Important:** Never share the status password in a chat, an email or a PR.

## Undo a change

1. Ask Claude to revert the PR. A revert is a new change that takes the old one out.
2. The revert goes through the same checks and deploys like any other change.
3. If you also need data back from before an update, tell Claude. Before every update the server saves a database backup (the newest 5 are kept), and Claude or someone with server access can restore it (chapter 22).

> **Important:** Database structure changes are not undone by a revert. That is why database changes are kept "additive": they add to the database and don't remove anything the previous version still needs.

## Public server settings (site.env)

A few public settings live in a plain file in the code, **deploy/droplet/site.env**: the domain, how addresses are routed, the app and console addresses, extra domains, the email address for certificates, the push notification contact, the address spas point their own domains at and the From address for email.

1. To change one of these, ask Claude. Claude changes the file in a PR.
2. After the next deploy, the server uses the new values.

> **Important:** site.env is for public settings only. Passwords and keys never go there (chapter 24).
