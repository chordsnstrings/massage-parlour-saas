# 24. Secrets and configuration

## What this is for

Where passwords and API keys live, and how to add or change them safely without logging in to the server. A secret is anything that gives access: a password, an API key or a token.

## The rules

1. **Never paste a key or password** into a chat (including Claude), an email, a PR, a document or this manual.
2. **Keys you can enter in the console** are the Resend key and the bot check keys (chapter 15) and the Meta MCP key (chapter 16). The secret ones are write-only and stored encrypted. The console never shows them again: you only see **Set ✓** with the last 4 characters, or "A key is stored (encrypted)". (The bot check **Site key** is public, so it stays visible.)
3. **All other secrets** go into the **encrypted secrets file** in the code. Examples: the Stripe key, the backup bucket keys, Sentry, the AI key (ModelArk), Google and Meta app secrets, Namecheap. Only the server, and you with the secrets key, can read this file.
4. **Public settings** (the domain, address routing, the email address for certificates) go into **site.env**, never into the secrets file, and never a secret into site.env (chapter 19).

> **Important:** Claude never needs a key pasted into the chat. Claude in a chat also has neither the secrets key nor your copy of the secrets file, so it cannot add a secret for you. You add it yourself on your own computer, as described below.

## How the encrypted secrets file works

- The file is **deploy/droplet/secrets.env.enc** in the code. It is locked with the **secrets key**, which was made when the server was set up. The server keeps a copy of the key (/opt/spa/secrets.key). You keep your own copy in your password manager: without it, you can't make a new secrets file.
- Unlocked, the file is a plain list of settings, one per line, for example STRIPE_SECRET_KEY=… .
- On every deploy, the server unlocks the file and adds its values to its settings.
- The server builds its settings fresh on every deploy, in this order: the settings from the first setup, then the secrets file, then site.env. A later one wins.
- When the file is replaced, the new file must contain **every** key the old one had, not only the new one. Otherwise the missing keys disappear from the server.

## What you keep

- The **secrets key**.
- A private copy of the unlocked file: every KEY=value line that is in it now. Keep it as a secure note in your password manager, or as a file on your own computer that you never share and never put into the code. Below it is called **overlay.env**.

## Add or change a secret

> **Tip:** The Resend key and the bot check keys don't need this file. Enter them in **Company** instead (chapter 15).

1. Get the value from the service, for example a new secret key in Stripe.
2. On your own computer, open your private copy (overlay.env). Add a line for the new setting, for example STRIPE_SECRET_KEY=…, or change the value on its existing line. Keep every other line as it is.
3. Save the secrets key from your password manager as a file on your computer, for example **secrets.key**.
4. In a terminal, in the folder with the code, run the command from the server notes (deploy/droplet/README.md, "Secrets without SSH"):

   `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt -pass file:secrets.key -in overlay.env -out deploy/droplet/secrets.env.enc`

   Claude Code running on your own computer can run this command for you. It does not need to open or show either file.
5. Put only the new **deploy/droplet/secrets.env.enc** into a PR. Claude Code can make the PR, or you can upload the file on GitHub (**Add file** → **Upload files** in the deploy/droplet folder, in a new branch). Never commit overlay.env or secrets.key.
6. After you approve, the next deploy puts the new value in place (chapter 19).
7. Check the matching row in **Configuration** on the Overview. It turns green when the setting is present.
8. Delete the secrets.key file from your computer. The key stays in your password manager. Keep overlay.env up to date with the new line.

> **Tip:** The **Configuration** card only shows whether a setting is present, never its value. It is the safe way to check a secret.

> **Important:** If your copy of the file is lost, don't make a new file from memory: it would drop the keys you forgot. Someone with access to the server must first unlock the current file with the key in /opt/spa/secrets.key and hand you its contents safely. The same person can read the secrets key there if you lost it.

## Passwords to keep in your password manager

Keep these somewhere safe, for example in a password manager. Never in a chat, an email or a shared document.

- Your own super-admin password and your two-step verification app.
- The **status password** for **/_status/** (user **ops**, chapter 19).
- The **secrets key** and your private copy of the secrets file (overlay.env).
- Your logins for DigitalOcean, Namecheap, GitHub, Resend, Cloudflare, Stripe, Sentry, Google Cloud and Meta for Developers.

> **Important:** If you think a key or password has leaked, change it straight away at the service that issued it (for example a new key in Resend or Stripe). Then put the new value in place (in **Company**, or in the secrets file as described above) and delete the old key at that service.
