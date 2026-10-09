const TOGGLES = ['speculation', 'smartLoad', 'blockTrackers', 'autoSleep', 'reminders'];
const CFG = { speculation: true, blockTrackers: true, autoSleep: false, smartLoad: true, reminders: false, mode: 'dengeli', wattPerTab: QL.WATT_PER_TAB };
const $ = id => document.getElementById(id);
const fmt = n => Number(n || 0).toLocaleString('tr-TR');

function row(parent, left, right, cls) {
  const d = document.createElement('div'); d.className = 'row';
  const a = document.createElement('span'), b = document.createElement('span');
  a.textContent = left; b.textContent = right; if (cls) b.className = cls;
  d.append(a, b); parent.append(d);
}
function note(parent, text) { const s = document.createElement('small'); s.textContent = text; parent.append(s); }

async function render() {
  const [{ db }, cfg, { dsc = {} }, tabs, mem] = await Promise.all([
    chrome.storage.local.get('db'), chrome.storage.sync.get(CFG), chrome.storage.session.get('dsc'),
    chrome.tabs.query({}), chrome.system.memory.getInfo().catch(() => null)
  ]);
  const t = db?.totals;
  const open = tabs.length, sleeping = tabs.filter(x => x.discarded).length;
  const usedPct = mem ? Math.round(100 * (1 - mem.availableCapacity / mem.capacity)) : 0;
  const hours = QL.hoursSaved(db, dsc), wh = hours * cfg.wattPerTab;

  $('sOpen').textContent = fmt(open);
  $('sSleep').textContent = fmt(sleeping);
  $('sRam').textContent = mem ? '%' + usedPct : '-';
  $('sEnergy').textContent = QL.fmtWh(wh);
  $('msg').textContent = QL.message({ open, sleeping, usedPct, wh, prefetched: t?.prefetched, blocked: t?.blocked });

  const tc = $('tabCmp'); tc.replaceChildren();
  const tb = db?.tabs;
  row(tc, 'Toplam uyutma / uyanma', `${fmt(tb?.discards)} / ${fmt(tb?.restores)}`);
  if (tb?.restoreTimed) row(tc, 'Uyanma süresi (ort.)', Math.round(tb.restoreMs / tb.restoreTimed) + ' ms');
  row(tc, 'Uyku süresi toplamı', hours.toFixed(1) + ' saat');
  note(tc, 'Enerji, varsayıma dayalı tahmindir (ölçüm değildir); varsayım debug panelinden ayarlanır.');

  $('sPrefetch').textContent = fmt(t?.prefetched);
  $('sBlocked').textContent = fmt(t?.blocked);
  $('since').textContent = db ? new Date(db.createdAt).toLocaleDateString('tr-TR') + ' tarihinden beri' : '';

  const cmp = $('cmp'); cmp.replaceChildren();
  const p = t?.ttfb.prefetch, n = t?.ttfb.normal;
  if (p && n && p.n >= 3 && n.n >= 3) {
    const pa = Math.round(p.sum / p.n), na = Math.round(n.sum / n.n), diff = na - pa;
    row(cmp, 'Ort. ilk bayt (ön yüklenen)', pa + ' ms');
    row(cmp, 'Ort. ilk bayt (normal)', na + ' ms');
    if (diff > 0) row(cmp, 'Fark', '−' + diff + ' ms', 'good');
  } else note(cmp, `Karşılaştırma için veri toplanıyor (ön yüklenen: ${p?.n || 0}, normal: ${n?.n || 0}).`);

  const lb = $('loadBox'); lb.replaceChildren();
  const L = t?.loader, pf = t?.perf;
  if (L) {
    row(lb, 'Ertelenen görsel / iframe', `${fmt(L.imgLazy)} / ${fmt(L.iframeLazy)}`);
    row(lb, 'Ertelenen / öne alınan video', `${fmt(L.videoDeferred)} / ${fmt(L.videoPromoted)}`);
    row(lb, 'Geçmişe dayalı ısınma (isabet)', `${fmt(L.historyWarm)} (${fmt(L.historyHit)})`);
    if (pf.on.lcpN >= 5 && pf.off.lcpN >= 5)
      row(lb, 'Ort. LCP (açık / deney)', `${Math.round(pf.on.lcpSum / pf.on.lcpN)} / ${Math.round(pf.off.lcpSum / pf.off.lcpN)} ms`);
    else note(lb, `Etki karşılaştırması için veri toplanıyor (açık: ${pf.on.lcpN}, deney grubu: ${pf.off.lcpN} sayfa).`);
  }

  const top = $('top'); top.replaceChildren();
  const list = (db?.index.topSites || []).slice(0, 5);
  if (!list.length) note(top, 'Henüz veri yok.');
  list.forEach(([h, v]) => row(top, h, fmt(v) + ' ziyaret'));

  const rulesOn = (await chrome.declarativeNetRequest.getEnabledRulesets()).includes('trackers');
  const st = $('status');
  if (cfg.blockTrackers && !rulesOn) { st.className = 'status warn'; st.textContent = '⚠ Engelleyici kural seti etkin değil'; }
  else {
    st.className = 'status';
    st.textContent = `⚡ Aktif · ön yükleme: ${cfg.speculation ? 'açık' : 'kapalı'} · engelleyici: ${rulesOn ? 'açık' : 'kapalı'} · uyku: ${cfg.autoSleep ? cfg.mode : 'kapalı'}`;
  }
}

chrome.storage.sync.get(CFG, cfg => {
  TOGGLES.forEach(k => {
    $(k).checked = !!cfg[k];
    $(k).addEventListener('change', async () => { await chrome.storage.sync.set({ [k]: $(k).checked }); setTimeout(render, 150); });
  });
  $('mode').value = cfg.mode;
  $('mode').addEventListener('change', async () => { await chrome.storage.sync.set({ mode: $('mode').value }); render(); });
});
$('reset').addEventListener('click', async () => {
  if (!confirm('Tüm istatistikler silinsin mi?')) return;
  await chrome.runtime.sendMessage({ type: 'reset' }); render();
});
$('debug').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('debug.html') }));

chrome.runtime.sendMessage({ type: 'collect' }).catch(() => {}).finally(render);
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.db) render(); });
