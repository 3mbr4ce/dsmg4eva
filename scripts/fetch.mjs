#!/usr/bin/env node
/**
 * DSMG4EVA data builder (Node 20+, no dependencies).
 * Reads config.json, calls the Blizzard WoW Forever API (read-only GET), writes docs/data.json.
 * State (weekly baseline + first-ding timestamps) lives in data/state.json and is committed by the workflow.
 * Secrets come ONLY from env: BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const OUT_FILE = path.join(ROOT, 'docs', 'data.json');
const STATE_FILE = path.join(ROOT, 'data', 'state.json');

const APP_NAME = 'DSMG4EVA';
const REGION = CONFIG.region || 'eu';
const NAMESPACE = 'profile-forever-' + REGION;
const LOCALE = CONFIG.locale || 'en_GB';
const API_HOST = 'https://' + REGION + '.api.blizzard.com';
const LEVEL_CAP = CONFIG.levelCap || 60;
const WEEKLY_RESET = { weekday: CONFIG.weeklyReset.weekday, hourUtc: CONFIG.weeklyReset.hourUtc };
const RAID_NIGHTS = CONFIG.raidNights || [];
const GUILD_SLUG = CONFIG.guild || '';
const FRIENDS = CONFIG.friends || [];
const CONCURRENCY = 8;

/* ---------- HTTP ---------- */
async function getAccessToken() {
  const id = process.env.BLIZZARD_CLIENT_ID, secret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Missing env BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET (GitHub: Settings > Secrets and variables > Actions).');
  const res = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (res.status !== 200) throw new Error('Blizzard OAuth failed: HTTP ' + res.status + ' (check the two secrets)');
  return (await res.json()).access_token;
}
let CALLS = 0;
async function apiGet(p, token, namespace) {
  const url = API_HOST + p + (p.includes('?') ? '&' : '?') + 'namespace=' + (namespace || NAMESPACE) + '&locale=' + LOCALE;
  for (let attempt = 0; attempt < 3; attempt++) {
    CALLS++;
    try {
      const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      if (res.status === 429 || res.status >= 500) { await sleep(800 * (attempt + 1)); continue; }
      if (res.status !== 200) return { ok: false, status: res.status };
      return { ok: true, status: 200, json: await res.json() };
    } catch (e) { await sleep(800 * (attempt + 1)); }
  }
  return { ok: false, status: 'network' };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function pool(items, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

/* ---------- state ---------- */
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj, null, 1) + '\n'); }

/* ---------- build ---------- */
async function main() {
  const t0 = Date.now();
  const token = await getAccessToken();
  const chars = await fetchAllCharacters(token);
  if (!chars.some(c => !c.error)) throw new Error('No character could be loaded - refusing to overwrite data.json');

  const state = readJson(STATE_FILE, {});
  const stateBefore = JSON.stringify(state);
  const weekId = currentWeekId();
  let snap = state.weeklySnapshot;
  // New snapshot once the weekly reset has passed since the last one.
  if (!snap || snap.weekId !== weekId) snap = { weekId, takenAt: Date.now(), baseline: {} };
  const dings = state.ding60 || {};
  chars.forEach(c => {
    if (c.error) return;
    if (!snap.baseline[c.slug]) snap.baseline[c.slug] = baselineOf(c);
    const b = snap.baseline[c.slug];
    c.weekly = { levels: round2(c.levelProgress - b.levelProgress), ilvl: round2(c.itemLevel - b.ilvl), hk: c.pvp.hk - b.hk, rank: c.pvp.rank - b.rank };
    if (c.level >= LEVEL_CAP && !dings[c.slug]) dings[c.slug] = Date.now();
    c.ding60At = dings[c.slug] || null;
  });
  const newState = { weeklySnapshot: snap, ding60: dings };
  if (JSON.stringify(newState) !== stateBefore) writeJson(STATE_FILE, newState);

  const bundle = {
    app: APP_NAME, generatedAt: Date.now(), region: REGION, levelCap: LEVEL_CAP, weekId,
    weekStartedAt: snap.takenAt, nextResetAt: nextResetMs(), weeklyReset: WEEKLY_RESET, raidNights: RAID_NIGHTS,
    friends: FRIENDS.map(f => ({ friend: f.friend })),
    guild: GUILD_SLUG ? await fetchGuild(GUILD_SLUG, token) : null,
    characters: chars
  };
  // Only rewrite data.json when content (ignoring generatedAt) changed -> fewer commits.
  const prev = readJson(OUT_FILE, null);
  const strip = b => JSON.stringify({ ...b, generatedAt: 0, nextResetAt: 0 });
  if (prev && strip(prev) === strip(bundle) && Date.now() - prev.generatedAt < 6 * 3600e3) {
    console.log('No data change; data.json kept.');
  } else {
    writeJson(OUT_FILE, bundle);
    console.log('Wrote docs/data.json');
  }
  const bad = chars.filter(c => c.error).map(c => c.input + ' (' + c.error + ')');
  console.log(`${chars.length - bad.length}/${chars.length} characters OK, ${CALLS} API calls, ${Date.now() - t0} ms`);
  if (bad.length) console.log('::warning::Not found / failed: ' + bad.join(', ') + ' - check spelling in config.json');
}

