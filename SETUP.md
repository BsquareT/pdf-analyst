# PDF Analyst — Complete Setup Guide
### From zero to a live, shareable app

---

## What You'll Set Up

| Service    | What it does                        | Cost         |
|------------|-------------------------------------|--------------|
| Supabase   | Database + user login               | Free tier    |
| Vercel     | Hosts the website                   | Free tier    |
| Razorpay   | Collects payments in INR            | Free account |
| Anthropic  | Powers the AI analysis              | Pay per use  |
| GitHub     | Stores your code                    | Free         |

Total setup time: **45–60 minutes** (mostly waiting for accounts).

---

## PART 1 — Supabase (Database + Auth)

### Step 1.1 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (free).
2. Click **New Project**.
3. Choose a name (e.g., `pdf-analyst`), set a strong database password, pick a region close to India (e.g., **ap-south-1 Mumbai**).
4. Click **Create new project**. Wait about 2 minutes for it to spin up.

### Step 1.2 — Run the database schema

1. In your Supabase project, click **SQL Editor** in the left sidebar.
2. Click **New Query**.
3. Open the file `supabase-schema.sql` from this project folder.
4. Copy the entire contents and paste it into the SQL editor.
5. Click **Run** (green button).
6. You should see `Success. No rows returned` — that means it worked.

This creates 3 tables:
- `profiles` — stores every user's name, email, approval status, question quota, membership
- `qa_cache` — stores every question + answer (for smart caching)
- `payments` — records every Razorpay payment

### Step 1.3 — Get your API keys

1. In Supabase, go to **Settings → API**.
2. Copy and save these three values — you'll need them later:
   - **Project URL** → looks like `https://abcdefgh.supabase.co`
   - **anon public** key → long string starting with `eyJ...`
   - **service_role** key → another long string (keep this secret — never put it in frontend code)

### Step 1.4 — Configure auth settings

1. In Supabase, go to **Authentication → Settings**.
2. Under **Email Auth**, make sure **Enable email confirmations** is turned **OFF** (otherwise users have to confirm email before you can approve them — simpler to keep it off).
3. Click **Save**.

---

## PART 2 — Razorpay (Payments)

### Step 2.1 — Create a Razorpay account

