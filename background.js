// QuickLoad Hyper-Engine v3.4 - service worker
importScripts('shared.js');

const DEFAULTS = {
  speculation: true, blockTrackers: true, debug: false,
  autoSleep: false, mode: 'dengeli', allowlist: QL.DEFAULT_ALLOW,
  reminders: false, reminderMin: 60, wattPerTab: QL.WATT_PER_TAB,
  smartLoad: true, historyWarm: true, holdout: true
};
const MAX_SITES = 300, MAX_PATHS = 40, MAX_DAYS = 30, MAX_LOG = 200, MAX_MEM = 120, TOP_N = 20;
const getCfg = () => chrome.storage.sync.get(DEFAULTS);

// ---- Sıralı yazma kuyruğu ----
let queue = Promise.resolve();
function task(fn) { queue = queue.then(fn).catch(e => console.warn('[QuickLoad]', e)); return queue; }

// ---- DB ----
let tplCache;
const tpl = async () => tplCache ||= await (await fetch(chrome.runtime.getURL('db.json'))).json();
const clone = x => JSON.parse(JSON.stringify(x));
function deepFill(dst, src) {
  for (const k of Object.keys(src)) {
    if (dst[k] === undefined) dst[k] = clone(src[k]);
    else if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && dst[k] && typeof dst[k] === 'object') deepFill(dst[k], src[k]);
  }
  return dst;
}
async function migrate(db) { deepFill(db, await tpl()); db.schema = 3; return db; }
async function seedDb() {
  const d = clone(await tpl());
  d.createdAt = d.updatedAt = d.totals.lastBlockedTs = Date.now();
  return d;
}
async function loadDb() {
  const { db } = await chrome.storage.local.get('db');
  return db ? migrate(db) : seedDb();
}
function rebuildIndex(db) {
  db.index.topSites = Object.entries(db.sites).sort((a, b) => b[1].visits - a[1].visits)
    .slice(0, TOP_N).map(([h, s]) => [h, s.visits]);
  const flat = [];
  for (const [h, paths] of Object.entries(db.clicks))
    for (const [p, n] of Object.entries(paths)) flat.push([h, p, n]);
  db.index.topClicks = flat.sort((a, b) => b[2] - a[2]).slice(0, TOP_N);
}
function prune(db) {
  const hosts = Object.keys(db.sites);
  if (hosts.length > MAX_SITES)
    hosts.sort((a, b) => db.sites[a].visits - db.sites[b].visits).slice(0, hosts.length - MAX_SITES)
      .forEach(h => { delete db.sites[h]; delete db.clicks[h]; });
  const days = Object.keys(db.days).sort();
  days.slice(0, Math.max(0, days.length - MAX_DAYS)).forEach(d => delete db.days[d]);
}
async function applyDb(fn) { // kuyruk İÇİNDE kullanılır
  const db = await loadDb();
  await fn(db);
  db.updatedAt = Date.now(); prune(db); rebuildIndex(db);
  await chrome.storage.local.set({ db });
}
const mutate = fn => task(() => applyDb(fn));

async function dlog(type, data) {
  const { debug } = await chrome.storage.sync.get({ debug: false });
  if (!debug) return;
  console.debug('[QuickLoad]', type, data);
  const { debugLog = [] } = await chrome.storage.local.get('debugLog');
  debugLog.push({ t: Date.now(), type, data });
  await chrome.storage.local.set({ debugLog: debugLog.slice(-MAX_LOG) });
}

// ---- Gizlilik: yalnızca hostname, sorgu/parça yok, yol normalize ----
function hostOf(url) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname : null; } catch (_) { return null; }
}
function normPath(p) {
  const seg = (p || '/').split('/').filter(Boolean).slice(0, 3).map(s =>
    /^\d+$/.test(s) || /^[0-9a-f-]{16,}$/i.test(s) || s.length > 24 ? ':id' : s.slice(0, 40));
  return '/' + seg.join('/');
}
const dayOf = db => db.days[new Date().toISOString().slice(0, 10)] ||= { navs: 0, prefetched: 0, blocked: 0, clicks: 0 };
const siteOf = (db, h) => db.sites[h] ||= { visits: 0, prefetched: 0, ttfbSum: 0, lastVisit: 0, protocols: {}, clicks: 0 };

