# 20. DNS at Namecheap

## What this is for

DNS records tell the internet where spamanagement.co lives. A few records at Namecheap make the website, the app, the console, every spa's free address and the ask@spamanagement.co mailbox work.

## Where to find the records

1. Sign in to Namecheap.
2. Open **Domain List**.
3. Click **Manage** next to **spamanagement.co**.
4. Open the **Advanced DNS** tab.

The nameservers stay on **Namecheap BasicDNS**. There is no Cloudflare in front of the platform.

## The records you need

| Type | Host | Value | What it does |
|---|---|---|---|
| **A** | **@** | the server's IP address | spamanagement.co itself (the marketing website). |
| **A** | **\*** | the same IP address | Every address under spamanagement.co: www., app., admin., every spa's {slug}. and customers. |
| Email Forwarding (MX + SPF TXT) | set by Namecheap | set by Namecheap | Delivers ask@spamanagement.co to your own mailbox. |

The server's IP address is the public address of the DigitalOcean server (droplet). You find it in DigitalOcean on the droplet's page. It is written as `<droplet IP>` in this manual.

> **Important:** Don't delete or change the two **A** records. If they are wrong, the whole platform, every spa website and online booking stop working.

> **Tip:** The **\*** record means you don't need a new record for each spa. A new spa's address, for example saffron-spa.spamanagement.co, works straight away. The server gets its secure (https) certificate on the first visit.

## Records you add later

- **Resend (staff email):** the records from **Company** → **Email (Resend)** → **Set up sending domain** (chapter 15). Read the warning about **Custom MX** and Email Forwarding there first.
- **Google Search Console:** a **TXT** record that proves you own spamanagement.co (chapter 25).

## Spas' own domains

A spa's own domain (for example book.saffronspa.ae) is not at your Namecheap account. The spa adds its records at its own domain company:

- a **TXT** record that proves it owns the domain,
- a **CNAME** record that points the domain at **customers.spamanagement.co**.

The **\*** record above makes customers.spamanagement.co point at the server. See chapter 13.

## Check that DNS works

- Open https://app.spamanagement.co and https://admin.spamanagement.co. Both should load.
- Ask Claude to check the records. Claude can look up where app.spamanagement.co points and compare it with the server's address.

> **Tip:** A DNS change at Namecheap usually works within minutes, but it can take up to 48 hours to reach everyone.
