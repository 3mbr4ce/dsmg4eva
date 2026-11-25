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
const FRIENDS = CONFIG.friends || [];
const KNOWN = CONFIG.known || [];
const ENEMIES = CONFIG.enemies || [];
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
// Cap simultaneous requests so the extra per-character endpoints never burst past Blizzard's per-second limit.
const MAX_INFLIGHT = 10;
let inflight = 0;
const waiters = [];
async function slot() {
  if (inflight >= MAX_INFLIGHT) await new Promise(r => waiters.push(r));
  inflight++;
}
function release() { inflight--; const w = waiters.shift(); if (w) w(); }
async function apiGet(p, token, namespace) {
  const url = API_HOST + p + (p.includes('?') ? '&' : '?') + 'namespace=' + (namespace || NAMESPACE) + '&locale=' + LOCALE;
  await slot();
  try {
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
  } finally { release(); }
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
  const friendList = characterJobs(FRIENDS);
  const knownList = characterJobs(KNOWN);
  const enemyList = characterJobs(ENEMIES);
  const all = await fetchCharacterList(token, friendList.concat(knownList, enemyList));
  const chars = all.slice(0, friendList.length);
  const knownChars = all.slice(friendList.length, friendList.length + knownList.length);
  const enemyChars = all.slice(friendList.length + knownList.length);
  if (!chars.some(c => !c.error)) throw new Error('No character could be loaded - refusing to overwrite data.json');
  await attachItemIcons(token, all);

  const state = readJson(STATE_FILE, {});
  const stateBefore = JSON.stringify(state);
  const weekId = currentWeekId();
  let snap = state.weeklySnapshot;
  // New snapshot once the weekly reset has passed since the last one.
  if (!snap || snap.weekId !== weekId) snap = { weekId, takenAt: Date.now(), baseline: {} };
  const dings = state.ding60 || {};
  // Progress history (friends only) for the character page. Points older than 30 days are dropped (Blizzard API 30-day data rule).
  const hist = state.history || {};
  const HIST_TTL = 30 * 86400e3, now = Date.now(), liveSlugs = new Set(chars.map(c => c.slug));
  Object.keys(hist).forEach(s => { if (!liveSlugs.has(s)) delete hist[s]; });
  chars.forEach(c => {
    if (c.error) return;
    const arr = (hist[c.slug] || []).filter(pt => now - pt[0] < HIST_TTL);
    const last = arr[arr.length - 1], pt = [now, c.levelProgress, c.itemLevel, c.pvp.hk];
    if (!last || last[1] !== pt[1] || last[2] !== pt[2] || last[3] !== pt[3]) arr.push(pt);
    hist[c.slug] = arr.slice(-240);
    c.history = hist[c.slug];
    if (!snap.baseline[c.slug]) snap.baseline[c.slug] = baselineOf(c);
    const b = snap.baseline[c.slug];
    c.weekly = { levels: round2(c.levelProgress - b.levelProgress), ilvl: round2(c.itemLevel - b.ilvl), hk: c.pvp.hk - b.hk, rank: c.pvp.rank - b.rank };
    if (c.level >= LEVEL_CAP && !dings[c.slug]) dings[c.slug] = Date.now();
    c.ding60At = dings[c.slug] || null;
  });
  const newState = { weeklySnapshot: snap, ding60: dings, history: hist };
  if (JSON.stringify(newState) !== stateBefore) writeJson(STATE_FILE, newState);

  const bundle = {
    app: APP_NAME, generatedAt: Date.now(), region: REGION, levelCap: LEVEL_CAP, weekId,
    weekStartedAt: snap.takenAt, nextResetAt: nextResetMs(), weeklyReset: WEEKLY_RESET,
    friends: FRIENDS.map(metaOf),
    characters: chars,
    known: KNOWN.map(metaOf),
    knownCharacters: knownChars,
    enemies: ENEMIES.map(metaOf),
    enemyCharacters: enemyChars
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
  const badKnown = knownChars.filter(c => c.error).map(c => c.input + ' (' + c.error + ')');
  const badEnemies = enemyChars.filter(c => c.error).map(c => c.input + ' (' + c.error + ')');
  console.log(`${chars.length - bad.length}/${chars.length} friends OK, ${knownChars.length - badKnown.length}/${knownChars.length} known OK, ${enemyChars.length - badEnemies.length}/${enemyChars.length} enemies OK, ${CALLS} API calls, ${Date.now() - t0} ms`);
  if (bad.length) console.log('::warning::Not found / failed: ' + bad.join(', ') + ' - check spelling in config.json');
  if (badKnown.length) console.log('::warning::Known character not found / failed: ' + badKnown.join(', ') + ' - check spelling in config.json (known). This does not fail the run.');
  if (OPTIONAL_FAILS.length) console.log('::warning::Optional character data unavailable (' + OPTIONAL_FAILS.length + '): ' + OPTIONAL_FAILS.slice(0, 12).join(', ') + (OPTIONAL_FAILS.length > 12 ? ', ...' : '') + ' - the page just hides those blocks. This does not fail the run.');
  if (badEnemies.length) console.log('::warning::Enemy character not found / failed: ' + badEnemies.join(', ') + ' - check spelling in config.json (enemies). This does not fail the run.');
}

function metaOf(f) {
  const o = { friend: f.friend };
  if (f.aka) o.aka = String(f.aka);
  if (f.note) o.note = String(f.note);
  return o;
}

function characterJobs(people) {
  const list = [];
  (people || []).forEach(f => [f.main].concat(f.alts || []).forEach((n, i) => {
    if (!n) return;
    list.push({ friend: f.friend, input: n, isMain: i === 0, slug: characterSlug(n) });
  }));
  return list;
}

// Core endpoints feed the races/ladders; EXTRA endpoints only feed the character page and are fully optional.
const CORE_PARTS = ['/equipment', '/pvp-summary', '/specializations', '/professions'];
const EXTRA_PARTS = ['/character-media', '/statistics', '/titles', '/reputations', '/achievements',
  '/collections/mounts', '/collections/pets', '/collections/toys', '/quests/completed'];
const OPTIONAL_FAILS = [];

async function loadCharacter(c, token) {
  const base = '/profile/wow/character/' + encodeURIComponent(c.slug);
  const profile = await apiGet(base, token);
  const none = { ok: false, status: 'skipped' };
  if (!profile.ok) return normalizeCharacter(c, profile, none, none, none, none, {});
  const res = await Promise.all(CORE_PARTS.concat(EXTRA_PARTS).map(p => apiGet(base + p, token)));
  const core = res.slice(0, CORE_PARTS.length), extra = {};
  EXTRA_PARTS.forEach((p, i) => {
    const r = res[CORE_PARTS.length + i];
    extra[p] = r;
    // 404 is normal (new character, no titles yet, media still rendering); anything else is worth a warning.
    if (!r.ok && r.status !== 404) OPTIONAL_FAILS.push(c.input + p + ' [' + r.status + ']');
  });
  return normalizeCharacter(c, profile, core[0], core[1], core[2], core[3], extra);
}

async function fetchCharacterList(token, list) {
  if (!list.length) return [];
  return pool(list, c => loadCharacter(c, token));
}

async function attachItemIcons(token, out) {
  const ids = [...new Set(out.flatMap(c => (c.gear || []).map(g => g.itemId)).filter(Boolean))];
  const icons = {};
  await pool(ids, async id => {
    const j = await apiGet('/data/wow/media/item/' + id, token, 'static-forever-' + REGION);
    const a = j.ok && (j.json.assets || []).find(x => x.key === 'icon');
    if (a) icons[id] = a.value;
  });
  out.forEach(c => (c.gear || []).forEach(g => { g.icon = icons[g.itemId] || null; }));
}

/* ---------- shared logic (identical to the Apps Script version) ---------- */
function normalizeCharacter(c, profile, equip, pvp, specs, profs, extra) {
  extra = extra || {};
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
  // Optional character-page blocks: each normalizer is guarded so a odd payload can never abort the run.
  const opt = (k, v) => { if (v != null) base[k] = v; };
  opt('media', safe(normalizeMedia, extra['/character-media']));
  opt('stats', safe(normalizeStats, extra['/statistics']));
  const ti = safe(normalizeTitles, extra['/titles'], base.name);
  opt('title', ti && ti.active || null);
  opt('titleCount', ti ? ti.count : null);
  opt('reputations', safe(normalizeReps, extra['/reputations']));
  opt('achievements', safe(normalizeAchievements, extra['/achievements']));
  const col = {};
  [['mounts', '/collections/mounts'], ['pets', '/collections/pets'], ['toys', '/collections/toys']].forEach(([k, p]) => {
    const n = safe(countList, extra[p], k); if (n != null) col[k] = n;
  });
  if (Object.keys(col).length) base.collections = col;
  opt('questsDone', safe(countList, extra['/quests/completed'], 'quests'));
  return base;
}

/* ---------- optional character-page blocks ---------- */
function safe(fn, ...args) { try { return fn(...args); } catch { return null; } }

/** character-media -> { avatar, avatarSd, main, mainSd } (render.worldofwarcraft.com URLs). */
function normalizeMedia(r) {
  if (!r || !r.ok) return null;
  const by = {};
  (r.json.assets || []).forEach(a => { if (a && a.key && a.value) by[a.key] = String(a.value); });
  const m = {};
  if (by.avatar) m.avatar = by.avatar;
  if (by['avatar-sd']) m.avatarSd = by['avatar-sd'];
  if (by['main-raw']) m.main = by['main-raw'];
  if (by['main-sd-raw']) m.mainSd = by['main-sd-raw'];
  return Object.keys(m).length ? m : null;
}

/** Number out of { effective | value | base } objects, or a plain number. */
function statNum(x) {
  if (typeof x === 'number') return x;
  if (x && typeof x === 'object') {
    for (const k of ['effective', 'value', 'base']) if (x[k] != null) { const n = statNum(x[k]); if (n != null) return n; }
  }
  return null;
}
const STAT_SPEC = [
  ['health', 'Health', 'n'], ['power', 'Power', 'n'],
  ['strength', 'Strength', 'n'], ['agility', 'Agility', 'n'], ['stamina', 'Stamina', 'n'],
  ['intellect', 'Intellect', 'n'], ['spirit', 'Spirit', 'n'], ['armor', 'Armor', 'n'],
  ['attack_power', 'Attack power', 'n'], ['ranged_attack_power', 'Ranged attack power', 'n'], ['spell_power', 'Spell power', 'n'],
  ['melee_crit', 'Melee crit', 'p'], ['ranged_crit', 'Ranged crit', 'p'], ['spell_crit', 'Spell crit', 'p'],
  ['dodge', 'Dodge', 'p'], ['parry', 'Parry', 'p'], ['block', 'Block', 'p'],
  ['melee_haste', 'Melee haste', 'p'], ['spell_haste', 'Spell haste', 'p']
];
/** /statistics -> [{ k, label, v, p }]  (p = percentage). Unknown keys are ignored; missing ones simply do not appear. */
function normalizeStats(r) {
  if (!r || !r.ok) return null;
  const j = r.json, out = [];
  STAT_SPEC.forEach(([k, label, kind]) => {
    const n = statNum(j[k]);
    if (n == null) return;
    const row = { k, label: k === 'power' && j.power_type && j.power_type.name ? j.power_type.name : label, v: kind === 'p' ? round2(n) : Math.round(n) };
    if (kind === 'p') row.p = 1;
    out.push(row);
  });
  return out.length ? out : null;
}

/** /titles -> { active, count }. The display string uses {name} (or %s) as the character-name placeholder. */
function normalizeTitles(r, name) {
  if (!r || !r.ok) return null;
  const a = r.json.active_title;
  const raw = a && (a.display_string || a.name) || '';
  return { active: String(raw).replace(/\{name\}|%s/gi, name || '').trim(), count: (r.json.titles || []).length };
}

/** /reputations -> { total, top: [{ name, standing, v, max, tier }] } (best six). */
function normalizeReps(r) {
  if (!r || !r.ok) return null;
  const list = (r.json.reputations || []).map(x => {
    const s = x.standing || {};
    return { name: x.faction && x.faction.name || '', standing: s.name || '', v: s.value || 0, max: s.max || 0, tier: s.tier || 0, raw: s.raw || 0 };
  }).filter(x => x.name && (x.raw > 0 || x.tier > 0));
  list.sort((a, b) => (b.tier - a.tier) || (b.raw - a.raw));
  return { total: list.length, top: list.slice(0, 6).map(({ raw, ...rest }) => rest) };
}

/** /achievements -> { points, count, recent: [names] }. */
function normalizeAchievements(r) {
  if (!r || !r.ok) return null;
  const j = r.json, list = j.achievements || [];
  const recent = list.filter(a => a && a.completed_timestamp && a.achievement && a.achievement.name)
    .sort((a, b) => b.completed_timestamp - a.completed_timestamp).slice(0, 3).map(a => a.achievement.name);
  return { points: j.total_points || 0, count: j.total_quantity != null ? j.total_quantity : list.length, recent };
}

/** Collections / completed quests: only the count is kept. Empty sub-lists may be omitted by the API -> 0. */
function countList(r, key) {
  if (!r || !r.ok) return null;
  const v = r.json[key];
  return Array.isArray(v) ? v.length : 0;
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
      icon: null,
      tt: tooltipOf(it)
    };
  });
  items.sort(function (a, b) { return SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot); });
  return items;
}

