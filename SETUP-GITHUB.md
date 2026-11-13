# Put the Belize Number Board on GitHub (free), with daily automatic results

When you're done you'll have:
- a free website at `https://YOUR-NAME.github.io/belize-number-board/` that anyone can open and install on their phone
- a job that runs every morning at 6:23 am Belize time, fetches only the missing results from the magayo API, and updates the site by itself

It takes about 10 minutes. No coding needed.

---

## 1. Create a free GitHub account
Go to https://github.com/signup and sign up (skip if you have one).

## 2. Create the repository
1. Click **+** (top right) → **New repository**.
2. Name: `belize-number-board`
3. Choose **Public**. Free GitHub Pages sites need a public repository. Your API key stays private (step 4).
4. Click **Create repository**.

## 3. Upload the files
1. On the new repository page, click **uploading an existing file**.
2. Open the `github-site` folder on your computer, select **everything inside it** (not the folder itself) and drag it into the browser. You can leave out `update-results-workflow.yml` and this guide; they're only for you.
3. Click **Commit changes**.

**Important: check that the hidden `.github` folder was uploaded.** On the repository's main page you should see a `.github` folder. If it's missing (Windows can hide it):
1. Click **Add file** → **Create new file**.
2. In the name box type exactly: `.github/workflows/update-results.yml`
3. Open `update-results-workflow.yml` (in the `github-site` folder, next to this guide) in Notepad, copy everything, and paste it into the big box. It's the same file, kept visible because Windows hides `.github` folders.
4. Click **Commit changes**.

## 4. Add your magayo API key (kept secret)
1. In the repository, go to **Settings** → **Secrets and variables** → **Actions**.
2. On the **Secrets** tab click **New repository secret**.
   - Name: `MAGAYO_API_KEY`
   - Secret: paste your magayo API key
   - Click **Add secret**.
3. On the **Variables** tab click **New repository variable**.
   - Name: `MONTHLY_API_LIMIT`
   - Value: `10` for the free plan (change it to `100` if you upgrade to Bronze)
   - Click **Add variable**.

Nobody can see the secret after you save it, not even you. To change it, add it again.

## 5. Turn on the website
1. **Settings** → **Pages**.
2. Under **Build and deployment**, Source: **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)** → **Save**.
4. After a minute or two the page shows your site address. Open it on your phone and install it ("Add to Home Screen" on iPhone, "Install app" on Android).

## 6. Run the job once to test it
1. Go to the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.
2. Click **Update Belize results** → **Run workflow** → **Run workflow**.
3. After about 30 seconds, click the run to see its summary: what was added, how many API calls were used and left this month, and anything still missing.

From now on it runs by itself every morning.

---

## Good to know
- **API calls:** the job only calls magayo for draws that are missing from the last 14 days, newest first, and stops at your monthly limit. The count is in `data/api-usage.json` and resets each month. If you also use your key elsewhere (like browser tests), add those calls to that file so the count stays right.
- **The free plan (10 calls a month) won't cover every draw.** All four games need about 62 calls a month. With 10 the job fills the newest gaps first. For fully automatic results, upgrade to magayo Bronze ($13.99/month, 100 calls) and set `MONTHLY_API_LIMIT` to `100`.
- **"No draw" markers** are only saved when magayo itself says there was no draw that day.
- **Results added by hand on a phone** stay on that phone. To add a result for everyone, edit `draws.json` on GitHub (click the file, then the pencil icon).
- **Changing the app later:** after editing `index.html`, `app.css` or `app.js`, change the version name in `sw.js` (for example `boledo-v22` to `boledo-v23`) so phones pick up the new version.
- **magayo's terms** say personal, non-commercial use. Ask magayo before running ads or charging for the app.
- **To stop the job:** Actions tab → Update Belize results → **⋯** → **Disable workflow**.