function recordNav(msg, sender) {
  const host = hostOf(sender.url);
  if (!host || sender.tab?.incognito) return;
  return mutate(async db => {
    const T = db.totals, s = siteOf(db, host), day = dayOf(db);
    const ttfb = Math.max(0, Math.round(msg.ttfb || 0));
    let raw = String(msg.protocol || '').slice(0, 20) || '(boş)';
    if (!(raw in T.rawProto) && Object.keys(T.rawProto).length >= 20) raw = '(diğer)';
    T.rawProto[raw] = (T.rawProto[raw] || 0) + 1;
    const proto = ['h3', 'h2', 'http/1.1'].includes(msg.protocol) ? msg.protocol : 'other';
    const via = ['same', 'external', 'direct'].includes(msg.via) ? msg.via : 'direct';
    T.origin[via]++;
    const bucket = msg.prefetched ? T.ttfb.prefetch : (msg.prevHoldout ? T.ttfb.holdout : T.ttfb.normal);
    bucket.n++; bucket.sum += ttfb;
    T.navs++; day.navs++; s.visits++; s.ttfbSum += ttfb; s.lastVisit = Date.now();
    s.protocols[proto] = (s.protocols[proto] || 0) + 1;
    db.protocols[proto] = (db.protocols[proto] || 0) + 1;
    if (msg.prefetched) { T.prefetched++; day.prefetched++; s.prefetched++; s.pTtfbSum = (s.pTtfbSum || 0) + ttfb; }
    await dlog('nav', { host, proto, raw, via, ttfb, prefetched: !!msg.prefetched });
  });
}
function recordPerf(msg, sender) {
  if (!hostOf(sender.url) || sender.tab?.incognito) return;
  const num = x => { x = Number(x); return Number.isFinite(x) && x > 0 ? Math.round(x) : 0; };
  return mutate(async db => {
    const b = msg.holdout ? db.totals.perf.off : db.totals.perf.on;
    b.n++;
    if (num(msg.lcp)) { b.lcpN++; b.lcpSum += num(msg.lcp); }
    b.loadSum += num(msg.load);
    for (const k of Object.keys(db.totals.loader)) db.totals.loader[k] += Math.min(num(msg.loader?.[k]), 1000);
    await dlog('perf', { holdout: !!msg.holdout, lcp: num(msg.lcp), load: num(msg.load) });
  });
}
function recordClick(msg, sender) {
  const host = hostOf(sender.url);
  if (!host || sender.tab?.incognito) return;
  return mutate(async db => {
    const key = msg.sameOrigin ? normPath(msg.path) : '→' + String(msg.toHost || '?').slice(0, 60);
    const paths = db.clicks[host] ||= {};
    paths[key] = (paths[key] || 0) + 1;
    const keys = Object.keys(paths);
    if (keys.length > MAX_PATHS)
      keys.sort((a, b) => paths[a] - paths[b]).slice(0, keys.length - MAX_PATHS).forEach(k => delete paths[k]);
    siteOf(db, host).clicks++; db.totals.clicks++; dayOf(db).clicks++;
    await dlog('click', { host, key });
  });
}
function collectBlocked() {
  return mutate(async db => {
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ minTimeStamp: db.totals.lastBlockedTs });
    if (!rulesMatchedInfo.length) return;
    db.totals.blocked += rulesMatchedInfo.length;
    dayOf(db).blocked += rulesMatchedInfo.length;
    db.totals.lastBlockedTs = Math.max(...rulesMatchedInfo.map(r => r.timeStamp)) + 1;
    await dlog('blocked', { count: rulesMatchedInfo.length });
  });
}
function validDb(d) {
  return d && [1, 2, 3].includes(d.schema) &&
    ['totals', 'protocols', 'sites', 'clicks', 'days', 'index'].every(k => d[k] && typeof d[k] === 'object') &&
    d.totals.ttfb?.prefetch && d.totals.ttfb?.normal;
}

