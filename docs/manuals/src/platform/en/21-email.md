# 21. Email: what is sent and how ask@ works

## What this is for

Know which emails the platform sends and to whom, and keep **ask@spamanagement.co** receiving mail. The platform has two separate email paths: Resend sends staff email out, and Namecheap Email Forwarding brings mail for ask@ in.

## Emails the platform sends

The platform only sends email to staff, spa owners and super-admins, through Resend (chapter 15). The From address is **spamanagement.co <ask@spamanagement.co>**.

| Email | Who gets it |
|---|---|
| Email verification | Anyone who creates a login. |
| Password reset | Anyone who asks for a new password. |
| Team invite ("You're invited to …") | A new team member a spa invites. |
| Application accepted or rejected | The spa owner who applied (chapter 4). |
| "New spa application: …" | Every super-admin. |
| "New enquiry: …" | Every super-admin, when someone sends the Contact form (chapter 5). You can reply straight to the sender. |
| Billing stage notices, for example "Payment overdue — … becomes read-only on …" and "full access restored" | The spa owner and the super-admins (chapter 7). |
| Server alerts ("[spamanagement] … needs attention") | Every super-admin: disk above 85 %, no off-site backup for 36 hours, deploy failed (chapter 23). |
| Test email | You, when you click **Send test email to me**. |

> **Important:** Spa customers never get email from the platform. Spas contact their clients by WhatsApp click-to-send only: the CRM opens WhatsApp with a ready message, and a person taps Send.

> **Important:** Without a Resend key the live platform refuses to send email. Then sign-up verification and password reset fail. Check the **RESEND_API_KEY (staff email)** row on the Overview (chapter 3).

> **Tip:** "Every super-admin" means every address on the super-admin list on the server (PLATFORM_ADMIN_EMAILS). To change that list, ask Claude (chapter 2).

## How ask@spamanagement.co receives mail

1. Mail sent to ask@spamanagement.co arrives at Namecheap.
2. Namecheap **Email Forwarding** passes it on to your own mailbox.
3. This uses Namecheap's MX and SPF TXT records under **Advanced DNS** (chapter 20).

To change where ask@ mail goes:

1. In Namecheap, open **Domain List** → **Manage** next to spamanagement.co.
2. Find the **Email Forwarding** settings.
3. Change the address that ask@ forwards to.
4. Send a test mail to ask@spamanagement.co and check that it arrives.

> **Important:** Before you add Resend's MX record, read the **Custom MX** warning in chapter 15. Switching Namecheap's **Mail Settings** to **Custom MX** turns off Email Forwarding, and ask@spamanagement.co stops receiving.

> **Tip:** ask@spamanagement.co is the only spamanagement.co address used anywhere: on the website, the legal pages, the default sender and for spas' questions.