// Compact WoW-style tooltip data from the equipment payload (fields are optional).
function tooltipOf(it) {
  const ds = function (x) { return x && x.display_string || ''; };
  const t = {
    bind: it.binding && it.binding.name || '',
    unique: ds(it.unique_equipped),
    inv: it.inventory_type && it.inventory_type.name || '',
    sub: it.item_subclass && it.item_subclass.name || '',
    armor: it.armor && ds(it.armor.display) || '',
    stats: (it.stats || []).map(function (x) { return { s: ds(x.display), neg: !!x.is_negated, eq: !!x.is_equip_bonus }; }).filter(function (x) { return x.s; }),
    spells: (it.spells || []).map(function (x) { return x.description || ''; }).filter(String),
    req: it.requirements && it.requirements.level && it.requirements.level.display_string || '',
    reqClass: it.requirements && it.requirements.playable_classes && it.requirements.playable_classes.display_string || '',
    dur: ds(it.durability),
    sell: it.sell_price && it.sell_price.value || 0,
    desc: it.description || ''
  };
  if (it.weapon) t.weapon = { dmg: ds(it.weapon.damage), speed: ds(it.weapon.attack_speed), dps: ds(it.weapon.dps) };
  if (it.set) t.set = {
    name: ds(it.set),
    items: (it.set.items || []).map(function (x) { return { n: x.item && x.item.name || '', eq: !!x.is_equipped }; }),
    effects: (it.set.effects || []).map(function (x) { return { s: x.display_string || '', on: !!x.is_active }; })
  };
  return t;
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

export { normalizeMedia, normalizeStats, normalizeTitles, normalizeReps, normalizeAchievements, countList };
// Run only when executed directly (lets the normalizers be unit-tested by importing this file).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
}
