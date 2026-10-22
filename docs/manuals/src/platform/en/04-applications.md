# 4. Applications: accepting new spas

## What this is for

Every new spa starts as an application from the website. You check the application, then accept it or reject it. Accepting creates the spa, its owner login, its subscription and its invoices in one step.

## How a spa applies

1. The spa clicks **Apply for your spa** (or **Get started**) on spamanagement.co. The form **Apply for your spa** opens on app.spamanagement.co/signup.
2. Under **Your login**, they fill **Your name**, **Work email** and **Password** (at least 10 characters).
3. Under **Your spa**, they fill:
   - **Mobile number** (a UAE mobile number).
   - **Spa name**.
   - **Web address**. The form checks it while they type and shows, for example, "jasmine-touch.spamanagement.co is available".
   - **Emirate** and **Street address**.
   - **Logo (optional)**: PNG, JPG or WebP.
   - **Plan**: the plans you offer, with the setup fee and the monthly price.
   - **Preferred start date**.
   - **Notes (optional)**.
4. They click **Send application**.

   ![The application form a new spa fills in.](../../../shots/platform/apps-signup-form.png)

   *In the screenshot:*

   1. **Your login**: the applicant's name, work email and password.
   2. **Web address**, with the live check underneath.
   3. **Plan**.
   4. **Preferred start date**.
   5. **Send application**.

5. Their login is created at once, but it is locked. Until you accept, they only see the status of their application.
6. You get an email, and the **Applications** badge in the console goes up by one.

> **Tip:** One login can have only one pending application at a time. While an application is pending, its web address is held for it, so nobody else can take it.

> **Important:** To stop abuse, one network can send at most 5 applications per hour and 20 per day. When the bot check is set up (chapter 15), the form also checks that the applicant is a person.

## Review the list

1. Click **Applications** in the sidebar.
2. Use the filters at the top: **Pending**, **Accepted**, **Rejected** or **All**. Each filter shows how many applications it holds.
3. Pending applications come first, oldest first. The applicant who has waited longest is at the top.
4. The columns are **Spa**, **Applicant**, **Mobile**, **Emirate**, **Plan**, **Start**, **Sent** and **Status**.
5. Click a spa name to open the application.

   ![Applications, waiting ones first.](../../../shots/platform/apps-list-shot.png)

   *In the screenshot:*

   1. The status filters with their counts.
   2. The oldest pending application, at the top.
   3. The status badge (**pending**).

## Check an application

1. **What they sent** shows every field from the form, the time it was sent and the logo.
2. Next to **Web address**, a badge checks the address again right now. It shows one of:
   - **Available**: the address is free.
   - **Taken by an existing spa**.
   - **A renamed spa's previous address (reserved for 12 months)**.
   - **Held by another pending application**.
   - **Not a valid address**.
3. If the plan they chose is no longer offered, the **Plan** row says "(no longer offered)". When you accept, the sheet asks you to choose another plan.
4. On the right, the **Review** card has the **Accept** and **Reject** buttons.

   ![One application with the live address check.](../../../shots/platform/apps-detail-shot.png)

   *In the screenshot:*

   1. **What they sent**.
   2. The web address check badge (**Available**).
   3. **Accept**.
   4. **Reject**.

> **Tip:** Click the applicant's email address to write to them from your own email program. Call the mobile number if you want to talk before you decide.

> **Important:** If the web address is not available, accepting stops with "That address is taken." Ask the applicant to apply again with another address.

## Accept and create the spa

1. Click **Accept**. The **Accept application** sheet opens.
2. Check **Plan**. Only the plans you offer are listed, for example **Premium** or **Standard**. The prices exclude VAT.
3. Optional: give a discount. Under **Setup fee discount** and **Monthly fee discount**, choose **%** or **AED** and type the amount. The sheet then shows the new monthly fee.
4. Check **Start date**. The subscription runs one year from this date, and its invoices start here.
5. Under **Setup payment**, tick or untick **Charge VAT (5%)**. The sheet shows the setup invoice total.
6. Choose **Paid in full** or **Deposit**.
7. For a deposit, enter **Deposit amount (AED)**. It must be more than AED 0 and less than the setup invoice total.
8. For a deposit, choose when the rest is due under **Balance due**: **On the start / delivery date** or **10 days after start**. The dates are shown next to each choice.
9. Enter the **Payment date** (today or earlier) and the **Method**: **Cash**, **Bank transfer** or **Credit card**.
10. Optional: add a **Reference (optional)**, for example the bank transfer number, and a **Note (optional)**.
11. Click **Accept and create spa**.

    ![Accepting with a deposit by bank transfer.](../../../shots/platform/apps-accept-sheet.png)

    *In the screenshot:*

    1. **Plan**.
    2. **Setup fee discount** and **Monthly fee discount**.
    3. **Start date**.
    4. **Charge VAT (5%)**.
    5. **Paid in full** or **Deposit**.
    6. **Balance due**.
    7. **Accept and create spa**.

12. A message confirms it, for example: "Jasmine Touch Spa is live · invoice SM-… · balance due AED 5,450 by 4 Nov 2026 · 12 subscription invoices from 25 Oct 2026".

When you accept, all of this happens in one step:

- The spa is created and active.
- The applicant's login becomes the spa owner's login. The owner must set up two-step verification.
- A first branch is created with the street address and emirate from the application.
- The subscription starts on the start date and runs for 12 months.
- The setup invoice is issued and your payment is recorded on it.
- All of the plan's invoices for the year are issued at once: 12 monthly invoices, or 1 yearly invoice.
- The logo is saved.
- The applicant gets an email with a link to sign in.

The application now shows **Accepted** with **Open the spa** and a summary of the setup payment. To continue with the new spa, see chapter 18.

> **Important:** Payments are **recorded, never processed**. Accepting does not charge anyone. You type in money that you have already received in cash, by bank transfer or on your own card machine.

> **Tip:** If the setup fee is discounted to 0, or the plan has no setup fee, no setup invoice or payment is recorded. The sheet says so.

## Reject an application

1. Click **Reject**. The **Reject application** sheet opens.
2. Optional: write a **Reason (optional)**.
3. Tick **Show reason to applicant** if the applicant should read the reason in their email. Leave it unticked to keep the reason for your own records.
4. Click **Reject application**.

   ![Rejecting an application.](../../../shots/platform/apps-reject-sheet.png)

   *In the screenshot:*

   1. **Reason (optional)**.
   2. **Show reason to applicant**.
   3. **Reject application**.

5. A message confirms it: "Application rejected · login closed".

> **Important:** Rejecting closes the applicant's login and signs them out, unless that login already belongs to another spa or to a super-admin. They get a short email. The reason is included only if you ticked **Show reason to applicant**. A closed login cannot be reopened from the console.
