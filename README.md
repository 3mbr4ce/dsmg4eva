# DSMG4EVA — Damn So Much Gear 4 Ever

A free, public WoW: Forever (EU) dashboard for your friend group, hosted on **GitHub Pages**. Its data is refreshed by **GitHub Actions** about every 15 minutes.

Full setup guide for beginners: **[GUIDE.md](GUIDE.md)**

## Layout
| Path | What it is |
|---|---|
| `config.json` | **The only file you normally edit**: friends, characters, reset time |
| `scripts/fetch.mjs` | Calls the Blizzard API (read-only) and writes `docs/data.json` (Node 20+, no dependencies) |
| `docs/index.html` | The website. Loads `data.json` and refreshes itself every 5 minutes |
| `docs/data.json` | Generated data (public!) |
| `data/state.json` | Weekly-race baseline and first-to-60 timestamps (generated) |
| `.github/workflows/update.yml` | Runs every 15 min and on demand: fetch → commit data → deploy Pages |

## Secrets
Store `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET` **only** as repository secrets. Never put them in a file.

## Run locally (optional)
```bash
BLIZZARD_CLIENT_ID=xxx BLIZZARD_CLIENT_SECRET=yyy node scripts/fetch.mjs
cd docs && python3 -m http.server 8080   # open http://localhost:8080
```

## Rules
- **Item level** = mean item level of the equipped slots, excluding shirt and tabard. A 2-hander with no off-hand counts twice. We calculate it ourselves because the API's value is wrong at low levels.
- **Weekly race** = change since the first run after the weekly reset (`config.json → weeklyReset`, default Wed 07:00 UTC, *not officially confirmed*).
- **Race to 60**: sorted by level, then XP. The first character seen at 60 gets the crown.
