# 10. Websites and the Website Studio

## What this is for

You build and publish every spa's website as part of the service. This chapter shows the **Websites** page, each spa's website page in the console (the Website Studio), **Write texts** and the page editor. You publish directly: there is no review or approval step for the spa. Spas keep their services and prices up to date and send you change requests. Their prices, team and opening hours show live on the site.

## The Websites page

1. Click **Websites** in the sidebar. The page says: "Every spa's website, built and published here. The spa sends change requests."
2. The cards at the top count the sites: **Not started**, **In progress**, **Live** and **Open change requests**.
3. The table lists every spa with:
   - **Spa**: the name, the spa's short name (for example /saffron-spa), and either "Not live" or how many pages are live, and when the site was last updated. Click the name to open that spa's Website Studio.
   - **Website**: a badge that shows where the site stands: **Not started**, **Template chosen**, **Draft** or **Live**. A live site with changes that are not published yet also shows "Unpublished changes".
   - **Requests**: how many of the spa's change requests are open, for example **2 open**. Click it to go straight to the requests.
   - **Next step**: one button for what to do next: **Choose template**, **Continue editing**, **Publish** or **Open site**.
4. Spas with open requests come first, then the sites that are furthest from going live.

What each badge means, and what its **Next step** button does:

| Badge | What it means | Next step |
|---|---|---|
| **Not started** | No template has been chosen yet. | **Choose template** opens the templates on the Studio page. |
| **Template chosen** | A template is in place, with only its sample pages. | **Continue editing** opens the home page in the editor. |
| **Draft** | Someone has written a page (by hand or with **Write texts**), but nothing is live yet. | **Publish** opens the Studio page with the **Publish your site?** sheet. |
| **Live** | At least one page is published. | **Open site** opens the live site. With "Unpublished changes", the button is **Publish**. |

