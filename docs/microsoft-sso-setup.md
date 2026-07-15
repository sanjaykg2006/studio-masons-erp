# Microsoft (Azure / Entra ID) sign-in — setup guide

Goal: let people sign in to the ERP with their existing company Microsoft
account (the one they use for Outlook/Teams), instead of a password or an
emailed invite link.

Model chosen: **invite-first**. You still add each person (and their role) in
**Access Control** first; they then log in with Microsoft. Someone with a
company account who was never added sees nothing until you give them a role.

There are three parts. Part A needs your IT admin. Parts B and C we do after.

---

## Part A — For your IT admin (in the Azure / Microsoft Entra portal)

Please register one application so our ERP can use Microsoft sign-in.

1. Go to **https://entra.microsoft.com** (or portal.azure.com → **Microsoft
   Entra ID**) → **App registrations** → **New registration**.
2. **Name:** `Studio-Masons ERP` (anything is fine).
3. **Supported account types:** choose
   **"Accounts in this organizational directory only (single tenant)"** —
   we only want our own company's people to sign in.
4. **Redirect URI:** platform **Web**, and paste this exact address:

   ```
   https://qqjlwnmfulvzukstmvpu.supabase.co/auth/v1/callback
   ```

5. Click **Register**.
6. On the app's **Overview** page, copy these two values:
   - **Application (client) ID**
   - **Directory (tenant) ID**
7. Go to **Certificates & secrets** → **New client secret** → set expiry
   (e.g. 24 months) → **Add**. Copy the secret **Value** immediately (it is
   only shown once — the "Value" column, not the "Secret ID").
8. (Usually already present) Under **API permissions**, make sure Microsoft
   Graph delegated permissions **openid**, **email**, and **profile** are
   listed. Add them if missing.

**Please send back these three things:**
- Application (client) ID
- Directory (tenant) ID
- Client secret **Value**

(These let the ERP verify Microsoft logins. The secret is sensitive — please
share it privately, not in a public channel.)

---

## Part B — For you (in Supabase), once IT sends the three values

1. Go to **supabase.com** → your project → **Authentication** → **Providers**.
2. Find **Azure** → toggle it **on**.
3. Fill in:
   - **Application (client) ID** → the Application (client) ID from IT.
   - **Secret Value** → the client secret Value from IT.
   - **Azure Tenant URL** →
     `https://login.microsoftonline.com/<DIRECTORY_TENANT_ID>`
     (paste the Directory/tenant ID from IT in place of `<DIRECTORY_TENANT_ID>`).
4. Confirm the **Callback URL** shown on that page matches the redirect URI in
   Part A step 4. **Save.**

Tell me when this is done — that's my cue to switch on the button.

---

## Part C — For me (in the ERP code)

- Add a **"Sign in with Microsoft"** button to the login screen.
- Make sure a person you invited is matched to their Microsoft account by email,
  so they land straight on their dashboard with the right role.
- Deploy. Then you test by signing in with your own Microsoft account.

---

## Notes

- Nothing here is turned on for users until Part C is deployed, so this can be
  prepared safely without affecting anyone currently testing.
- Supabase project ref: `qqjlwnmfulvzukstmvpu`
- The redirect/callback address the ERP uses:
  `https://qqjlwnmfulvzukstmvpu.supabase.co/auth/v1/callback`