1. Go to [razorpay.com](https://razorpay.com) and sign up.
2. Complete KYC (you'll need your PAN card and bank account details).
3. While waiting for KYC approval (can take 1–2 days), you can use **Test Mode** to test payments.

### Step 2.2 — Get your API keys

1. In Razorpay dashboard, go to **Settings → API Keys**.
2. Click **Generate Test Key** (for testing) or **Generate Live Key** (after KYC approval).
3. Copy:
   - **Key ID** → starts with `rzp_test_...` (or `rzp_live_...` for production)
   - **Key Secret** → shown only once, copy it immediately

> ⚠️ To actually receive real money, you MUST use live keys after KYC is approved.
> During testing, use test keys — no real money is charged.

**Test card for Razorpay (use during testing):**
- Card number: `4111 1111 1111 1111`
- Expiry: any future date
- CVV: any 3 digits
- OTP: `1234`

---

## PART 3 — Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com) and sign up.
2. Go to **API Keys → Create Key**.
3. Copy the key — it starts with `sk-ant-...`.
4. Add some credits (minimum $5). Every question costs roughly $0.01–0.03 depending on document size. With smart caching, repeated questions cost nothing.

---

## PART 4 — Put the Code on GitHub

### Step 4.1 — Install Git (if you don't have it)

- **Windows**: Download from [git-scm.com](https://git-scm.com/download/win)
- **Mac**: Open Terminal and run `git --version` — it'll prompt you to install if needed
- **Linux**: `sudo apt install git`

### Step 4.2 — Create a GitHub account

Go to [github.com](https://github.com) and sign up (free).

### Step 4.3 — Push your code

Open a terminal (Command Prompt on Windows, Terminal on Mac/Linux) in the `pdf-analyst` folder:

```bash
# Install dependencies first
npm install

# Initialize git
git init
git add .
git commit -m "Initial commit"

# Create repo on GitHub (do this on github.com → New repository → name it pdf-analyst → Create)
# Then connect and push:
git remote add origin https://github.com/YOUR_USERNAME/pdf-analyst.git
git branch -M main
git push -u origin main
```

Replace `YOUR_USERNAME` with your actual GitHub username.

---

## PART 5 — Deploy on Vercel

### Step 5.1 — Create a Vercel account

Go to [vercel.com](https://vercel.com) and sign up with your GitHub account.

### Step 5.2 — Import your project

1. On Vercel dashboard, click **Add New → Project**.
2. Click **Import** next to your `pdf-analyst` repository.
3. Leave all settings as default.
4. **DO NOT click Deploy yet** — you need to add environment variables first.

### Step 5.3 — Add environment variables

In the **Environment Variables** section (before deploying), add all of these one by one:

| Name                              | Value                          |
|-----------------------------------|--------------------------------|
| `ANTHROPIC_API_KEY`               | `sk-ant-...your key...`        |
| `NEXT_PUBLIC_SUPABASE_URL`        | `https://xxxxx.supabase.co`    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | `eyJ...your anon key...`       |
| `SUPABASE_SERVICE_KEY`            | `eyJ...your service key...`    |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID`     | `rzp_test_...` or `rzp_live_...` |
| `RAZORPAY_KEY_SECRET`             | `your_razorpay_secret`         |

### Step 5.4 — Deploy

Click **Deploy**. Vercel will build and deploy your app in about 2 minutes.

When it's done, you'll get a URL like `https://pdf-analyst-yourname.vercel.app`.

**That URL is your shareable app link.** Send it to anyone.

---

## PART 6 — How to Approve Users

When someone signs up, they see a "Waiting for approval" screen. You approve them manually:

1. Go to your Supabase project → **Table Editor → profiles**.
2. Find the row with their email.
3. Click the row, find the `approved` column, change it from `false` to `true`.
4. Click **Save**.
5. The user can now sign in and use the app.

> **Tip**: You can also write a small Supabase Edge Function later to email you when someone signs up. But for now, just check the table manually or have users message you.

---

## PART 7 — Testing Everything Locally (Optional)

If you want to test before deploying:

```bash
# 1. Copy the example env file
cp .env.local.example .env.local

# 2. Open .env.local in any text editor and fill in all your keys

# 3. Install dependencies
npm install

# 4. Run the app
npm run dev

# 5. Open http://localhost:3000 in your browser
```

---

## PART 8 — Going Live with Real Payments

Once Razorpay approves your KYC:

1. Go to Razorpay → **Settings → API Keys → Generate Live Key**.
2. Copy the new live Key ID and Key Secret.
3. In Vercel, go to your project → **Settings → Environment Variables**.
4. Update `NEXT_PUBLIC_RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` with your live keys.
5. Redeploy: go to Vercel → your project → **Deployments → Redeploy**.

Real payments will now go to your Razorpay account and settle to your bank in 2 business days.

---

## How Smart Caching Works (For Your Understanding)

When a user asks a question:

1. **Exact match check** — normalize the question (remove stop words, sort alphabetically) and look for an identical stored question about the same file. If found → return instantly, no API cost.

2. **Fuzzy match check** — compare the normalized question against the top 80 most-asked cached questions using Jaccard similarity. If similarity > 68% → return the cached answer, no API cost.

3. **Real Claude call** — only if no cache hit. Claude analyzes the document, returns the answer, which is then stored for future cache hits.

**Result**: If 10 students all ask "What is Newton's third law?" from the same textbook, Claude is only called **once**. The other 9 get instant answers from cache.

---

## Pricing You're Charging vs What You Pay

| Plan        | You Charge | Your Cost (approx)             |
|-------------|------------|--------------------------------|
| Free tier   | ₹0         | ~₹1–2 (20 questions × ₹0.1)   |
| 20 questions| ₹200       | ~₹2 per pack                   |
| 8-day       | ₹500       | ~₹10–30 (depends on usage)    |
| Lifetime    | ₹800       | ~₹2–5/month ongoing           |

With caching, your real per-question cost drops significantly over time as the cache fills up.

---

## Common Issues & Fixes

**"User can log in but sees a blank page"**
→ Their profile might not have been created by the trigger. Go to Supabase → profiles table, check if their row exists. If not, insert it manually.

**"Payment opens but nothing happens after paying"**
→ You're probably still on test mode. Make sure you're using test card `4111 1111 1111 1111` with OTP `1234`.

**"File upload fails on Vercel"**
→ Vercel free tier has a 4.5MB request limit. For large PDFs, either upgrade to Vercel Pro (paid) or use Railway.app (free, no request size limit). Railway setup takes 10 minutes and works identically.

**"Extraction works locally but not on Vercel"**
→ Check the Function Logs in Vercel dashboard. Usually it's a timeout — the `vercel.json` file sets 60s max duration, which should be enough.

**"I want to reset someone's question count"**
→ Supabase → profiles → find their row → edit `questions_remaining` to 20 (or any number).

---

## Files in This Project

```
pdf-analyst/
├── components/
│   ├── Layout.js          ← Hamburger menu + sidebar
│   └── PaymentModal.js    ← ₹200/₹500/₹800 payment popup
├── lib/
│   ├── supabase.js        ← Database client
│   └── similarity.js      ← Smart question matching
├── pages/
│   ├── index.js           ← Main dashboard
│   ├── login.js           ← Sign in / sign up
│   ├── pending.js         ← Waiting for approval
│   ├── public-pulse.js    ← Public Q&A browser
│   └── api/
│       ├── extract.js     ← PDF/PPTX text extraction
│       ├── analyze.js     ← Claude AI + caching + quota
│       ├── profile.js     ← User profile/quota API
│       ├── payment/
│       │   ├── create-order.js  ← Start Razorpay payment
│       │   └── verify.js        ← Confirm payment + update plan
│       └── qa/
│           └── list.js    ← Public Pulse data
├── styles/
│   └── globals.css
├── supabase-schema.sql    ← Run this in Supabase SQL Editor
├── vercel.json            ← Increase function timeout to 60s
├── next.config.mjs
├── package.json
└── SETUP.md               ← This file
```

---

## Need Help?

If something isn't working:
1. Check the browser console (F12 → Console tab) for red error messages.
2. Check Vercel → your project → **Functions** tab for server errors.
3. Check Supabase → **Logs** for database errors.

The error message will almost always tell you exactly what's wrong.
