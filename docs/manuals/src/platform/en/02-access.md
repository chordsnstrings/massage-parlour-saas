# 2. Your super-admin login and two-step verification

## What this is for

This chapter shows how to get into the console safely. Every super-admin has a verified email address and an authenticator app on their phone. Nobody gets in with a password alone.

## Create a super-admin login

Only email addresses on the super-admin list can create a login. The list is a server setting called PLATFORM_ADMIN_EMAILS (see "Add another super-admin" below).

1. Open **admin.spamanagement.co**.
2. Under the sign-in form, click **Create a super-admin account**. You can also open admin.spamanagement.co/join directly.

   ![The super-admin sign-in page.](../../../shots/platform/access-login.png)

   *In the screenshot:*

   1. **Email** and **Password**.
   2. **Forgot password?** It opens the reset page on app.spamanagement.co.
   3. **Create a super-admin account**.

3. Enter **Your name**, **Email** and **Password**. The password needs at least 10 characters.
4. Click **Create super-admin account**.

   ![Creating a super-admin login.](../../../shots/platform/access-join-form.png)

   *In the screenshot:*

   1. **Your name**.
   2. **Email**. It must be on the super-admin list.
   3. **Password**, at least 10 characters.

5. The page changes to **Confirm your email**. Open the confirmation email we sent you and click its link.
6. Click **Open the console**. You now set up two-step verification (next section).

> **Important:** An address that is not on the list sees "This email address cannot create a super-admin account." Spas never use this page. They apply on the sign-up page instead (chapter 4).

> **Tip:** No email arrived? On the **Confirm your email** page click **Send the link again**. If email is not set up yet (chapter 15), another super-admin can confirm your address for you (see "Add another super-admin" below). You can also click **Sign out** there.

> **Tip:** To stop abuse, one network can create at most 5 logins per hour and 20 per day. If you see "Too many attempts from your network. Please try again later.", wait and try again.

## Turn on two-step verification (required)

The console does not open until two-step verification is on.

1. On your first visit, the console sends you to **Account & security**. A yellow notice says: "Super-admin access needs two-step verification. Set it up below, then open the platform console again."
2. Under **Two-step verification**, type your password in **Confirm your password**.
3. Click **Set up**.
4. A QR code appears. Open an authenticator app on your phone (Google Authenticator, 1Password or Authy) and scan the code.
5. Type the **6-digit code** that the app shows and click **Verify & turn on**.

   ![Setting up the authenticator app.](../../../shots/platform/access-2fa-setup.png)

   *In the screenshot:*

   1. The notice: super-admin access needs two-step verification.
   2. The QR code to scan with your authenticator app.
   3. The field for the 6-digit code.
   4. **Verify & turn on**.

6. The page shows your backup codes: "Save these backup codes somewhere safe. Each works once." Save them, then click **Done**.
7. Click **Open the platform console** in the notice at the top. The console opens.

> **Important:** Keep the backup codes somewhere safe and away from your phone, for example in a password manager. They are the only way in if you lose your phone.

> **Important:** If you turn two-step verification off for a super-admin login, the console locks again until it is turned back on.

## Signing in every day

1. Go to **admin.spamanagement.co**.
2. Enter your **Email** and **Password** and click **Sign in**.
3. The **Two-step verification** page opens. Enter the **6-digit code** from your authenticator app.
4. Tick **Trust this device for 30 days** only on your own computer. Then this computer does not ask for a code for 30 days.
5. Click **Verify**.

   ![The two-step code during sign-in.](../../../shots/platform/access-2fa-signin.png)

   *In the screenshot:*

   1. **6-digit code**.
   2. **Trust this device for 30 days**.
   3. **Use a backup code**.

6. Lost your phone? Click **Use a backup code** and type one of your saved codes instead. To go back, click **Use authenticator app instead**.

> **Important:** Never tick **Trust this device for 30 days** on a shared or public computer.

> **Tip:** After five wrong codes, the sign-in attempt stops. Start again from the sign-in page.

## Forgot your password

1. On the sign-in page, click **Forgot password?**. It opens **Reset your password** on app.spamanagement.co.
2. Enter your email and click **Send reset link**. The page says: "If that email has an account, a reset link is on its way."
3. Open the email and click the link.
4. On **Choose a new password**, type a **New password** and click **Set password**.
5. You see "Password updated. Please sign in." Go back to admin.spamanagement.co and sign in.

> **Important:** A reset link works only once and expires after a while. If you see "This link is invalid or has expired.", click **Request a new one**.

> **Important:** Password reset emails need email to be set up (chapter 15). Set it up before you need it.

## Change your name or password

1. Click your name at the bottom of the sidebar and choose **Account & security**. (The same menu has **Sign out**.)
2. To change your name, edit **Name** under **Profile** and click **Save**.
3. To change your password, fill **Current password** and **New password** under **Password** and click **Update password**. Your other devices are signed out.

## Add another super-admin

1. Ask Claude to add the person's email address to PLATFORM_ADMIN_EMAILS. It is a small change that goes through the normal review (chapter 19).
2. When the change is live, the person creates their login at **admin.spamanagement.co/join** (see the first section of this chapter).
3. If email is not working yet, open **Company** and find the **Super-admins** card. Under **Listed, not a super-admin yet**, click **Mark email verified** next to their address. If their email is already verified, the button reads **Make super-admin now**.
4. The new super-admin sets up two-step verification on their first visit.

   ![Company → Super-admins.](../../../shots/platform/access-superadmins-card.png)

   *In the screenshot:*

   1. The **You** badge marks your own login.
   2. The **Two-step** column shows whether each super-admin has two-step verification on (**2FA on**).
   3. **Listed, not a super-admin yet**: addresses on the list that have not finished joining.
   4. **Mark email verified**: confirms the address when email is not working yet.

The badges under **Listed, not a super-admin yet** mean:

- **No login yet**: the person has not created a login at /join.
- **Email not verified**: they created a login but did not click the email link.
- **Verified · promoted on first console visit**: they become a super-admin the first time they open the console.
- **Login closed**: that login was closed (for example after a rejected spa application).

> **Important:** Only a super-admin who has two-step verification on can confirm someone else. The console cannot remove or demote a super-admin, and taking an address off the list does not demote an existing super-admin. Ask Claude if you ever need to remove one.

> **Tip:** A super-admin whose address is no longer on the list shows the badge **Not in PLATFORM_ADMIN_EMAILS**.