// ================= v3.3: Sekme bütçe yöneticisi =================
const restoring = new Map(); // tabId -> uyandırma başlangıcı (ms)
let cycling = false;

const allowed = (h, list) => (list || []).some(a => h === a || h.endsWith('.' + a));

// Uyutulamaz nedenler; null = aday
function classify(t, cfg) {
  if (t.discarded) return 'sleeping';
  if (t.active) return 'active';
  if (t.pinned) return 'pinned';
  if (t.audible) return 'audible';
  if (t.autoDiscardable === false) return 'noDiscard';
  if (t.incognito) return 'incognito';
  const h = hostOf(t.url || t.pendingUrl);
  if (!h) return 'internal';
  if (allowed(h, cfg.allowlist)) return 'allowlist';
  return null;
}

async function planCycle(cfg) {
  const now = Date.now();
  const [tabs, mem] = await Promise.all([chrome.tabs.query({}), chrome.system.memory.getInfo()]);
  const usedPct = Math.round(100 * (1 - mem.availableCapacity / mem.capacity));
  const P = QL.POLICY[cfg.mode] || QL.POLICY.dengeli;
  const rows = tabs.map(t => ({ t, reason: classify(t, cfg), idle: now - (t.lastAccessed || now) }));
  const hot = rows.filter(r => r.reason !== 'sleeping').length;
  const elig = rows.filter(r => !r.reason).sort((a, b) => b.idle - a.idle); // en eski önce
  const MIN_IDLE = 2 * 60000;
  const pick = new Map(); // satır -> neden
  for (const r of elig) if (r.idle >= P.idleMin * 60000) pick.set(r, 'idle');            // 1) boşta süresi
  for (const r of elig) {                                                                // 2) sıcak sekme üst sınırı
    if (hot - pick.size <= P.maxHot) break;
    if (!pick.has(r) && r.idle >= MIN_IDLE) pick.set(r, 'maxHot');
  }
  if (usedPct >= P.memPct) {                                                             // 3) bellek baskısı
    let extra = 5;
    for (const r of elig) { if (extra <= 0) break; if (!pick.has(r) && r.idle >= MIN_IDLE) { pick.set(r, 'mem'); extra--; } }
  }
  const chosen = elig.filter(r => pick.has(r)).slice(0, P.batch).map(r => { r.why = pick.get(r); return r; });
  return { rows, hot, usedPct, mem, chosen, open: tabs.length };
}

// Uyutmadan önce sayfaya sor: yazılmış/kaydedilmemiş veri veya oynayan medya var mı?
function probe(tabId) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, { type: 'probe' }).catch(() => null),
    new Promise(r => setTimeout(() => r(null), 1500))
  ]);
}

async function runCycle() {
  if (cycling) return;
  cycling = true;
  try {
    const cfg = await getCfg();
    const plan = await planCycle(cfg);
    const skipped = {};
    const bump = k => skipped[k] = (skipped[k] || 0) + 1;
    for (const r of plan.rows) if (r.reason && !['sleeping', 'active'].includes(r.reason)) bump(r.reason);
    const done = [];
    if (cfg.autoSleep) {
      for (const r of plan.chosen) {
        const p = await probe(r.t.id);
        if (!p) { bump('unknown'); continue; }
        if (p.dirty) { bump('dirty'); continue; }
        if (p.playing) { bump('playing'); continue; }
        try {
          const nt = await chrome.tabs.discard(r.t.id);
          if (nt) done.push({ id: nt.id, host: hostOf(r.t.url), why: r.why });
        } catch (_) { bump('failed'); }
      }
    }
    await task(async () => {
      const { dsc = {} } = await chrome.storage.session.get('dsc');
      done.forEach(d => { dsc[d.id] = { t: Date.now(), host: d.host }; });
      await chrome.storage.session.set({ dsc });
      await applyDb(async db => {
        const sleeping = plan.rows.filter(r => r.reason === 'sleeping').length + done.length;
        db.tabs.discards += done.length;
        done.forEach(d => { db.tabs.reasons[d.why] = (db.tabs.reasons[d.why] || 0) + 1; });
        db.tabs.peakOpen = Math.max(db.tabs.peakOpen, plan.open);
        db.tabs.last = { t: Date.now(), open: plan.open, hot: plan.open - sleeping, sleeping, mode: cfg.mode, skipped };
        db.memory.push({ t: Date.now(), usedPct: plan.usedPct, availMB: Math.round(plan.mem.availableCapacity / 1048576), open: plan.open });
        db.memory = db.memory.slice(-MAX_MEM);
        await dlog('cycle', { open: plan.open, discarded: done.length, usedPct: plan.usedPct, skipped });
      });
    });
  } catch (e) { console.warn('[QuickLoad] cycle', e); }
  finally { cycling = false; }
}