async function fetchAllCharacters(token) {
  const list = [];
  FRIENDS.forEach(f => [f.main].concat(f.alts || []).forEach((n, i) =>
    list.push({ friend: f.friend, input: n, isMain: i === 0, slug: characterSlug(n) })));
  const parts = ['', '/equipment', '/pvp-summary', '/specializations', '/professions'];
  const jobs = [];
  list.forEach(c => parts.forEach(p => jobs.push('/profile/wow/character/' + encodeURIComponent(c.slug) + p)));
  const res = await pool(jobs, p => apiGet(p, token));
  const out = list.map((c, i) => {
    const r = res.slice(i * parts.length, (i + 1) * parts.length);
    return normalizeCharacter(c, r[0], r[1], r[2], r[3], r[4]);
  });
  // item icons
  const ids = [...new Set(out.flatMap(c => (c.gear || []).map(g => g.itemId)).filter(Boolean))];
  const icons = {};
  await pool(ids, async id => {
    const j = await apiGet('/data/wow/media/item/' + id, token, 'static-forever-' + REGION);
    const a = j.ok && (j.json.assets || []).find(x => x.key === 'icon');
    if (a) icons[id] = a.value;
  });
  out.forEach(c => (c.gear || []).forEach(g => { g.icon = icons[g.itemId] || null; }));
  return out;
}

async function fetchGuild(slug, token) {
  const r = await apiGet('/data/wow/guild/' + encodeURIComponent(slug.toLowerCase()), token);
  if (!r.ok) return { slug, error: 'not_found' };
  return {
    slug, name: r.json.name, members: r.json.member_count || 0, achievementPoints: r.json.achievement_points || 0,
    faction: r.json.faction && r.json.faction.type || '', ruleset: r.json.ruleset && r.json.ruleset.name || '',
    armoryUrl: 'https://worldofwarcraft.blizzard.com/en-gb/forever/' + REGION + '/armory/guild/' + encodeURIComponent(slug.toLowerCase())
  };
}

