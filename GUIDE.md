# DSMG4EVA on GitHub: step-by-step guide

This guide puts your DSMG4EVA dashboard online for free at a link like
**`https://YOUR-USERNAME.github.io/dsmg4eva/`**. You don't need a server, Google Apps Script, or any coding.

**How it works:** GitHub stores the files. Every ~15 minutes, a GitHub Action (a little robot) asks Blizzard for your friends' characters, saves the result as `data.json`, and publishes the website with GitHub Pages.

> ⏱️ Takes about 20–30 minutes the first time. Click paths were checked against GitHub's docs (Nov 2026). GitHub sometimes moves buttons around a bit.

---

## Step 0: What you need
- The folder **`dsmg4eva-github`** (unzip `dsmg4eva-github.zip`)
- An email address
- A Battle.net account (for the Blizzard API key)

---

## Step 1: Create a GitHub account
1. Go to **https://github.com/signup**.
2. Enter your email, a password, and a **username**. Your username becomes part of the link (`username.github.io`).
3. Verify your email.
4. Free plan is enough.

📖 Docs: [Creating an account on GitHub](https://docs.github.com/en/get-started/start-your-journey/creating-an-account-on-github)

---

## Step 2: Create the repository
1. Top right, click **+** → **New repository**.
2. **Repository name:** `dsmg4eva`
3. Select **Public**. Free GitHub Pages needs a public repo.
4. Leave "Add a README" **unchecked** (we bring our own).
5. Click **Create repository**.

📖 Docs: [Creating a new repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)

---

## Step 3: Upload the files (no git needed)

### 3a. Upload the normal files
1. On the empty repo page, click the link **"uploading an existing file"** (or **Add file → Upload files**).
2. Open the unzipped `dsmg4eva-github` folder on your computer. **Select everything inside it**: `config.json`, `README.md`, `GUIDE.md`, `.gitignore`, and the folders `docs`, `scripts`, `data`.
3. Drag them into the browser window. Folders are kept.
4. Below, click **Commit changes**.

### 3b. Add the workflow file (important!)
Folders starting with a dot (`.github`) are often hidden on Mac and Windows, and drag & drop can skip them. Create the file by hand:
1. Click **Add file → Create new file**.
2. In the name box type exactly: `.github/workflows/update.yml`. Each `/` creates a folder automatically.
3. Open `.github/workflows/update.yml` from the unzipped folder in a text editor (Notepad, TextEdit), copy **all** of it, and paste it into the big box.
   - Windows: enable *View → Show → Hidden items* to see `.github`.
   - Mac: press **Cmd + Shift + .** in Finder.
4. Click **Commit changes…** → **Commit changes**.

✅ Your repo should now show: `.github/workflows/update.yml`, `config.json`, `data/`, `docs/`, `scripts/`, `README.md`, `GUIDE.md`.

📖 Docs: [Adding a file to a repository](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository) · [Creating new files](https://docs.github.com/en/repositories/working-with-files/managing-files/creating-new-files)

<details><summary>Optional: with git on the command line instead</summary>

```bash
cd dsmg4eva-github
git init -b main
git add .
git commit -m "DSMG4EVA initial"
git remote add origin https://github.com/YOUR-USERNAME/dsmg4eva.git
git push -u origin main
```
</details>

---

## Step 4: Get a Blizzard API key
1. Go to **https://develop.battle.net/access/clients** and log in with Battle.net.
2. Click **Create Client**.
   - Name: `DSMG4EVA`
   - Redirect URL: leave empty, or use `https://localhost`
   - Intended use: "Personal guild dashboard"
3. Save. You now see a **Client ID** and a **Client Secret**. Keep this tab open for Step 5.

> 🔐 **Please create a NEW client** for this, and **delete or rotate the old key** that is written inside the old Apps Script `code.gs`. Anyone who ever saw that file could use it. The same applies to the old Raider.IO and Warcraft Logs keys in that file.
> Treat the secret like a password: never paste it into `config.json`, a chat, or a screenshot.

📖 Docs: [Blizzard API getting started](https://community.developer.battle.net/documentation/guides/getting-started)

---

## Step 5: Add the two secrets to the repository
1. In your repo, click **Settings** (top tab).
2. Left sidebar: **Secrets and variables** → **Actions**.
3. Click **New repository secret**:
   - Name: `BLIZZARD_CLIENT_ID` → Secret: *(paste Client ID)* → **Add secret**
4. Click **New repository secret** again:
   - Name: `BLIZZARD_CLIENT_SECRET` → Secret: *(paste Client Secret)* → **Add secret**

Secrets are encrypted. Nobody, not even you, can read them back. They're also hidden in logs.

📖 Docs: [Using secrets in GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)

---

## Step 6: Allow the workflow to save data
1. **Settings** → left sidebar **Actions** → **General**.
2. Scroll to **Workflow permissions**.
3. Select **Read and write permissions** → **Save**.

(The workflow also asks for these permissions itself. This setting makes sure your account allows it.)

📖 Docs: [Managing GitHub Actions settings for a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#configuring-the-default-github_token-permissions)

---

## Step 7: Turn on GitHub Pages (source = GitHub Actions)
1. **Settings** → left sidebar (section "Code, planning, and automation") **Pages**.
2. Under **Build and deployment** → **Source**, choose **GitHub Actions**.

That's all; there's no branch to pick.

> Why not "Deploy from a branch"? GitHub's docs say *"Commits pushed by a GitHub Actions workflow that uses the GITHUB_TOKEN do not trigger a GitHub Pages build."* With a branch source, the site would never show new data. Our workflow publishes the site itself.

📖 Docs: [Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site#publishing-with-a-custom-github-actions-workflow)

---

## Step 8: Run the workflow the first time
1. Click the **Actions** tab. If GitHub asks, click **"I understand my workflows, go ahead and enable them"**.
2. On the left, click **Update data**.
3. On the right, click **Run workflow** → **Run workflow** (branch `main`).
4. Wait about 1 minute. A green ✅ means everything worked. Click the run to see the log, e.g. `12/12 characters OK`.

From now on it runs automatically about every 15 minutes. It also runs every time you change a file.

📖 Docs: [Manually running a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)

---

## Step 9: Open and share your site
Your link is:

```
https://YOUR-USERNAME.github.io/dsmg4eva/
```

You can also find it in **Settings → Pages** ("Your site is live at …"). The first time can take a few minutes. Send that link to your friends. The page shows **"Last updated: … (Berlin time)"** at the bottom of the pinboard and reloads new data on its own.

---

## Step 10: Add your real friends (edit `config.json`)
1. In the repo, click **`config.json`** → the ✏️ pencil icon (Edit).
2. Change the placeholder names. Characters are written as **`Firstname-Surname`** exactly as in game. There's no realm in WoW Forever.

```json
"friends": [
  { "friend": "Billy", "main": "Firstname-Surname", "alts": ["Alt-Surname"] },
  { "friend": "Embrace", "main": "Another-Name", "alts": [] }
]
```

3. Optional changes:
   - `"guild"`: your guild name in lowercase (e.g. `"my guild"`), or `""` to hide the guild tile
   - `"raidNights"`: your raid days (weekday 0 = Sunday … 6 = Saturday, Berlin time)
   - `"weeklyReset"`: change it if Blizzard confirms a different reset time
4. Click **Commit changes…** → **Commit changes**. The workflow runs automatically and the site updates in about 1–2 minutes.

⚠️ Keep the JSON valid: quotes around names, commas between entries, no comma after the last one. If unsure, paste it into https://jsonlint.com first.

The layout has 5 friend columns. Up to 5 friends looks best.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Red ❌ run, log says **"Missing env BLIZZARD_CLIENT_ID"** | Secrets missing or misspelled (Step 5). The names must match exactly. |
| **"Blizzard OAuth failed: HTTP 401"** | Wrong Client ID or Secret. Re-create both secrets. |
| **"Permission denied" / 403 on `git push`** | Step 6 (Read and write permissions) not saved. |
| Deploy step fails: **"Pages not enabled"** / "Get Pages site failed" | Step 7: set Pages Source to **GitHub Actions**, then re-run. |
| Deploy fails: **"Branch … is not allowed to deploy to github-pages"** | Use branch `main`. Or check **Settings → Environments → github-pages** → allow `main`. |
| A card says **"Not found — check name"** (or a yellow warning in the log) | Check the spelling of `Firstname-Surname`. The character must exist on **EU** Forever. Brand-new characters may take a while to appear in the API. |
| Site shows **404** | Wait a few minutes after the first successful run. Use the exact URL with `/dsmg4eva/`. The repo must be public. |
| "Last updated" is older than 15 minutes | Normal sometimes. GitHub delays scheduled runs at busy times, and can occasionally skip one. The page keeps showing the last data. |
| Automatic updates stopped | GitHub turns off schedules in public repos after **60 days with no repo activity**. Our data commits normally count as activity. If it still happens: **Actions → Update data → Enable workflow**. |
| `data.json` invalid / page stays on "loading" | Look at the latest Actions run log. The script refuses to overwrite the data if *no* character loads. |

📖 Docs: [Schedule event (delays & 60-day rule)](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) · [Disabling and enabling a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows) · [Viewing workflow run history](https://docs.github.com/en/actions/how-tos/monitor-workflows/view-workflow-run-history)

---

## Privacy and safety
- **Everything on the site and in `docs/data.json` is public.** Anyone with the link, or anyone browsing the repo, can see character names, levels, gear, and professions. This is the same info the official Blizzard armory shows publicly. Friend nicknames in `config.json` are public too.
- Your Blizzard key is **not** public. It lives only in the repo secrets and is never written into any file.
- The workflow only **reads** from Blizzard. It never posts anything anywhere.

## Usage and costs
GitHub Actions is free for public repos, and GitHub Pages is free for public repos. One run takes about 30–60 seconds.

---
*DSMG4EVA • created and managed by 3mbr4ce • Lok'tar Ogar!*