![Every spa's website.](../../../shots/platform/web-list.png)

*In the screenshot:*

1. The status cards.
2. The **Websites** badge in the sidebar: the number of open change requests.
3. A spa's name (here Lotus Bay Spa). Click it to open its Website Studio.
4. A **Website** badge (**Live**, with "Unpublished changes").
5. **Requests** (**2 open**).
6. A **Next step** button (**Publish**).
7. The **Connect Claude or ChatGPT** card (chapter 11).

> **Tip:** The Website Studio opens right here in the console, on admin.spamanagement.co (for example admin.spamanagement.co/websites/saffron-spa). You don't need to sign in on app.spamanagement.co for it. The spa never sees the design tools. Old links to the studio in a spa's dashboard (app.spamanagement.co/{slug}/website) bring a super-admin to the console page.

## Start a new site from a template

1. On the **Websites** page, click **Choose template** next to a spa without a website (or click its name). The Studio page opens. Its status strip shows **Not started** and "Pick a template below."
2. The card **Choose a template** says: "Each preview uses the spa's own services, team and hours. You can switch later without losing words."
3. Scroll through the templates. Each card shows a picture of the template (with a sample spa), its name and a short description. Templates you made yourself carry a **Studio** badge (chapter 12).
4. Click **Try on** to open the template full size in a new tab, with this spa's own services, team and hours.
5. Click **Use {template}**, for example **Use Zen Minimal**, to create the site from it. A message confirms it, for example "Zen Minimal applied". The badge changes to **Template chosen** and the status strip says "Write the texts, then adjust each page."
6. Next, click **Write texts** to draft every page from the spa's own details (see "Write texts with AI" below), or click **Edit** on a page to write it by hand.

   ![Choosing the first template.](../../../shots/platform/web-choose-template.png)

   *In the screenshot:*

   1. The status strip (**Not started**).
   2. A template thumbnail (sample content).
   3. **Try on**.
   4. **Use Zen Minimal**.

> **Tip:** There are 23 built-in templates (8 classic designs and 15 newer designs), plus every studio template you have made available.

## The Studio page

The Studio page has everything for one spa's website. To open it, click the spa's name on the **Websites** page, or **Edit website** at the top of the spa's page in **Spas** (chapter 6). At the top are a **Websites** link back to the list, the spa's name, and its address with the languages (English · Arabic).

**The buttons at the top** (they appear once the spa has a site):

- **Write texts**: the AI drafts the texts of every page (see "Write texts with AI" below). Every super-admin with two-step verification on sees it (see the box in that section).
- **Preview**: opens a draft of the whole site in a new tab, with every change that is not published yet.
- **Open site**: opens the live site. It appears once a page is live.
- **Publish site**: appears only when something is not published yet. It publishes everything that is waiting at once (see "Publish" below).

**The status strip** under the buttons shows the **Website** badge and the next step. For example: "Pick a template below.", "Write the texts, then adjust each page.", "Ready? Publish to make it live.", "1 page has unpublished changes." or "Live at www.saffronspa-demo.ae." When the spa has open requests, a link such as **2 open requests** jumps to them.

**The cards:**

1. **Pages** (full width, at the top): every page with its **Status** (**Live**, **Unpublished changes** or **Not published**), an **In menu** switch (**Visible** / **Hidden**) and **Edit**, which opens the page editor full screen. Above the list are **Import from website** and **Add page**. A page with an HTML design also shows a design note under its row (see "Pages with an HTML design" below).
2. **Website**: a preview, the address, the languages (English · Arabic), the template name, **Copy link** and **Theme**.
3. **Change requests**: what the spa asked for, open requests first (see "Change requests from the spa" below).
4. **Blog**: blog posts (see "Blog posts" below).
5. **Site at a glance**: visitors and booking conversion for the last 30 days. Its **Performance** link opens the spa on the console's **Performance** page (chapter 9).
6. **Domain & security**: the spa's address or own domain, with **Manage domains** (chapter 13).
7. **Templates** (last): other looks to try on this site. The template in use has a **Current** badge.

   ![A spa's Website Studio.](../../../shots/platform/web-studio-page.png)

   *In the screenshot:*

   1. **Write texts**.
   2. **Preview**.
   3. **Open site**.
   4. **Publish site**.
   5. The status strip (**Live**, "Unpublished changes").
   6. **Pages**, with **Import from website**, **Add page**, the **In menu** switches and **Edit**.
   7. **Website**, with **Copy link** and **Theme**.
   8. **Change requests** (this spa has none yet).
   9. **Blog**.
   10. **Site at a glance**.
   11. **Domain & security**.
   12. **Templates**.

### Change the theme

1. In the **Website** card, click **Theme**. The sheet says: "Fine-tune the template. Changes are live on your site right away."
2. Set what you need:
   - **Accent colour** (buttons, links, highlights) and **Text on accent** (keep it readable).
   - **Headings**: **Serif — classic, calm** or **Sans — clean, modern**.
   - **Corners**: **Square**, **Soft** or **Round**.
   - **Buttons**: **Square**, **Rounded** or **Pill**.
   - **Spacing**: **Compact**, **Comfortable** or **Airy**.
   - **Hero art** and **Hero emblem**: decoration for the top section of the home page.
   - **Motion**: **None**, **Subtle** or **Expressive**. Visitors who prefer reduced motion always get gentle fades.
3. Click **Save theme**. Visitors see the change straight away.

   ![The Theme sheet.](../../../shots/platform/web-theme-sheet.png)

   *In the screenshot:*

   1. **Accent colour**.
   2. **Headings**.
   3. **Corners**. **Buttons** and **Spacing** are just below it.
   4. **Motion**.
   5. **Save theme**.

> **Important:** Theme changes go live at once, without publishing. Check the colours on a phone before you save.

### Switch to another template

1. In **Templates**, click **Apply** on the template you want.
2. The sheet **Switch to {name}?** (for example **Switch to Dark Luxury?**) shows the site **Now** and **After** the switch. What it says depends on the template:
   - A built-in or studio template: "Colours, fonts, shapes and motion change right away. Your words and images stay."
   - An uploaded HTML design: "Its design replaces your pages with the same address as drafts. Nothing changes on your live site until you publish." **Also start from its sample pages** is already ticked and can't be changed, and the spa's theme stays as it is.
3. Optional, for block templates only: tick **Also start from its sample pages**. It replaces the pages with the template's layout as drafts. Nothing changes on the live site until you publish.
4. Click **Switch to {name}** (for example **Switch to Dark Luxury**).
5. A message confirms it, for example "Dark Luxury applied". For an HTML design with **CRM contract v2** it adds ". Write texts is drafting its texts." or ". Write texts skipped: {reason}." (see "Write texts with AI" below).
6. A bar appears with what changed, for example "Switched from Desert Sand to Dark Luxury", and an **Undo** button.
7. **Undo** is offered for at most 7 days after the switch. It goes away sooner when you change the theme (or, if you started from the sample pages, when you edit or publish the new drafts).
8. For an HTML design that brings its own data (window.CRM_DATA), the card **Next: fill the CRM from the design** appears too (see "Fill the CRM from an HTML design" below).

### Undo a version upgrade

When you roll out a new version of an HTML template (chapter 12, "Upload a new version and roll it out"), each spa that switched gets an **Undo** on its Studio page.

1. Open the spa's Studio page. The bar at the top says "{template}: upgraded to version N", for example "Seaside Scenes: upgraded to version 2".
2. Its text reads: "Upgraded to version N on {date}. Undo re-publishes the previous version and puts back your draft — available until this page is edited or published again."
3. Click **Undo**. A message confirms "Back to version N-1 (re-published)", for example "Back to version 1 (re-published)".

   ![A spa switched to the new version, with its Undo.](../../../shots/platform/web-upgrade-undo.png)

   *In the screenshot:*

   1. The upgrade bar.
   2. **Undo**.
   3. The line "Write texts after the upgrade: …" on the **Pages** card.

> **Important:** **Undo** here re-publishes at once: visitors see the previous version straight away. Later roll outs of that version leave this spa as it is ("kept on version N-1 (its upgrade was undone)"). The bar is offered for 7 days at most.

### Pages

1. Click **Edit** on a page to open the editor full screen (see "The drag-and-drop editor" below).
2. Use the **In menu** switch to show or hide a page in the site's menu. The home page is always visible.
3. Click **Add page** to add a page from a designed page template. It is added as a draft with the site's theme and live prices.

### Pages with an HTML design

Under each page that uses an HTML design, the **Pages** card shows a short note about the design:

1. A badge: **CRM contract v2**, **CRM contract** or **Not connected to the CRM**.
2. The design report line, for example "CRM contract v2 · 38 editable values (12 interface texts) · 64 of 70 page texts editable · 2 warnings", and up to 5 warnings under it (chapter 12, "Read the design report").
3. **Fill the CRM**, only for a design that brings its own data (window.CRM_DATA). See "Fill the CRM from an HTML design" below.
4. After a switch or a roll out, the line "Write texts after the switch: …" or "Write texts after the upgrade: …". It says how that run stands:
   - "queued" or "running": it is still writing.
   - What it wrote, for example "Drafted texts for 1 page in English and Arabic (Home 42). … Nothing is published."
   - "skipped: {reason}": it did not run, and says why (see "Write texts with AI" below).
   - "failed: …", for example "failed: could not run — use Write texts": click **Write texts** at the top of the page to run it yourself.
5. For a design that is **Not connected to the CRM**, the text "Page texts, pictures and {{placeholders}} still work. To connect it, ask Claude or ChatGPT (spamanagement.co connector): ‘…’". Click **Copy prompt** and paste it into the assistant (chapter 11). The assistant converts the design as a draft.

   ![An HTML design connected to the CRM, just applied.](../../../shots/platform/web-studio-design.png)

   *In the screenshot:*

   1. The switch bar, with **Undo**.
   2. The card **Next: fill the CRM from the design**.
   3. The badge **CRM contract v2**.
   4. The design report line.
   5. **Fill the CRM**.
   6. The line "Write texts after the switch: …".

## Write texts with AI

**Write texts** fills in the words of a whole site in one go. Use it right after you choose a template, or when a spa's details have changed a lot. On a page with an HTML design it writes that page's website content.

1. On the Studio page, click **Write texts**. The sheet **Write texts with AI** opens: "Drafts the texts of every page in English and Arabic from the spa's own details: name, services and prices, branches, opening hours and contact. Images and layout stay as they are."
2. Optional: fill **Anything to highlight? (optional)**, for example "Female therapists available" or "free parking, open until 2 am". The AI already uses the spa's services, prices, branches, hours, contact and brand voice.
3. Click **Write texts**. The button shows that it is working. It can take a minute or two.

   ![The Write texts sheet, with a note for the AI.](../../../shots/platform/web-write-sheet.png)

   *In the screenshot:*

   1. **Anything to highlight? (optional)**.
   2. **Write texts**.

4. When it is done, a message says what was written, for example "Drafted texts for 5 pages in English and Arabic (Home 48, Treatments 11, About 20, Gallery 11, Contact 19). Nothing is published — read each page, adjust, then Publish."
5. The sheet lists every page it wrote, for example "Home · 48 texts", each with **Open editor**. If a page was skipped, the message names it and says why, for example "open in Daniel Reyes's editor".
6. Click **Open editor** to read a page in English and Arabic and adjust it. Or click **Write again** for a new version, or **Done** to close the sheet.

   ![The result: every page drafted, nothing published.](../../../shots/platform/web-write-done.png)

   *In the screenshot:*

   1. The result message.
   2. **Open editor** for a page.
   3. **Write again**.
   4. **Done**.

7. The spa's **Website** badge now shows **Draft** (or "Unpublished changes" on a live site).
8. When you are happy with every page, click **Publish site** (see "Publish" below).

What Write texts does and does not do:

- It changes text only: headings, paragraphs, buttons, questions and answers, page titles. Images, layout, colours and links stay exactly as they are.
- It uses only the spa's own details and your note. It never invents awards, offers, services or prices, makes no health claims and uses no "best in Dubai" claims.
- Prices, opening hours, addresses and phone numbers appear only where the page is about them, exactly as in the spa's dashboard.
- On an HTML-design page it writes the page's **Website content** in English and Arabic: the design's own texts and its page texts, including the page title and search description. It never changes tags, pictures or texts the design fills from the CRM, and the design file never changes.
- A page it could not write is skipped, with the reason: "open in {name}'s editor" (someone else has it open), "the draft uses another design", "no texts to write" or "could not be saved — run again".
- If a page already had a draft written by hand, that draft is kept as a version named "Before Write texts" with the date. Open **Versions & preview** in the editor to restore it.
- It never publishes.

> **Important:** **Write texts** is shown to AI site editors who have two-step verification on (the server setting SITE_AI_EDITOR_EMAILS). On the live platform this is "*", which means every super-admin with two-step verification on; no verified email address is needed, the same rule as for signing in to the console. Only if the setting is a named list of addresses must your address be on that list and verified. The site also needs at least one page. Every run is written to the audit log and counts toward the spa's AI budget.

> **Tip:** After you apply an HTML design with **CRM contract v2**, or roll out a new version of one (chapter 12), Write texts runs by itself for its pages. It writes drafts only and never writes over what was written for the spa. How it stands shows on the **Pages** card (see "Pages with an HTML design" above). It is skipped, with the reason, when you are not an AI site editor with two-step verification ("needs SITE_AI_EDITOR_EMAILS + 2FA"), when AI isn't set up ("AI writing isn’t set up"), or when the old design was made for that spa ("made for this spa").

> **Tip:** If the sheet says "AI isn't set up yet", the ModelArk key (ARK_API_KEY) is not on the server yet. Add it to the encrypted secrets file (chapter 24). If **Write texts** stops with the message "AI site editing is switched off in the AI model settings", tick **Enabled** for **Website Studio AI edits** in **AI models** (chapter 16). You can still edit every word in the editor.

## Fill the CRM from an HTML design

Some HTML designs bring their own treatments, photos, descriptions and team photos. This puts them into the spa's CRM, so the website and the dashboard show the same menu and team.

1. Right after you apply such a design, the card **Next: fill the CRM from the design** says: "The design brings its own treatment photos, descriptions and team photos. Put them into the spa’s CRM (missing treatments can be created); prices stay as they are." Click **Fill the CRM from the design**, or **Not now**. Later, use **Fill the CRM** on the page's row in **Pages**.
2. The sheet **Fill the CRM from the design** opens: "{page}: the design’s treatments, photos and descriptions into this spa’s CRM." It also says: "These change the CRM right away (treatments and therapists); the website shows them on its next load. Prices are never changed."
3. Under **Treatments in the design**, each row shows the design's treatment with "CRM: {name}" (the matching treatment in the CRM) or "Not in the CRM", its durations, and a badge: **Same name**, **Similar · N%** or **No match**. For each row choose:
   - **Fill photo & description** (only when it matched a CRM treatment).
   - **Create in CRM**: adds it as a new treatment.
   - **Skip**: leaves it out.
4. Optional: tick **Replace existing photos**: "Also over the photos and descriptions the CRM already has. Without it, only empty ones are filled. Created treatments get the design’s durations, price on request."
5. Under **Team photos in the design**, pick a therapist for each photo (**Nobody**, or a name; "(has a photo)" marks one who already has one) and tick **Show on website**.
6. Click **Fill the CRM**. A message says what changed, for example "CRM updated: 2 treatments filled, 1 treatment created, 2 therapist photos set, 5 new pictures in the media library", or "Nothing to change: the CRM already has these".

   ![Filling the CRM from the design.](../../../shots/platform/web-seed-sheet.png)

   *In the screenshot:*

   1. The note on what changes.
   2. A treatment row with its badge.
   3. The choice for that treatment.
   4. **Replace existing photos**.
   5. A team photo, with a therapist picked and **Show on website** ticked.
   6. **Fill the CRM**.

> **Important:** This changes the spa's CRM at once. It is not a draft. Prices and durations of existing treatments never change. Created treatments can be booked online with price on request, so ask the spa to add their prices. **Replace existing photos** writes over the English description only; the Arabic one stays.

> **Tip:** Every picture of the design also goes into the spa's media library, once. If the design changed while the sheet was open, the message says "This page’s design changed since the preview: open “Fill the CRM” again to see it as it is now".

## Import from the spa's old website

1. In **Pages**, click **Import from website**. The sheet **Import from existing website** opens.
2. Type the **Current website address**.
3. Optional: change the **New page address** and the **Page name**. The page is added as a hidden draft.
4. Optional, for AI site editors: tick **Arrange the content with AI**. It counts toward the spa's AI budget. Without it, a standard layout is used.
5. Click **Fetch and preview**.
6. Check what was found on the site: the headline, **Sections**, **Treatments & prices**, **Hours & contact** and **Photos**.
7. Check what the new page will contain, under "The draft page /imported will contain" (with your page address).
8. Click **Create draft page**. A message confirms "Imported as a draft page — not published".

   ![Importing an existing website as a draft.](../../../shots/platform/web-import-sheet.png)

   *In the screenshot:*

   1. The site that was read and how many pages were read (here a demo site on a test computer).
   2. What was found on the site.
   3. **Create draft page**.

> **Tip:** Import is a quick start, not a finished page. Open the new page in the editor, tidy it up, then publish it.


## The drag-and-drop editor

1. On the Studio page, click **Edit** on a page. The editor opens full screen, without the console menu.
2. The top bar has, from left to right:
   - **Back to console**: back to the spa's Studio page. Then the page name and the save status, for example "Draft saved · 11 min ago".
   - **Viewport**: **Mobile 375**, **Tablet 768** and **Desktop 1280**.
   - **Content language**: **EN** (Edit English) and **AR** (Edit Arabic).
   - **Undo** and **Redo**.
   - **Preview draft** (the eye).
   - **Block analytics** (the chart): visits to this page in the last 30 days.
   - **Ask AI** (the sparkle).
   - **Versions & preview** (the clock).
   - **Save draft** and **Publish**.
3. On the left are three tabs: **Blocks**, **Outline** and **Library**.
   - **Blocks** lists the building blocks: layout (Section, Columns, Stack, Spacer), content (Hero, Heading, Text, Buttons, Image, Gallery, Video) and blocks that show live data from the spa's dashboard, such as **Services menu**.
   - **Outline** shows the page as a list, so you can find and select a block.
   - **Library** has ready designed sections in groups: **Heroes**, **Services & prices**, **About**, **Team**, **Offers**, **Reviews & trust**, **FAQ**, **Contact & hours**, **Calls to action**, **Video & blog** and **3D motion**.
4. Drag a block or a section onto the page.
5. Click a block on the page to select it. Its fields appear on the right. Change the texts, images and settings there.
6. To style a block for one device only, switch the **Viewport** first, then change the style.

   ![The page editor.](../../../shots/platform/web-editor-shot.png)

   *In the screenshot:*

   1. **Back to console**.
   2. **Viewport**.
   3. **Content language** (**EN** / **AR**).
   4. The blocks list on the left.
   5. The fields of the selected block.
   6. **Save draft**.
   7. **Publish**.

7. To reuse a section you styled, select it, open **Library** → **Saved** and click **Save selected {block}** (for example **Save selected Hero**). Give it a **Name**. Tick **Global section** if you want to "Edit it once and every page that shows it updates."
8. Your work saves itself every 2 seconds. The status under the page name shows "Draft saved · …".

> **Important:** Saving keeps a draft only. Visitors see nothing until you publish (see "Publish" below).

> **Tip:** Write the English first, then click **AR** and add the Arabic. Fields that still need Arabic are listed when you publish.

### When someone else is editing

Only one person can edit a page at a time.

1. If another super-admin has the page open, you see, for example: "Daniel Reyes is editing this page — view only. Take over to edit (they switch to view only)."
2. Click **Take over** to edit. The other person's screen switches to view only; their unsaved changes are kept on their device.

   ![When someone else is editing the page.](../../../shots/platform/web-editor-lock.png)

   *In the screenshot:*

   1. The lock banner.
   2. **Take over**.

3. Leave the editor with **Back to console**, so the page is free again for others straight away. Otherwise it frees itself a few minutes after you close the tab.
4. If an AI assistant (Claude or ChatGPT) or another editor saved the page while you had it open, you see **Changed elsewhere (an AI assistant or another editor).** Click **Reload** to get their version, or **Keep mine** to keep yours.
5. If the browser closed before your last change was saved, the editor offers the unsaved copy from this device: click **Restore** or **Discard**.

## Website content of an HTML-design page

An HTML design keeps its layout, but its words and pictures can change for each spa. What visitors see is filled in this order: first the spa's CRM (live, no publishing needed), then this spa's website content (draft, then publish, in English and Arabic), and last the design's own values. Only the values change, never the layout, styles or scripts.

1. On the Studio page, click **Edit** on a page with an HTML design. The editor opens with the design selected and the field **Website content** on the right.
2. The field starts with: "Words and pictures of this spa's site, over the design's own. Name, phones, address, hours, treatments, prices and team come live from the CRM." It ends with how many values you changed, for example "1 changed." (or "Nothing changed yet."). A design without window.CRM_DATA says instead: "This design has no window.CRM_DATA: its story data is part of the file. Page texts and pictures below still change per spa."
3. Pick the language with **EN** or **AR** in the top bar.
4. The amber box "{N} still from the design" lists texts that still belong to the design, not to this spa. For example "Scene · Welcome · Text: names another city". The other reasons are "names the design's spa", "has a phone number", "has an email address", "test or filler text", "no Arabic yet" and "no longer in the design". Click an item to jump to its field.
5. The fields are in groups, for example **Scene · {menu label}** (such as **Scene · Welcome**), **Experience 2**, **Booking** and **WhatsApp messages**. The fields include **Menu label**, **Small top line**, **Title**, **Text**, **Tags**, **Show the buttons**, **Picture**, **Picture description**, **Picture focus**, **Accent colour**, **Logo on dark backgrounds**, **WhatsApp message**, **WhatsApp message (with a treatment)** and **Button label**. Under each field, "Design: {value}" shows the design's own value.
6. Type the spa's words. The page on the canvas updates a moment after you stop typing. **Design** puts the design's value back. **Hide**, where it is offered, takes that value off this spa's site; the field then says "Hidden on this spa's site."
7. **Page texts (N)** has "Every heading, button, link, picture description, the page title and the search description."
   - Use the search box **Search page texts** to find one.
   - Each row is named by what it is and the design's words, for example "Heading: Our rituals".
   - Some rows can't be typed in: they say "Filled by the design from the CRM." or "Filled by the design's script.". Where a row has **Go to field**, click it to jump to the field that sets that text.
   - "Outdated: the design changed here." marks a text the design no longer has. Click **Remove** to clear it.
8. **Pictures (N)** has "This spa's own pictures in the design's places; the design's framing stays." Click **Replace the design picture** and pick one from the media library or paste an https address. For a video, **Upload video** takes an MP4 or WebM file up to 8 MB ("Videos can be up to 8 MB.").
9. Your changes save as a draft. Publish them as usual (see "Publish" below).

   ![The Website content of an HTML-design page.](../../../shots/platform/web-content-panel.png)

   *In the screenshot:*

   1. **EN** / **AR**.
   2. The intro, with how many values are changed ("3 changed.").
   3. The box "3 still from the design".
   4. A group heading (**Scene · Welcome**).
   5. A changed field (**Menu label**, here "Arrival"), with **Design** and **Hide**.
   6. **Publish**.

> **Important:** The design file never changes here. To change the design for every spa, upload a new version (chapter 12). The spa changes its name, phones, address, hours, treatments, prices and team in its own CRM (chapter 12, "Designs connected to the CRM").

> **Tip:** Arabic texts show inside the design's own left-to-right layout on the Arabic page. A text can be Arabic only; the English page then keeps the design's words. WhatsApp message texts stay English on the Arabic page on purpose, because the spa's staff read them.

## Ask AI to edit a page

1. In the editor, click **Ask AI** (the sparkle). The panel **Ask AI to edit** opens.
2. Type what should change, in any language. For example: "Add a short FAQ about parking and couples massage after the services", "Rewrite the hero in Arabic" or "Make all pages gold".
3. Click **Preview change**.

   ![Ask AI edits the draft; you decide.](../../../shots/platform/web-askai-panel.png)

   *In the screenshot:*

   1. **Ask AI**.
   2. The instruction.

4. The canvas shows the change: "Previewing on the canvas — nothing is saved yet." The panel lists the **Proposed changes**.
5. Click **Apply to draft** to keep it, or **Discard** to throw it away.
6. To go back later, click **Undo AI change** under **Recent AI changes**.

On an HTML-design page, Ask AI changes that page's **Website content** (its texts in English and Arabic, its values and its pictures) as one draft change. It never changes the design file. A text it saw cut short is left out, with a note.

> **Important:** Ask AI only changes the draft. It never publishes. You still check and publish yourself. Theme changes from Ask AI are saved as a draft theme for every page and go live when you publish.

> **Important:** Ask AI is for AI site editors who have two-step verification on (the setting SITE_AI_EDITOR_EMAILS). On the live platform that is every super-admin with two-step verification on; no verified email address is needed. Only if the setting is a named list of addresses must your address be on that list and verified. Every AI change is written to the audit log.

## Versions and preview links

1. In the editor, click **Versions & preview** (the clock). The sheet says: "Every publish is kept, and so is a draft once you name it or restore over it."
2. Under **History** you see every version with its date and who made it. The current one is marked **Current**; published ones are marked **Published**.
3. To name a version, click the pencil next to it (**Name this version**), type a name such as "Before Ramadan" and save. Write texts names the draft it replaces "Before Write texts" by itself.
4. To go back to an older version, click **Restore** next to it. It becomes the new draft; publish it to make it live.
5. To share the draft with someone, go to **Share a preview of the draft**. Under **Link expires after**, choose **1 day**, **7 days** or **30 days**.
6. Click **Create link** (or **Create a new link**).
7. Click **Copy link**, or let the person scan the QR code. Anyone with the link can view the draft without signing in. The sheet shows when the link expires (Dubai time).

   ![Version history and a shareable preview link.](../../../shots/platform/web-versions-sheet.png)

   *In the screenshot:*

   1. **History**.
   2. **Link expires after**.
   3. **Copy link**.
   4. The QR code.

> **Tip:** A preview link is the easiest way to show a spa owner their new site before it goes live.

## Publish

You publish yourself. There is no step where the spa reviews or approves the site first: when you click **Publish now**, visitors see it straight away. Show the spa a preview link first if you want their opinion (see "Versions and preview links" above).

**Publish one page from the editor:**

1. In the editor, click **Publish**. The sheet **Publish {page}?** (for example **Publish Home?**) opens: "Visitors will see this version straight away. You can keep editing afterwards."
2. Read the **Preflight** checks. The line shows how many errors and warnings there are.
3. Fix every **Error**: click **Go to block** to jump to the problem. For example, images must be served over https. Errors block publishing.
4. **Warning** rows do not block publishing ("Warnings don't block publishing."). For missing Arabic text, a fix button can add it, or **Translate all with AI** when there are several.
5. **Also goes live** lists other changes that will publish together with this page, for example a new theme or a renamed page.
6. On an HTML-design page, the box **Website content: N still from the design** lists the first 5 texts that still come from the design, with their reasons (see "Website content of an HTML-design page" above). It says "These don’t block publishing." Click **Open Website content** to fix them first.
7. Click **Publish now**. A message confirms "Published — your page is live". Visitors see the page straight away.

   ![Publishing with preflight checks.](../../../shots/platform/web-publish-sheet.png)

   *In the screenshot:*

   1. **Preflight**, with the number of warnings.
   2. A warning, with **Go to block**.
   3. **Publish now**.

   **Also goes live** is not in this picture, because nothing else was waiting to publish.

**Publish every waiting page at once:**

1. On the Studio page, click **Publish site**. It appears only when something is waiting. The **Publish** button on the **Websites** page opens the same sheet.
2. The sheet **Publish your site?** says what will go live, for example "1 page has unpublished changes. Visitors will see them immediately." A waiting theme (for example one made by Ask AI, Claude or ChatGPT) is listed too. If that theme makes text hard to read on a page, **Theme checks** lists it. These are warnings only.
3. Click **Publish now**. A message confirms it, for example "Published 1 page".

   ![Publishing everything that is waiting.](../../../shots/platform/web-publish-site-sheet.png)

   *In the screenshot:*

   1. What will go live.
   2. **Publish now**.

> **Important:** Publishing stops if a page still has an error (for example an image that is not served over https). Open that page in the editor, fix it, then publish again.

## Blog posts

1. On the Studio page, in **Blog**, click **New post**.
2. Fill **Title**, **Web address** (lowercase letters, numbers and dashes, for example hot-stone-benefits), **Summary (shown in the list)**, **Article** and **Cover photo**.
3. Optional: fill the **Arabic (optional)** fields and **Search results** (**Search title**, **Search description**).
4. Click **Save**. The post stays a draft.
5. Click **Publish** to put it on the site. Later, use **Unpublish** or **Delete post**.

> **Tip:** In **Article**, a blank line starts a new paragraph, a line starting with "## " is a sub-heading and "- " starts a bullet. A published post shows in the Blog list block, in search results and in the sitemap.

## Change requests from the spa

Spas ask you for changes from their own **Website** page (see "What the spa can change" below). This is the round trip:

1. The spa sends a request, for the whole site or for one page.
2. You see it straight away. The **Websites** item in the sidebar shows a badge with the number of open requests. On the **Websites** page, the **Open change requests** card counts them, and the spa's row shows, for example, **2 open** under **Requests**.
3. Click **2 open**. The Studio page opens at **Change requests**. (If you click the spa's name instead, the page opens at the top; the link **2 open requests** in the status strip jumps down to them.) Open requests come first. Each one shows what the spa wrote, the page (or "Whole site") and when it was sent.

   ![A spa's change requests in the console.](../../../shots/platform/web-requests-card.png)

   *In the screenshot:*

   1. What the spa asked for.
   2. The page ("Whole site") and when it was sent.
   3. **Mark done**.
   4. Your note on a closed request, shown as "Studio: …".
   5. A closed request (**Done**).

4. Make the change in the Studio or in the editor, and publish it.
5. Next to the request, click **Mark done**. The sheet **Close this request** opens: "The spa sees the outcome and your note next to their request."
6. Choose the **Outcome**: **Done** or **Declined**.
7. Optional: write a **Note to the spa (optional)**, for example what you changed, or why you declined.
8. Click **Close request**. A message confirms "Marked done" (or "Declined"). The spa sees the outcome and your note under **Your requests**, and the badge count goes down.

   ![Closing a request with a note to the spa.](../../../shots/platform/web-request-sheet.png)

   *In the screenshot:*

   1. **Outcome**.
   2. **Note to the spa (optional)**.
   3. **Close request**.

> **Tip:** Close every request, even with **Declined** and a short note, so the spa knows you read it.

## What the spa can change

The spa does not edit, review or approve its website. It keeps its menu current and asks you for everything else.

1. When the spa owner opens **Website studio** in their dashboard (app.spamanagement.co), they see their **Website** page. It has no design, publish or review tools. It says: "Our studio designs and publishes your website. Keep your services and prices current here, and ask us for any other change."
2. **Your website** shows a preview, marked **Live** (or **In progress** while you build it: "Preview of the latest version from our studio — not live yet."). **Copy link** and **View live site** are at the top once the site is live.
3. **Services & prices**: "What your website lists. Changes show on your live site straight away — no publishing needed." Each service shows its durations, prices and **On the website** or **Not on the website**. The owner (or a manager) clicks **Edit** to change the name, description, durations or prices.
4. **Request a change**: "Tell our studio what you'd like changed. We update your site and reply here." The owner picks the **Page** (or **Whole site**), fills **What should change?** and clicks **Send to studio**. New photos go into **Media** first.
5. **Your requests**: every request with its status (**Open**, **Done** or **Declined**) and your note, shown as "Studio: …".

   ![The spa owner's Website page.](../../../shots/platform/web-spa-services.png)

   *In the screenshot:*

   1. **Your website**: the preview, with the **Live** badge.
   2. **View live site**. **Copy link** is next to it.
   3. **Services & prices**.
   4. **Request a change**.
   5. **Your requests**: two open, and one **Done** with the studio's note.

On an HTML design connected to the CRM, the spa's CRM feeds the site live: its name and logo, treatments with prices and photos, therapists with **Show on website** on, phones, WhatsApp, address, map pin, area name and opening hours. Booking requests from such a design's booking form land in the spa's **Inbox & follow-ups** → **Enquiries** (chapter 12, "Designs connected to the CRM").

> **Tip:** The Spa Owner's Manual explains this page to the spa in the same words.
