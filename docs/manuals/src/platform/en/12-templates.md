# 12. Site templates and HTML designs

## What this is for

Templates are the looks a spa's website can start from. Besides the built-in templates, you can save a finished spa site as a template, import a template file, or upload a hand-made HTML design that shows exactly as it was built. An HTML design can take each spa's details live from its CRM. You update an HTML design for every spa that uses it by uploading a new version.

## Studio and built-in templates

1. Click **Site templates** in the sidebar. The page lists your own studio templates and the 23 built-in templates. A studio template with the same key as a built-in template replaces it.
2. At the top right are three buttons: **Upload HTML**, **Import JSON** and **Save a spa's site**.
3. **Studio templates** lists the templates you made. The columns are **Template** (with its key and description), **Pages**, **Status** (**Active** or **Hidden**), **Order** and **Updated**.
4. Each row has:
   - **Preview**: opens the template.
   - **Export**: downloads the template as a file, for example to import it on another copy of the platform.
   - For HTML designs only:
     - **Preview version N**: opens the version that waits for your sign-off. On a wide screen its button reads **Preview**.
     - **Sign off version N** or **Roll out to N spas** (see "Upload a new version and roll it out" below).
     - **Discard version N**: drops the version that waits for your sign-off.
     - **Upload new version** (see "Upload a new version and roll it out" below).
     - The **Phone fixes** tick (see "Phone fixes" below).
     - **Images** (see "Adjust the images of an HTML design" below).
   - **Edit** (every row): change **Name**, **Description** (shown to spas under the template name) and **Sort order**, and tick **Spas can pick it**. Then click **Save**.

   **Preview version N**, the roll out button and **Discard version N** appear only when there is something to sign off or roll out.
5. Under the name of an HTML template, a line says where its versions stand. "Version 2 waiting for sign-off · {date} · {report line}" means a new version waits for you. "N spas still on an older version" means some spas have not switched to the current version yet.
6. **Built-in templates** are "Shipped with the app. Export one to start a new studio template from it." A built-in template marked **Replaced** has a studio template with the same key in its place.

   ![Site templates.](../../../shots/platform/tpl-page.png)

   *In the screenshot:*

   1. **Upload HTML**.
   2. **Import JSON**.
   3. **Save a spa's site**.
   4. The version line of an HTML template ("Version 2 waiting for sign-off · …").
   5. **Preview** (the waiting version), **Roll out to 2 spas** and **Discard version 2**.
   6. **Upload new version**.
   7. **Phone fixes**.
   8. **Images** and **Edit**.
   9. **Built-in templates**.

> **Tip:** **Hidden** templates are only visible to you. Check a new template carefully, then tick **Spas can pick it** to show it in the Website Studio as a starting point.

## Use a studio template or HTML design for a spa

1. On the template's row, click **Edit**, tick **Spas can pick it** and click **Save**. The status changes to **Active**. Only active templates appear in the Website Studio.
2. Click **Websites** in the sidebar and open the spa's Studio page.
3. Find the template in the **Templates** card, or in **Choose a template** for a spa without a website yet. It carries a **Studio** badge.
4. Click **Apply** on its card (**Use {template}** for a new site). Chapter 10 explains both.

## Save a spa's site as a template

1. Click **Save a spa's site**. The sheet **Save a spa's site as a template** opens.
2. Choose the **Spa** whose site you want to copy.
3. Enter a **Template name**, for example "Marina Calm".
4. Optional: enter a **Key** (if empty, it is made from the name) and a **Description**.
5. Leave **Spas can pick it right away (otherwise check the preview first)** unticked until you have checked the preview.
6. Click **Save template**.

> **Important:** The template copies the spa's theme and live pages. The spa's name, photos, links, phone numbers and emails are removed, and client reviews become sample quotes. The website content of an HTML-design page is cleaned too: contact details are removed, the spa's name becomes {{spa_name}} and the spa's own uploaded pictures are dropped. A template's website content is copied into a spa when the template is applied. Prices, team and hours stay live for each spa that uses it. Check the preview for anything else that belongs to that one spa before you switch it on.

> **Tip:** You cannot use the key of a built-in template here.