/* ---------- shared logic (identical to the Apps Script version) ---------- */
function normalizeCharacter(c, profile, equip, pvp, specs, profs) {
  const base = { friend: c.friend, isMain: c.isMain, slug: c.slug, input: c.input };
  if (!profile.ok) {
    base.error = profile.status === 404 ? 'not_found' : ('http_' + profile.status);
    base.name = c.input.replace('-', ' ');
    return base;
  }
  const p = profile.json;
  const gear = equip.ok ? normalizeGear(equip.json) : [];
  const xpNeeded = XP_TO_LEVEL[p.level] || 0;
  const xpPct = p.level >= LEVEL_CAP || !xpNeeded ? (p.level >= LEVEL_CAP ? 1 : 0) : Math.min(0.999, (p.experience || 0) / xpNeeded);
  base.id = p.id;
  base.name = p.name;
  base.surname = p.surname || '';
  base.fullName = p.name + (p.surname ? ' ' + p.surname : '');
  base.level = p.level;
  base.experience = p.experience || 0;
  base.xpToLevel = xpNeeded;
  base.xpPct = round2(xpPct * 100);
  base.levelProgress = round2(p.level + (p.level >= LEVEL_CAP ? 0 : xpPct));
  base.className = p.character_class && p.character_class.name || '';
  base.classId = p.character_class && p.character_class.id || 0;
  base.race = p.race && p.race.name || '';
  base.raceId = p.race && p.race.id || 0;
  base.gender = p.gender && p.gender.type || '';
  base.faction = p.faction && p.faction.type || '';
  base.guild = p.guild ? p.guild.name : null;
  base.ruleset = p.ruleset ? p.ruleset.name : '';
  base.achievementPoints = p.achievement_points || 0;
  base.lastLogin = p.last_login_timestamp || null;
  base.apiItemLevel = p.equipped_item_level || 0;
  base.gear = gear;
  base.itemLevel = computeItemLevel(gear);
  const hk = pvp.ok ? (pvp.json.honorable_kills || 0) : 0;
  const rank = pvp.ok ? (pvp.json.pvp_rank || 0) : 0;
  base.pvp = { hk: hk, rank: rank, rankName: pvpRankName(rank, base.faction) };
  base.spec = specs.ok ? normalizeSpecs(specs.json) : null;
  base.professions = profs.ok ? normalizeProfessions(profs.json) : { primaries: [], secondaries: [] };
  base.armoryUrl = 'https://worldofwarcraft.blizzard.com/en-gb/forever/' + REGION + '/armory/character/' + encodeURIComponent(c.slug);
  return base;
}

/**
 * ITEM LEVEL RULE (own calculation; the API's equipped_item_level is unreliable at low levels):
 * mean of item level over EQUIPPED slots, excluding SHIRT and TABARD. Empty slots are ignored.
 * A two-handed main hand with an empty off hand counts twice (like the game).
 */
function computeItemLevel(gear) {
  let sum = 0, n = 0, twoHand = false, hasOff = false;
  gear.forEach(function (g) {
    if (g.slot === 'SHIRT' || g.slot === 'TABARD') return;
    if (g.slot === 'OFF_HAND') hasOff = true;
    if (g.slot === 'MAIN_HAND' && g.inventoryType === 'TWOHWEAPON') twoHand = true;
    sum += g.ilvl; n += 1;
  });
  if (twoHand && !hasOff) {
    const mh = gear.filter(function (g) { return g.slot === 'MAIN_HAND'; })[0];
    sum += mh.ilvl; n += 1;
  }
  return n ? round2(sum / n) : 0;
}

const SLOT_ORDER = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'SHIRT', 'TABARD', 'WRIST', 'HANDS', 'WAIST',
  'LEGS', 'FEET', 'FINGER_1', 'FINGER_2', 'TRINKET_1', 'TRINKET_2', 'MAIN_HAND', 'OFF_HAND', 'RANGED'];

function normalizeGear(json) {
  const items = (json.equipped_items || []).map(function (it) {
    return {
      slot: it.slot && it.slot.type || '',
      slotName: it.slot && it.slot.name || '',
      itemId: it.item && it.item.id,
      name: it.name || '',
      quality: it.quality && it.quality.type || 'COMMON',
      ilvl: it.level && it.level.value || 0,
      inventoryType: it.inventory_type && it.inventory_type.type || '',
      enchants: (it.enchantments || []).map(function (e) { return e.display_string || ''; }).filter(String),
      icon: null
    };
  });
  items.sort(function (a, b) { return SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot); });
  return items;
}

