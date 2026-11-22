# Beginner's Step-by-Step Guide: Setting Up Google Cloud Secret Manager

Welcome! This guide walks you through setting up **Google Cloud Secret Manager** for **Jack of All Trades** from scratch—no prior cloud security or DevOps experience needed.

---

## What Is Secret Manager (and Why Do We Use It)?

Think of **Google Cloud Secret Manager** as a locked digital safe inside your Google Cloud project.

Instead of typing sensitive passwords and API keys (like your Gemini API key, database password, or Stripe keys) directly into files like `cloudbuild.yaml`—where anyone who sees the code could copy them—you store each secret once inside the safe and give it a **name** (for example, `joat-db-pass`).

Then, in `cloudbuild.yaml`, we only write the **name** of the secret. When Cloud Run starts your app, Google Cloud securely unlocks the safe and hands the real values directly to your running server in memory.

---

## Your Project Details (Already Matched to `cloudbuild.yaml`)

Keep these values handy—you will recognize them as you click through Google Cloud Console:

| Setting | Your Exact Value |
| :--- | :--- |
| **Google Cloud Project ID** | `gemini4nyc26nyc-2273` |
| **Google Cloud Project Number** | `575313344781` |
| **Cloud Run Region** | `us-east1` |
| **Cloud Run Service Name** | `jackofalltrades` |
| **Cloud Run Service Account** | `575313344781-compute@developer.gserviceaccount.com` |

---

## The 5 Secrets Mapped in `cloudbuild.yaml`

Your `cloudbuild.yaml` file expects **all 5 secrets below** to exist in Secret Manager before you deploy. If even one secret is missing, Cloud Run will stop the deployment with a `Secret not found` error.

| Environment Variable in App | Exact Secret Name to Create | What Value Goes Inside? | Not Ready Yet? Safe Starting Value |
| :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | `joat-gemini-api-key` | Your real Gemini API key from Google AI Studio | *(Required for AI scanning/voice)* |
| `DB_PASS` | `joat-db-pass` | Your PostgreSQL `postgres` user password from Cloud SQL | *(Required for Cloud SQL connection)* |
| `AUTH_SESSION_SECRET` | `joat-auth-session-secret` | A random 64-character hex string used to sign login tokens | Generate with `openssl rand -hex 32` (shown below) |
| `STRIPE_SECRET_KEY` | `joat-stripe-secret-key` | Your Stripe Secret Key (`sk_test_...` or `sk_live_...`) | `sk_test_placeholder_change_me` *(safe in `scaffold` mode)* |
| `STRIPE_WEBHOOK_SECRET` | `joat-stripe-webhook-secret` | Your Stripe Webhook Signing Secret (`whsec_...`) | `whsec_placeholder_change_me` *(safe in `scaffold` mode)* |

> **Why are `sk_test_placeholder_change_me` and `whsec_placeholder_change_me` safe?**  
> Your server code (`src/lib/serverStripe.ts`) specifically recognizes those placeholder strings and keeps Stripe safely in **Scaffold (Keys Pending)** mode without crashing Cloud Run. Whenever you create your Stripe account later, you simply add a new version to those two secrets!

---

## Method A: Step-by-Step Using the Google Cloud Console (Click-by-Click, No Coding)

Follow these 6 steps in your web browser.