## Import a template

1. Click **Import JSON**. The sheet **Import a template** opens.
2. Choose the **Template file** that you exported earlier, from this console or from another copy of the platform (up to 11 MB: an export includes its HTML designs).
3. Tick **Replace a template with the same key** if you are updating an existing template.
4. Click **Import**.

## Upload an HTML design

An HTML design is a one-page site made outside the platform, for example by a designer. The sheet says it is shown on the spa's site "exactly as built: its styles, fonts, images, motion, scrolling and scripts, full screen and isolated from the platform. It can't be changed in the drag-and-drop editor; upload a new file to update it."

1. Click **Upload HTML**. The sheet **Upload an HTML design** opens.
2. Enter the **Template name** and a **Description** (shown to spas under the template name).
3. Under **HTML file**, choose the .html file: "One .html file up to 5 MB, stored exactly as it is (embedded images and fonts stay in the file)." If the file is larger, the sheet says "The file is X MB; the limit is 5 MB." Then compress the embedded images, or link big videos by their address.
4. Leave **Phone fixes** unticked unless the design needs them: "Off = shown exactly like the file (recommended). On = the platform adds a phone viewport and keeps images and wide elements inside phone screens — this changes how the design looks." The preview follows the tick.
5. Read the design report under the file (see "Read the design report" below).
6. Check the **Preview**. Switch between **360px** (phone) and **1280px** (computer).

   ![Uploading an HTML design: the top of the sheet.](../../../shots/platform/tpl-html-sheet.png)

   *In the screenshot:*

   1. **Template name**.
   2. **HTML file**.
   3. **Phone fixes**.
   4. The design report line.
   5. **Adjust images (N)**: the images found in the file (see "Adjust the images of an HTML design" below).

7. Under **Each spa's details (optional)**, see the placeholders you can put anywhere in the file. Each spa's own details replace them:
   - **{{spa_name}}**: the spa's name.
   - **{{book_url}}**: the online booking page.
   - **{{whatsapp_url}}**: a WhatsApp chat with the spa.
   - **{{phone}}** and **{{phone_url}}**: the phone number, as text and as a tap-to-call link.
   - **{{address}}**: the address. In page text it becomes a Google Maps link.
   - **{{map_url}}**: the spa's exact Google Maps pin (set in its branch settings), or else a Maps search for its address.
   - **{{site_url}}**: the spa's website address.
   - **{{crm_data_url}}**: this page's CRM data feed, for designs that fetch it (`<meta name="crm-endpoint" content="{{crm_data_url}}">`).
8. Optional: tick **Replace a template with the same key** to replace an earlier upload with this name. The new file is used at once for every spa that applies the template from now on. Spas already using it stay on the old file, and the row then says "N spas still on an older version": click **Roll out to N spas** to switch them (see "Upload a new version and roll it out" below). To check a new file before anyone gets it, use **Upload new version** instead.
9. Optional: tick **Spas can pick it right away (otherwise check the preview first)**.
10. Click **Upload**. A message confirms it, for example "{name} uploaded — hidden from spas until you switch it on. Stored exactly as the file."
    - A design connected to the CRM adds: "CRM data contract found: services, prices, hours, phones, address and staff (opt-in) come live from each spa’s CRM."
    - A design that embeds other pages or players adds a warning: "It embeds pages or players from …; … many video players, maps and booking widgets stay blank — check the preview; a plain link to them always works."
    - The message ends with the design report line.

    ![The end of the same sheet, scrolled down.](../../../shots/platform/tpl-html-sheet-end.png)

    *In the screenshot:*

    1. The list of placeholders.
    2. **Spas can pick it right away**.
    3. **Upload**.

> **Important:** The layout of an HTML design can't be changed in the drag-and-drop editor. Its words and pictures change per spa in **Website content** (chapter 10). The design itself changes for all spas with **Upload new version** (see "Upload a new version and roll it out" below).

> **Important:** The design runs isolated from the platform. It cannot read sign-ins or any other platform data, so it is safe to show.

### Read the design report

Under the chosen file, the sheet shows how much of the design can change per spa. For example:

- "CRM contract v2 · 38 editable values (12 interface texts) · 64 of 70 page texts editable · 2 warnings": the design is connected to the CRM.
- "Not connected to the CRM · 40 page texts editable": the design keeps its own data, but its page texts can still change per spa.

Under the line are up to 5 warnings, for example:

- "The page title is fixed text ("…"); use {{spa_name}}."
- "Team cards have no data-if="photo": a therapist without a photo shows an empty frame."
- "The design's defaults name a spa ("…"): other spas see them only where noted."
- "Arabic texts fall back to the visitor's system font."

The report never blocks the upload. The same line shows on the template's version row and on each spa's **Pages** card (chapter 10, "Pages with an HTML design").

### Phone fixes

1. Each HTML design row has a **Phone fixes** tick. Tick or untick it to switch them on or off for the template.
2. A message confirms it, for example "Phone fixes on for {name}. Spas already using it keep their copy — re-apply the template to update them."
3. "· old upload: re-upload to show exactly" next to the tick marks a file uploaded before 11 Oct 2026. Its old phone fixes are saved inside the file. To show it exactly as built, upload the original file again with **Replace a template with the same key** ticked.

## Designs connected to the CRM

A design connected to the CRM (a contract design) has a window.CRM_DATA block or the crm-endpoint tag. It takes each spa's details live from that spa's CRM. Changes in the CRM show on the next page load, without publishing.

| What visitors see | Comes from |
|---|---|
| Spa name and logo | The spa's CRM. On **CRM contract v2**, the website logo can also be set in **Website content**. |
| Treatments: name, description (English and Arabic), durations, photo | The spa's services in its CRM. Only treatments that are **Active** and **Bookable online** with a duration. The same English name shows once. |
| Prices | Always the CRM, never the design. A hidden price shows as price on request. |
| Team | Therapists with **Show on website** on and a photo, with the first line of their short bio. |
| Phones, WhatsApp, address, map pin, opening hours | The spa's branches and opening hours. |
| Area name | The main branch's **Area shown on the website** (on the Arabic page: **Area in Arabic (optional)**), else the city. |
| Story, booking and WhatsApp texts, page texts, page title, search description, pictures | The spa's **Website content**, else the design (chapter 10). |
| Book links and the booking form | Always the design's. |

> **Important:** On a design made for another spa, an empty CRM value (logo, phones, WhatsApp, address, hours, treatments) stays empty, and the design hides that part. The design's own values show only on the spa's own design and in template previews.

> **Important:** A therapist without a photo is not shown. If nobody has **Show on website** on, the site shows no team.

> **Tip:** The booking form of a contract design makes a **Booking request** in the spa's **Enquiries**, only when the spa's live site uses a contract design. Nothing is booked: the spa confirms on WhatsApp. In previews, nothing is stored.

> **Tip:** **CRM contract v2** is the current contract: Write texts and roll outs draft its texts by themselves. **CRM contract** is an older connected design. To connect a design that is not connected, use **Copy prompt** on the spa's **Pages** card (chapter 10).

## Upload a new version and roll it out

1. On the HTML template's row, click **Upload new version**. The sheet **Upload a new version · {name}** opens: "Version 2 waits for your sign-off: preview it, then Roll out — spas on older versions switch to it at once (their edits are carried, each can undo it). Until then nothing changes for any spa."
2. Choose the **HTML file**. **Phone fixes** starts as the current version has it. A line shows what carries over, for example "From version 1: Phone fixes off · 3 of 3 picture adjustments kept (pictures still in the new file). Spas keep their own phone fixes and adjustments where this version sets none." The design report shows under it.
3. Click **Upload version**. A message confirms "Version 2 uploaded — waiting for your sign-off. {report line}."
4. The row now shows "Version 2 waiting for sign-off · …".
5. Click **Preview version 2** on the row to check the new version (on a wide screen the button reads **Preview**, just before **Roll out to 2 spas**). It opens "{name} · version 2 (waiting for sign-off)". Switch the language with **English** / **عربي**.
6. Click **Roll out to 2 spas** (or **Sign off version 2** when no spa is on an older version). Wait while it says "Finding the spas on older versions…". The sheet **Roll out · {name}** shows:
   - "Roll out = sign-off: version 2 goes live at once for these spas (their edits are carried; each spa can undo it on its page). New spas get version 2 from now on. Write texts then drafts English + Arabic texts for each switched spa (drafts only)."
   - Sometimes a warning: "Write texts will be skipped: {reason}."
   - **Phone fixes and picture adjustments**: what changes between the versions, for example "Phone fixes: version 1 off → version 2 on."
   - "Switched now: 2 spas", with a line per spa, for example "3 pages", "made for this spa", "4 edits kept · 1 not kept", "keeps its phone fixes", "keeps 2 picture adjustments" or "has a draft".
   - "More spas follow: run Roll out again." when there are more spas than one click switches.
   - **Left as they are**: the spas it will not switch, each with the reason (see the table below).