// Uyku/uyanma muhasebesi
chrome.tabs.onActivated.addListener(({ tabId }) => task(async () => {
  const { dsc = {} } = await chrome.storage.session.get('dsc');
  const e = dsc[tabId]; if (!e) return;
  delete dsc[tabId];
  await chrome.storage.session.set({ dsc });
  restoring.set(tabId, Date.now());
  await applyDb(async db => { db.tabs.restores++; db.tabs.discardedHours += (Date.now() - e.t) / 36e5; });
}));
chrome.tabs.onUpdated.addListener((id, info) => {
  if (info.status !== 'complete' || !restoring.has(id)) return;
  const ms = Date.now() - restoring.get(id); restoring.delete(id);
  mutate(async db => { db.tabs.restoreTimed++; db.tabs.restoreMs += ms; });
});
chrome.tabs.onRemoved.addListener(tabId => {
  restoring.delete(tabId); deact.delete(tabId);
  task(async () => {
    const { dsc = {} } = await chrome.storage.session.get('dsc');
    const e = dsc[tabId]; if (!e) return;
    delete dsc[tabId];
    await chrome.storage.session.set({ dsc });
    await applyDb(async db => { db.tabs.discardedHours += (Date.now() - e.t) / 36e5; });
  });
});
chrome.tabs.onReplaced.addListener((added, removed) => task(async () => {
  const { dsc = {} } = await chrome.storage.session.get('dsc');
  if (dsc[removed]) { dsc[added] = dsc[removed]; delete dsc[removed]; await chrome.storage.session.set({ dsc }); }
  if (restoring.has(removed)) { restoring.set(added, restoring.get(removed)); restoring.delete(removed); }
}));

// Sekmeye dönüş aralığı histogramı (uyutma eşiğini gerçek davranıştan seçmek için)
const curActive = new Map(), deact = new Map();
const bucketOf = ms => ms < 6e4 ? '<1m' : ms < 3e5 ? '1-5m' : ms < 9e5 ? '5-15m' : ms < 27e5 ? '15-45m' : ms < 72e5 ? '45-120m' : '>120m';
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  const now = Date.now(), prev = curActive.get(windowId);
  if (prev !== undefined && prev !== tabId) deact.set(prev, now);
  curActive.set(windowId, tabId);
  const t0 = deact.get(tabId);
  if (t0 && prev !== tabId) {
    deact.delete(tabId);
    const b = bucketOf(now - t0);
    mutate(async db => { db.tabs.revisit[b] = (db.tabs.revisit[b] || 0) + 1; });
  }
});

// Hatırlatıcı (isteğe bağlı bildirim)
async function remind() {
  const cfg = await getCfg();
  if (!cfg.reminders) return;
  const db = await loadDb();
  const { dsc = {} } = await chrome.storage.session.get('dsc');
  const last = db.tabs.last, mem = db.memory[db.memory.length - 1];
  const wh = QL.hoursSaved(db, dsc) * cfg.wattPerTab;
  chrome.notifications.create({
    type: 'basic', iconUrl: 'icons/icon128.png', title: 'QuickLoad',
    message: QL.message({ open: last.open, sleeping: Object.keys(dsc).length, usedPct: mem?.usedPct || 0, wh,
      prefetched: db.totals.prefetched, blocked: db.totals.blocked })
  });
}

