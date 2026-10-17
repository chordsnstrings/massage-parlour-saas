# 13. Domains and domain purchases

## What this is for

Spas can use their own domain (for example www.theirspa.ae) instead of the free spamanagement.co address. This chapter shows how a spa connects one, how you check every domain in the console, and how you buy a domain for a spa from your Namecheap balance.

## How a spa connects its own domain

1. The spa owner opens **Settings** → **Domains** in their dashboard. The page says: "Where clients find your website. Your free address always works — connect a domain you own to use it instead."
2. Under **Connect your own domain**, they type the domain and click **Add domain**.
3. The page shows two **DNS records** to add at the company where the domain is registered:
   - A **TXT** record that "Proves you own the domain".
   - A **CNAME** record that "Points the domain at your site". Its value is **customers.spamanagement.co**.
   Each name and value has a **Copy** button.
4. After adding the records, they click **Check now**. The platform also checks automatically.
5. The status moves from **Pending** to **Verifying** to **Active**: "Connected — your website and online booking answer on this address."
6. When it is **Active**, they click **Make primary**. From then on, visitors to the free address (for example saffron-spa.spamanagement.co) are sent on to the own domain.

   ![The spa's Settings → Domains.](../../../shots/platform/dom-spa-settings.png)

   *In the screenshot:*

   1. **Free address**: the spa's spamanagement.co address, which always works.
   2. The own domain, **Active** and the **Primary address**.
   3. **DNS records**: the TXT and CNAME records with **Copy** buttons.
   4. **Domain requests**: domains the spa asked you to buy.

> **Tip:** DNS changes usually show up within minutes but can take up to 48 hours. The records must stay in place after the domain connects.

> **Tip:** Each spa can have one own domain. The certificate for the secure (https) address is issued by the server on the domain's first visit.

> **Important:** Because the platform does not use Cloudflare, spas see the note "Automatic SSL is not switched on yet" on this page. The server still issues each domain's certificate on its first visit, so a spa's domain works with https. If a spa asks about the note, you can reassure them.

## Check domains in the console

1. Click **Domains** in the sidebar.
2. A yellow note says **Cloudflare for SaaS is not configured yet**. This is normal: domains are verified by DNS and point at customers.spamanagement.co, and the server issues their certificates on the first visit.
3. The cards count the domains: **Active**, **Pending**, **Verifying** and **Failed**.
4. Filter with **All**, **Pending**, **Verifying**, **Active** or **Failed**, or type in **Search domain or spa**.
5. The columns are **Domain** (with the spa), **Status** (for example **active** and **primary**), **Last check** (with the last error, for example "CNAME not found") and **Cloudflare**.
6. Use the buttons on each row:
   - **Re-check**: runs the checks now.
   - **Activate**: makes a domain live without the DNS checks. Use it only when you are sure the records are right. It is written to the audit log.
   - **Deactivate**: the spa's site stops answering on that domain until it is re-checked.
   - **Remove**: takes the domain off the spa and frees it, so its real owner can connect it.

   ![Every custom domain and purchase request.](../../../shots/platform/dom-console-list.png)

   *In the screenshot:*

   1. **Purchase requests**.
   2. Your Namecheap balance.
   3. The yellow **Cloudflare for SaaS is not configured yet** note. The status cards (**Active**, **Pending**, **Verifying**, **Failed**) follow below the purchase requests.
   4. **Re-check**, **Deactivate** (or **Activate**) and **Remove**.

> **Important:** **Remove** cannot be undone from the console. The spa has to add the domain again and redo the DNS checks.

> **Tip:** A **failed** domain usually means a DNS record is missing or wrong. Ask the spa to compare its records with the ones on its **Domains** page, then click **Re-check**.

## Approve a domain purchase

1. The spa searches for a name under **Settings** → **Domains** → **Buy a domain** and clicks **Request**. The spa sees the yearly price before it asks.
2. In the console, open **Domains**. **Purchase requests** lists each request with the **Domain**, the **Price** (with your markup) and the **Status**, plus any note from the spa.
3. Check the domain and the price. Your Namecheap balance is shown at the top right, for example "Balance USD 120.00".
4. Click **Approve & buy** and confirm. The prompt reads, for example: "Buy lotusbayspa-demo.ae for Lotus Bay Spa? USD 22.98 is charged to the Namecheap balance now."
5. The domain is bought on Namecheap and pointed at the spa's website. A message confirms it, for example "Bought lotusbayspa-demo.ae and pointed it at the spa". The spa sees "Registered — it connects automatically within an hour."
6. To refuse, click **Decline** and give an optional reason for the spa.
7. If a purchase fails, the row shows **Retry purchase**.

> **Important:** The price is the registrar's price plus your **Domain markup (USD)** from **Company** settings (USD 10 by default, added once per order). Nothing is billed to the spa automatically. To charge the spa, create a **New invoice** on its page (chapter 6).

> **Important:** Buying needs the Namecheap settings on the server and the server's address allowed in your Namecheap account. Otherwise the console shows **Namecheap not configured** or **Namecheap unreachable — check the API whitelist**. Ask Claude to check the Namecheap settings (chapter 24), and in your Namecheap account allow the server's address for API access.
