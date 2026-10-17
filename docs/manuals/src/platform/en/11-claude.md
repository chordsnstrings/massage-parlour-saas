# 11. Connect Claude or ChatGPT to edit websites

## What this is for

You can edit spa websites by chatting with an AI assistant: Claude (on claude.ai or in the Claude desktop app) or ChatGPT (on chatgpt.com). The assistant saves its changes as drafts only. You still preview and publish them in the Website Studio (chapter 10).

## Before you start

- You must be a super-admin with two-step verification on (chapter 2).
- You must be an AI site editor. The server setting SITE_AI_EDITOR_EMAILS decides who that is. On the live platform it is "*": every super-admin with two-step verification on can connect. A verified email address is not needed for this; it is the same rule as for signing in to the console. The setting can be narrowed to a named list of addresses; then your address must be on the list and verified. The same setting also decides who sees **Ask AI** and **Write texts** (chapter 10). If your account can't connect yet, the **Connect Claude or ChatGPT** card in **Websites** says: "Connecting Claude or ChatGPT isn’t enabled for your account (SITE_AI_EDITOR_EMAILS)." The page that opens from the assistant names the exact reason (see "If the assistant can't connect" below).

## Connect

1. In the console, open **Websites** and scroll to the card **Connect Claude or ChatGPT**: "Edit spa websites from Claude or ChatGPT. Changes are saved as drafts; you preview and publish here as usual."
2. Click **Copy** next to the connector address. On the live platform it is **https://app.spamanagement.co/api/mcp**.

   ![The Connect Claude or ChatGPT card.](../../../shots/platform/claude-card.png)

   *In the screenshot:*

   1. The setup steps for Claude and for ChatGPT.
   2. The connector address (here the demo address on a test computer).
   3. **Copy**.
   4. **Connected clients**: every connection, with "Connected {date} · last sign-in {date}". A client without a name shows its address, for example chatgpt.com.
   5. **Revoke**.

3. Add the address in your assistant (see "From Claude" or "From ChatGPT" below), then approve the connection.

### From Claude

The card says: "Claude: Settings → Connectors → Add custom connector, paste this URL."

1. In Claude, open **Settings** → **Connectors** → **Add custom connector**.
2. Give it a name, for example "spamanagement", and paste the address.
3. Claude opens our sign-in page. Go on with "Approve the connection" below.

### From ChatGPT

The card says: "ChatGPT: Plugins (chatgpt.com/plugins) → + → Add custom MCP server, paste this URL, choose OAuth → Create as a plugin."

1. In ChatGPT, open **Plugins** (chatgpt.com/plugins) and click **+**.
2. Choose **Add custom MCP server** and paste the address.
3. Choose **OAuth**, then click **Create as a plugin**.
4. ChatGPT opens our sign-in page. Go on with "Approve the connection" below.

### Approve the connection

1. Sign in with your super-admin email, password and two-step code.
2. The page **Connect your AI assistant** opens: "{client} wants to edit spa websites for you.", for example "chatgpt.com wants to edit spa websites for you." (the assistant's name, or its address when it gives none). Under it, "Signed in as …" shows the account you are signed in with.
3. Check what the assistant can do: "It can read spa websites and save changes as drafts. It can’t publish: you still preview and publish in the platform console (Websites)."
4. Check the line "Approving sends access to {host}." It must say claude.ai, claude.com or chatgpt.com.
5. Click **Allow**. (Click **Deny** if anything looks wrong.)

   ![Approving an AI assistant.](../../../shots/platform/claude-consent.png)

   *In the screenshot:*

   1. What the assistant can do.
   2. **Approving sends access to chatgpt.com**.
   3. **Allow**.

6. Back in the assistant, ask for what you need. For example:
   - "List my spas."
   - "Switch Saffron Spa to the Desert Sand template."
   - "In Saffron's HTML design, change the hero headline to …"
   - "Add this photo https://… to Saffron's media and use it in the hero."
   - "Give me a preview link for the Saffron Spa home page."
7. Open the spa in **Websites**, check the drafts (or the preview link the assistant gives you) and click **Publish site** (chapter 10).

## What the assistant can do

- List the spas and read a spa's site.
- List the templates and switch a spa's template, as drafts. For a block template the theme becomes a draft theme; an HTML design keeps the spa's theme and writes its pages as drafts. You can undo the switch in one click with **Undo** on the Studio page. A switch is refused while a page is open in the editor. For an HTML design with **CRM contract v2**, the switch also starts Write texts (chapter 10).
- Add, change, move and remove blocks, change the theme, and add and rename pages.
- Read and change an HTML design's file. It is stored exactly as the assistant sends it. **Phone fixes** are turned on only if you ask for them (chapter 12).
- Read and change an HTML design's words, page title, search description and pictures: its **Website content** (chapter 10).
- Add a picture from an https address to a spa's media library: JPEG, PNG, WebP, AVIF or GIF, up to 8 MB. It can add 10 pictures a minute and 100 per spa a day.
- Show what **Fill the CRM from the design** would do. It only reads; you apply it yourself in the console (chapter 10).
- Make a preview link that works for 1, 7 or 30 days.

> **Important:** The assistant has no publish tool. Nothing goes live until you publish it yourself.

> **Tip:** If you have the page open in the editor while the assistant changes it, the editor shows **Changed elsewhere (an AI assistant or another editor).** Click **Reload** to see the change.

> **Important:** Every action of the assistant is written to the **Audit log** under your name. The entry also records "via AI assistant (MCP)" and which assistant it was. The assistant can send up to 60 requests per minute.

> **Tip:** ChatGPT asks you to confirm a change that edits or removes something. That is normal: check it and confirm.

> **Tip:** Only Claude's and ChatGPT's own addresses can connect. A registration that nobody ever approved is deleted after a day. An approved one stays, also after **Revoke**.

## If the assistant can't connect

If your account can't connect, the **Connect your AI assistant** page shows the exact reason instead of **Allow**:

- "Only super-admin accounts can connect an AI assistant." You signed in with a login that is not a super-admin, for example a spa login. Sign in with your super-admin account.
- "Turn on two-step verification for this super-admin account first." Turn it on in **Account & security** (chapter 2).
- "Verify the email address of this account first, then start again from your AI assistant (Claude or ChatGPT)." This appears only when SITE_AI_EDITOR_EMAILS is a named list of addresses. Open the link in the verification email (chapter 2).
- "Connecting an AI assistant is not enabled for your account." This appears only when SITE_AI_EDITOR_EMAILS is a named list and your address is not on it. Ask Claude to add your address to SITE_AI_EDITOR_EMAILS. It is a small change that goes through the normal review (chapter 19).
- "This connection request has expired. Start again from your AI assistant (Claude or ChatGPT)." The page was open too long. Go back to the assistant and connect again.

> **Important:** After you fix the reason, don't reload the old tab. Go back to the assistant and start connecting again. A reloaded old page only says "Your account can connect now. Go back to your AI assistant (Claude or ChatGPT) and connect again."

> **Tip:** The card also says: "A connector added more than a day before your account could connect must be removed and added again in the assistant." Do this, for example, when ChatGPT says invalid_client.

## Disconnect

1. In the console, open **Websites** → **Connect Claude or ChatGPT**.
2. Under **Connected clients**, click **Revoke** next to the connection.
3. A message confirms: "Disconnected — that assistant can no longer edit sites". The assistant's next request is refused.
4. The connector itself stays in the assistant: "Revoke below keeps the connector: connect again from the assistant any time."

> **Tip:** If a person stops being an AI site editor (their address is taken out of SITE_AI_EDITOR_EMAILS), their connection stops working at once too.