function normalizeSpecs(json) {
  const groups = json.specialization_groups || [];
  const active = groups.filter(function (g) { return g.is_active; })[0] || groups[0];
  if (!active) return null;
  const trees = (active.specializations || []).map(function (s) {
    return { name: s.specialization_name || (s.specialization && s.specialization.name) || '', points: s.spent_points || 0 };
  });
  const top = trees.slice().sort(function (a, b) { return b.points - a.points; })[0];
  return {
    trees: trees,
    split: trees.map(function (t) { return t.points; }).join('/'),
    main: top && top.points > 0 ? top.name : 'Unspecced'
  };
}

function normalizeProfessions(json) {
  function map(list) {
    return (list || []).map(function (p) {
      const tier = (p.tiers && p.tiers[0]) || p;
      return {
        name: p.profession && p.profession.name || '',
        skill: tier.skill_points || 0,
        max: tier.max_skill_points || 0,
        recipes: (tier.known_recipes || []).length
      };
    });
  }
  return { primaries: map(json.primaries), secondaries: map(json.secondaries) };
}

const PVP_RANKS = {
  HORDE: ['Scout', 'Grunt', 'Sergeant', 'Senior Sergeant', 'First Sergeant', 'Stone Guard', 'Blood Guard', 'Legionnaire',
    'Centurion', 'Champion', 'Lieutenant General', 'General', 'Warlord', 'High Warlord'],
  ALLIANCE: ['Private', 'Corporal', 'Sergeant', 'Master Sergeant', 'Sergeant Major', 'Knight', 'Knight-Lieutenant',
    'Knight-Captain', 'Knight-Champion', 'Lieutenant Commander', 'Commander', 'Marshal', 'Field Marshal', 'Grand Marshal']
};
function pvpRankName(rank, faction) {
  if (!rank || rank < 1) return 'Unranked';
  const list = PVP_RANKS[faction] || PVP_RANKS.HORDE;
  return list[Math.min(rank, 14) - 1];
}

/**
 * XP needed to go from level N to N+1 (original 1.12 table). Forever may tweak it:
 * the bar is an approximation; level itself always comes from the API.
 */
const XP_TO_LEVEL = { 1: 400, 2: 900, 3: 1400, 4: 2100, 5: 2800, 6: 3600, 7: 4500, 8: 5400, 9: 6500, 10: 7600,
  11: 8800, 12: 10100, 13: 11400, 14: 12900, 15: 14400, 16: 16000, 17: 17700, 18: 19400, 19: 21300, 20: 23200,
  21: 25200, 22: 27300, 23: 29400, 24: 31700, 25: 34000, 26: 36400, 27: 38900, 28: 41400, 29: 44300, 30: 47400,
  31: 50800, 32: 54500, 33: 58600, 34: 62800, 35: 67100, 36: 71600, 37: 76100, 38: 80900, 39: 85700, 40: 90700,
  41: 95800, 42: 101000, 43: 106300, 44: 111800, 45: 117500, 46: 123200, 47: 129100, 48: 135100, 49: 141200, 50: 147500,
  51: 153900, 52: 160400, 53: 167100, 54: 173900, 55: 180800, 56: 187900, 57: 195000, 58: 202300, 59: 209800 };

/** 'Peep-Jõks' -> 'peep-jõks' (URL-encoded at request time). */
function characterSlug(input) {
  return String(input || '').trim().replace(/\s+/g, '-').toLowerCase();
}

/* ======================= TIME / WEEK ========================== */
function lastResetMs(now) {
  now = now || Date.now();
  const d = new Date(now);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), WEEKLY_RESET.hourUtc, 0, 0);
  const back = (d.getUTCDay() - WEEKLY_RESET.weekday + 7) % 7;
  t -= back * 86400000;
  if (t > now) t -= 7 * 86400000;
  return t;
}
function nextResetMs() { return lastResetMs() + 7 * 86400000; }
function currentWeekId() { return new Date(lastResetMs()).toISOString().slice(0, 13); }

function baselineOf(c) {
  return { levelProgress: c.levelProgress, ilvl: c.itemLevel, hk: c.pvp.hk, rank: c.pvp.rank };
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

main().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