7. Click the button at the bottom (the same label, for example **Roll out to 2 spas**). The window "Version 2 rolled out" shows "Live now: 2 spas", the spas under **Not switched** with their reasons, and "Run again for the rest." when some are left.
8. Each switched spa gets an **Undo** bar on its Studio page (chapter 10, "Undo a version upgrade").

   ![Rolling out a new version to the spas that use the template.](../../../shots/platform/tpl-rollout-sheet.png)

   *In the screenshot:*

   1. The intro: Roll out is the sign-off.
   2. **Phone fixes and picture adjustments**.
   3. "Switched now", with each spa and how many of its edits are kept.
   4. **Left as they are**.
   5. The roll out button.

Why a spa was left as it was:

| Reason | What to do |
|---|---|
| not published yet | The spa's site with this design is not live yet, so there is nothing to upgrade. Apply the template again on its Studio page (chapter 10) so its draft uses the new version, then publish it. |
| its live design file was changed — never overwritten | The spa's live file was changed for that spa (for example by an AI assistant), so Roll out leaves it alone. To give it the new version, apply the template again on its Studio page (chapter 10). |
| kept on version N-1 (its upgrade was undone) | Someone undid the upgrade on this spa's Studio page. It stays on the older version on purpose. |
| open in {name}'s editor | Someone has the spa's page open. Ask them to leave it with **Back to console**, then run Roll out again. |
| already on this version / no longer on an older version | Nothing to do. |
| its website content did not fit the new version (…) | The words in brackets say what did not fit. Check the new version or the spa's **Website content** (chapter 10), then run Roll out again. |
| could not be switched — try again | Run Roll out again. |

> **Important:** Roll out is the sign-off, and it goes live at once: there is no Publish step. Preview the version first. A spa's own changes are carried, its draft is kept after it, and all of a spa's pages switch together.

> **Tip:** One click switches up to 25 spas (about 30 seconds). The spas it could not switch are tried last on the next click, so the other spas get their turn first. If someone uploaded another version meanwhile, the sheet says "This version changed meanwhile — reload the page and check it again." To drop a waiting version, click **Discard version 2**. The message is "Version 2 discarded", and nothing changes for any spa.

## Adjust the images of an HTML design

You can choose what stays in view and swap images without editing the file. With **Phone fixes** on, images also stay inside phone screens.

1. Click **Images** on the HTML design's row (or use **Adjust images** while uploading).
2. Each image is listed with its address. For each one:
   - Drag the dot on the picture to choose what stays in view when the image is cropped.
   - Choose **Fill** or **Fit**.
   - Choose the position: **As designed**, **Left**, **Centre** or **Right**.
   - To swap the image, click **Replace…** and pick one from a spa's media library (choose the spa in **Library of**), or paste an image address under **Or paste an image URL (https://…)**.
3. Check the **Preview** at **360px** and **1280px**.
4. Click **Save images** (or **Upload** when you are uploading a new file).

   ![Adjusting the images of an HTML design.](../../../shots/platform/tpl-images-sheet.png)

   *In the screenshot:*

   1. The list of images.
   2. **Fill** or **Fit** (the dot on each picture sets what stays in view).
   3. The **360px** / **1280px** preview switch.

> **Tip:** A replacement image must use an https:// address or come from a spa's library. A replacement alone only swaps the picture: **Fill** / **Fit**, the dot and the position apply only when you set them.