### Step 1: Open Google Cloud Console and Select Your Project
1. Go to [https://console.cloud.google.com](https://console.cloud.google.com) and sign in with your Google Cloud account (`devstar2273@gcplab.me`).
2. Look at the **top-left dropdown bar** next to the Google Cloud logo.
3. Make sure your project is set to **`gemini4nyc26nyc-2273`**. If another project is selected, click the dropdown and switch to `gemini4nyc26nyc-2273`.

---

### Step 2: Enable the Secret Manager API
1. Click the **search bar** at the very top of Google Cloud Console.
2. Type **`Secret Manager`** and click **Secret Manager** (under Products & Pages).
3. If you see a blue **ENABLE** button, click it and wait about 15–30 seconds until the Secret Manager dashboard loads.
   *(If you already see a **+ CREATE SECRET** button, the API is already enabled—move straight to Step 3!)*

---

### Step 3: Create All 5 Secrets

Repeat the quick sub-steps below **5 times**—once for each secret name in the table above.

1. Click **+ CREATE SECRET** at the top of the Secret Manager page.
2. In the **Name** box, type the **exact secret name** (lowercase, with hyphens, no spaces):
   - Secret #1: `joat-gemini-api-key`
   - Secret #2: `joat-db-pass`
   - Secret #3: `joat-auth-session-secret`
   - Secret #4: `joat-stripe-secret-key`
   - Secret #5: `joat-stripe-webhook-secret`
3. Under **Secret value**, paste the matching value into the text box:
   - **Important Tip:** Do **not** press `Enter` after pasting, and double-check there are no extra blank spaces at the start or end. An accidental newline at the end of a password or API key can cause login or API errors!
   - **How to create a value for `joat-auth-session-secret`:**  
     Click the **`>_` (Activate Cloud Shell)** icon in the top-right corner of Google Cloud Console and run:
     ```bash
     openssl rand -hex 32
     ```
     Copy the 64-character random string it prints and paste it as the secret value.
   - **For Stripe secrets (if you haven't set up Stripe yet):**
     - Paste `sk_test_placeholder_change_me` into `joat-stripe-secret-key`
     - Paste `whsec_placeholder_change_me` into `joat-stripe-webhook-secret`
4. Leave **Regions** set to **Automatic** (default).
5. Scroll to the bottom and click the blue **CREATE SECRET** button.

When finished, your Secret Manager list should show all 5 secrets:
- `joat-gemini-api-key`
- `joat-db-pass`
- `joat-auth-session-secret`
- `joat-stripe-secret-key`
- `joat-stripe-webhook-secret`

---

### Step 4: Give Cloud Run Permission to Read Your Secrets (Critical!)

By default, Secret Manager locks everyone out—even your own Cloud Run app! This is the **#1 reason** first-time setups fail, so do not skip this step.

You can grant permission **once for all secrets** via IAM (easiest for beginners):

1. In the top search bar of Google Cloud Console, type **`IAM`** and click **IAM & Admin → IAM**.
2. Look through the list of Principals for:
   ```text
   575313344781-compute@developer.gserviceaccount.com
   ```
   *(This is the Compute Engine default service account that your Cloud Run service uses in `cloudbuild.yaml`.)*
3. Click the **pencil icon (Edit principal)** on the far right of that row.
   - *(If you don't see it in the list, click **+ GRANT ACCESS** at the top and paste `575313344781-compute@developer.gserviceaccount.com` into **New principals**.)*
4. Click **+ ADD ANOTHER ROLE**.
5. In the **Select a role** box, type **`Secret Manager Secret Accessor`** and click it (`roles/secretmanager.secretAccessor`).
6. Click **SAVE**.

> **What did this just do?** It gave your Cloud Run service (`jackofalltrades`) **read-only** permission to unlock your secrets when starting up—without allowing it to delete or overwrite them.

---

### Step 5: Deploy Your Updated `cloudbuild.yaml` to Cloud Run

Now that all 5 secrets exist and Cloud Run has permission to read them, you can update your Cloud Run service in either of two ways:

#### Option 5A — Using the Cloud Run Web Console (Visual UI)
1. Search for **Cloud Run** in Google Cloud Console and click your **`jackofalltrades`** service.
2. Click **EDIT & DEPLOY NEW REVISION** at the top.
3. Click the **Variables & Secrets** tab.
4. Under **Environment variables**, make sure these non-secret values are set:
   - `NODE_ENV` = `production`
   - `APP_URL` = `https://jackofalltrades-575313344781.us-east1.run.app`
   - `SQL_CONNECTION_NAME` = `gemini4nyc26nyc-2273:us-east1:free-trial-first-project`
   - `DB_HOST` = `/cloudsql/gemini4nyc26nyc-2273:us-east1:free-trial-first-project`
   - `DB_PORT` = `5432`
   - `SQL_PORT` = `5432`
   - `DB_NAME` = `postgres`
   - `SQL_DB_NAME` = `postgres`
   - `DB_USER` = `postgres`
   - `SQL_PUBLIC_IP` = `34.74.102.222`
   - `SQL_OUTGOING_IP` = `34.73.184.213`
   - `SQL_SSL` = `false`
   - `AUTH_ENFORCEMENT_MODE` = `scaffold`
   - `BILLING_ENFORCEMENT_MODE` = `scaffold`
   *(Remove any old plain-text `GEMINI_API_KEY` or `DB_PASS` entries from the plain Environment Variables section so they don't conflict with Secret Manager!)*
5. Scroll down to **Secrets** and click **REFERENCE A SECRET** 5 times:
   - Secret: `joat-gemini-api-key` → Exposed as environment variable → Name: `GEMINI_API_KEY` → Version: `latest`
   - Secret: `joat-db-pass` → Exposed as environment variable → Name: `DB_PASS` → Version: `latest`
   - Secret: `joat-auth-session-secret` → Exposed as environment variable → Name: `AUTH_SESSION_SECRET` → Version: `latest`
   - Secret: `joat-stripe-secret-key` → Exposed as environment variable → Name: `STRIPE_SECRET_KEY` → Version: `latest`
   - Secret: `joat-stripe-webhook-secret` → Exposed as environment variable → Name: `STRIPE_WEBHOOK_SECRET` → Version: `latest`
6. Click **DEPLOY** at the bottom of the page.

#### Option 5B — Using `cloudbuild.yaml` Directly in Cloud Shell
Open **Cloud Shell** (`>_` icon in the top-right of Google Cloud Console), navigate to your repository folder, and run:
```bash
gcloud run services replace cloudbuild.yaml \
  --project=gemini4nyc26nyc-2273 \
  --region=us-east1
```

---

## Method B: Faster All-in-One Cloud Shell Script (Copy & Paste)

If you prefer running commands in **Google Cloud Shell** instead of clicking through menus, click the **`>_`** icon in the top-right of Google Cloud Console and run these blocks one at a time.

### 1. Set your project and turn on Secret Manager
```bash
gcloud config set project gemini4nyc26nyc-2273
gcloud services enable secretmanager.googleapis.com
```

### 2. Create the 5 secrets (you will be prompted to type your Gemini key & DB password safely—they won't appear on screen)
```bash
# 1. Gemini API Key
read -rsp "Paste your GEMINI_API_KEY and press Enter: " GEMINI_VAL && echo ""
printf '%s' "$GEMINI_VAL" | gcloud secrets create joat-gemini-api-key --data-file=- --replication-policy="automatic"
unset GEMINI_VAL

# 2. Cloud SQL PostgreSQL Password
read -rsp "Paste your Cloud SQL DB_PASS and press Enter: " DB_VAL && echo ""
printf '%s' "$DB_VAL" | gcloud secrets create joat-db-pass --data-file=- --replication-policy="automatic"
unset DB_VAL

# 3. Auto-generate a strong 64-character random Auth Session Signing Secret
openssl rand -hex 32 | tr -d '\n' | gcloud secrets create joat-auth-session-secret --data-file=- --replication-policy="automatic"

# 4 & 5. Stripe placeholders (safe while BILLING_ENFORCEMENT_MODE=scaffold)
printf '%s' "sk_test_placeholder_change_me" | gcloud secrets create joat-stripe-secret-key --data-file=- --replication-policy="automatic"
printf '%s' "whsec_placeholder_change_me" | gcloud secrets create joat-stripe-webhook-secret --data-file=- --replication-policy="automatic"
```
> **Note:** We use `printf '%s'` (instead of `echo`) on purpose so no hidden trailing newline gets saved into your secrets!

### 3. Grant Cloud Run read-only access to the secrets
```bash
gcloud projects add-iam-policy-binding gemini4nyc26nyc-2273 \
  --member="serviceAccount:575313344781-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 4. Verify all 5 secrets exist
```bash
gcloud secrets list --project=gemini4nyc26nyc-2273
```

---

## Step 6: Verify Your Live Deployment

After Cloud Run finishes deploying, open these URLs in your browser (or run `curl` in Cloud Shell):

```bash
curl -fsS https://jackofalltrades-575313344781.us-east1.run.app/api/health
curl -fsS https://jackofalltrades-575313344781.us-east1.run.app/api/db/status
curl -fsS https://jackofalltrades-575313344781.us-east1.run.app/api/auth/config
curl -fsS https://jackofalltrades-575313344781.us-east1.run.app/api/billing/config
```

**What "Healthy" Looks Like:**
- `/api/health` shows `"status": "ok"`, `"geminiConfigured": true`, `"postgresConfigured": true`, `"authEnforcementMode": "scaffold"`, `"billingEnforcementMode": "scaffold"`.
- `/api/db/status` shows `"connected": true` and `"pgvector_enabled": true`.
- `/admin` opens cleanly and displays live Cloud SQL status, Ontology data, and the Billing & Auth scaffold cards.

---

## Step 7: Updating a Secret Later (For Example, When You Add Real Stripe Keys)

Whenever you get your real Stripe keys (or rotate your database password):

1. Open **Google Cloud Console → Secret Manager**.
2. Click the secret you want to update (for example, `joat-stripe-secret-key`).
3. Click **+ NEW VERSION**.
4. Paste the new key (e.g., `sk_test_...` or `sk_live_...`) with no trailing spaces or newlines, then click **ADD NEW VERSION**.
5. Because `cloudbuild.yaml` points to `key: latest`, simply click **EDIT & DEPLOY NEW REVISION → DEPLOY** in Cloud Run (without changing any code) so Cloud Run pulls the newest version.
6. When you are ready to enforce real logins and paid credits, change:
   - `AUTH_ENFORCEMENT_MODE` from `scaffold` → `enforced` *(after seeding your first admin user in PostgreSQL `app_users`)*
   - `BILLING_ENFORCEMENT_MODE` from `scaffold` → `enforced` *(after adding real Stripe keys and registering the `/api/billing/webhook` URL in Stripe)*

---

## Quick Troubleshooting Cheatsheet

| Problem You Might See | Cause | Easy Fix |
| :--- | :--- | :--- |
| **`Secret joat-... not found`** during Cloud Run deploy | One of the 5 secrets in `cloudbuild.yaml` has not been created yet (or has a typo in its name). | Open Secret Manager and verify all 5 secret names match the table above character-for-character. |
| **`Permission denied on secret`** during Cloud Run deploy | Step 4 was skipped, so the Cloud Run service account cannot unlock the safe. | Go to **IAM & Admin → IAM**, edit `575313344781-compute@developer.gserviceaccount.com`, and add role **Secret Manager Secret Accessor**. |
| **Database password or Gemini API key rejected** even though it looks right | A hidden trailing newline or extra space was saved in the secret value. | Add a **New Version** to that secret using `printf '%s' "YOUR_VALUE"` in Cloud Shell (or paste cleanly in Console without pressing Enter), then redeploy Cloud Run. |
| **`billingConfigured: false`** in `/api/billing/config` | Expected while using placeholder Stripe values in `scaffold` mode! | No action needed until you are ready to turn on live Stripe billing. |