// ---- Kural seti, alarmlar, yaşam döngüsü ----
async function syncRules() {
  const { blockTrackers } = await getCfg();
  await chrome.declarativeNetRequest.updateEnabledRulesets(
    blockTrackers ? { enableRulesetIds: ['trackers'] } : { disableRulesetIds: ['trackers'] });
  await chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: !!blockTrackers });
}
async function setupAlarms() {
  const cfg = await getCfg();
  chrome.alarms.create('collect', { periodInMinutes: 2 });
  chrome.alarms.create('tabs', { periodInMinutes: 1 });
  if (cfg.reminders) chrome.alarms.create('remind', { periodInMinutes: Math.max(15, Number(cfg.reminderMin) || 60) });
  else chrome.alarms.clear('remind');
}
async function init() {
  const cur = await chrome.storage.sync.get(null);
  await chrome.storage.sync.set({ ...DEFAULTS, ...cur });
  await mutate(() => {});
  await syncRules();
  await setupAlarms();
}
chrome.runtime.onInstalled.addListener(async d => {
  await init();
  // v3.4: gerçek veri, uyutulan her sekmeye kısa sürede dönüldüğünü gösterdi; uyutmayı bir kez kapat
  const { migratedV34 } = await chrome.storage.sync.get({ migratedV34: false });
  if (!migratedV34) { await chrome.storage.sync.set({ migratedV34: true, ...(d.reason === 'update' ? { autoSleep: false } : {}) }); }
});
chrome.runtime.onStartup.addListener(() => { syncRules(); setupAlarms(); });
chrome.alarms.onAlarm.addListener(a => {
  if (a.name === 'collect') collectBlocked();
  else if (a.name === 'tabs') runCycle();
  else if (a.name === 'remind') remind();
});
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'sync') return;
  if (c.blockTrackers) syncRules();
  if (c.reminders || c.reminderMin) setupAlarms();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg?.type) {
    case 'nav': if (sender.tab) recordNav(msg, sender); break;
    case 'click': if (sender.tab) recordClick(msg, sender); break;
    case 'perf': if (sender.tab) recordPerf(msg, sender); break;
    case 'hints': {
      const host = hostOf(sender.url);
      if (!sender.tab || sender.tab.incognito || !host) { sendResponse([]); break; }
      loadDb().then(db => sendResponse(Object.entries(db.clicks[host] || {})
        .filter(([k, n]) => !k.startsWith('→') && n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 10)))
        .catch(() => sendResponse([]));
      return true;
    }
    case 'collect': collectBlocked().finally(() => sendResponse(true)); return true;
    case 'runCycle': runCycle().finally(() => sendResponse(true)); return true;
    case 'tabsReport':
      getCfg().then(planCycle).then(p => sendResponse({
        usedPct: p.usedPct, open: p.open,
        rows: p.rows.map(r => ({ host: hostOf(r.t.url || r.t.pendingUrl) || '(dahili)', idleMin: Math.round(r.idle / 60000),
          state: r.reason || 'aday', picked: p.chosen.includes(r), why: r.why || '' }))
      })).catch(() => sendResponse(null));
      return true;
    case 'reset':
      task(async () => { await chrome.storage.local.set({ db: await seedDb(), debugLog: [] }); }).finally(() => sendResponse(true));
      return true;
    case 'import':
      if (!validDb(msg.db)) { sendResponse({ ok: false, error: 'Geçersiz db.json (schema 1 veya 2 bekleniyor)' }); break; }
      task(async () => { await migrate(msg.db); rebuildIndex(msg.db); await chrome.storage.local.set({ db: msg.db }); })
        .then(() => sendResponse({ ok: true }));
      return true;
  }
});
