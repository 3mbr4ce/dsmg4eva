# DSMG4EVA — Damn So Much Gear 4 Ever

A free, public WoW: Forever (EU) dashboard for your friend group, hosted on **GitHub Pages**. Its data is refreshed by **GitHub Actions** about every 15 minutes.

Full setup guide for beginners: **[GUIDE.md](GUIDE.md)**

## Layout
| Path | What it is |
|---|---|
| `config.json` | **The only file you normally edit**: friends, known characters, enemies, reset time |
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

## Known characters
People you meet along the way go in the `"known"` array in `config.json`, with the same shape as `"friends"` (plus an optional `"note"`). They appear only in the **Friends Made on the Way** section at the bottom — not in the Race to 60, ladders, weekly race, intro, or Flex Feed.

```json
"known": [
  { "friend": "Pip", "main": "Pip-Jaeger", "alts": ["Steppenwolf-One"], "note": "met in Westfall" },
  { "friend": "Ash", "aka": "Sparks", "main": "Ash-Kai", "alts": [] }
]
```

A misspelled known character only warns in the workflow log; it will not fail the update.

## Enemies (Alliance Most Wanted)
People you want to track as enemies go in the `"enemies"` array, same shape as `"friends"` (plus an optional `"note"`). They appear only in **Enemies Made on the Way** at the bottom — not in the races, ladders, intro, or Flex Feed.

```json
"enemies": [
  { "friend": "Sefica", "aka": "Stormborn", "main": "Sefica-Stormborn", "alts": ["Aenar-Stormbreaker"], "note": "ganked us in Stranglethorn" }
]
```

A misspelled enemy character only warns in the workflow log; it will not fail the update.

## Last seen
Every character card shows a status from `last_login_timestamp`: **Active now** (seen in the last ~15 minutes — the API updates this on logout, so it is not a live "online" flag), then **Last seen Xm / Xh / Xd ago**. A **Recently active** strip at the top lists anyone seen in the last 6 hours. Times are computed in the browser so they stay fresh between data fetches.

## Character pages (v2.6)

- **Characters** button (top right) opens a picker: The Crew, then Friends Made on the Way, then Enemies Made on the Way. One character opens its page straight away; a person with alts gets a short choice of main + alts.
- Each character page (`#char/<slug>`, shareable, Back button works) shows the full-body render over a race backdrop, title, gear grid with tooltips, stats, talents, professions, PvP, reputations, achievements/collections, quests and (friends only) a level / item level / HK history.
- `fetch.mjs` stores per character: `media` (avatar + render URLs), `stats`, `title`, `titleCount`, `reputations`, `achievements`, `collections`, `questsDone`. All of these are optional: a failing call only produces a warning and never fails the run, and an older `data.json` without them still renders.
- Friend history lives in `data/state.json` (`history`, pruned to 30 days).
- "Recently active" shows real friends only.
- Images are linked from Blizzard's render CDN. Data and images © Blizzard Entertainment.

## Rules
- **Item level** = mean item level of the equipped slots, excluding shirt and tabard. A 2-hander with no off-hand counts twice. We calculate it ourselves because the API's value is wrong at low levels.
- **Weekly race** = change since the first run after the weekly reset (`config.json → weeklyReset`, default Wed 07:00 UTC, *not officially confirmed*).
- **Race to 60**: sorted by level, then XP. The first character seen at 60 gets the crown.
