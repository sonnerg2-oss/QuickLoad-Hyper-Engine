const $ = id => document.getElementById(id);
const fmt = n => Number(n || 0).toLocaleString('tr-TR');
let db = null, log = [], cfg = {}, dsc = {}, tab = 'load', filter = '';
const STATE = { aday: 'Uyutulabilir', active: 'Aktif', sleeping: 'Uyuyor', pinned: 'Sabitli', audible: 'Ses çalıyor',
  allowlist: 'İzin listesi', noDiscard: 'Chrome korumalı', internal: 'Dahili sayfa', incognito: 'Gizli' };

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function table(headers, rows) {
  const t = el('table'), hr = el('tr');
  headers.forEach(h => hr.append(el('th', h)));
  const th = el('thead'); th.append(hr); t.append(th);
  const tb = el('tbody');
  rows.forEach(r => { const tr = el('tr'); r.forEach(c => tr.append(el('td', String(c)))); tb.append(tr); });
  t.append(tb);
  return t;
}
const when = ts => ts ? new Date(ts).toLocaleString('tr-TR') : '-';

function spark(samples) {
  const NS = 'http://www.w3.org/2000/svg', W = 600, H = 80;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
  if (samples.length < 2) return el('p', 'Bellek grafiği için en az 2 örnek gerekir (dakikada bir alınır).', 'hint');
  const pts = samples.map((s, i) => `${(i / (samples.length - 1) * W).toFixed(1)},${(H - s.usedPct / 100 * H).toFixed(1)}`).join(' ');
  const pl = document.createElementNS(NS, 'polyline');
  pl.setAttribute('points', pts); pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', '#38bdf8'); pl.setAttribute('stroke-width', '2');
  svg.append(pl);
  const wrap = el('div'); wrap.append(el('p', `RAM kullanımı % (son ${samples.length} örnek, dakikada bir)`, 'hint'), svg);
  return wrap;
}

function renderCards() {
  const c = $('cards'); c.replaceChildren();
  if (!db) return;
  const t = db.totals, p = t.ttfb.prefetch, n = t.ttfb.normal, tb = db.tabs;
  const hours = QL.hoursSaved(db, dsc), wh = hours * (cfg.wattPerTab ?? QL.WATT_PER_TAB);
  [['Gezinti', fmt(t.navs)], ['Ön yüklenen', fmt(t.prefetched)], ['Engellenen', fmt(t.blocked)], ['Tıklama', fmt(t.clicks)],
   ['Uyutma', fmt(tb.discards)], ['Uyanma', fmt(tb.restores)],
   ['Ort. uyanma', tb.restoreTimed ? Math.round(tb.restoreMs / tb.restoreTimed) + ' ms' : '-'],
   ['Uyku saati', hours.toFixed(1)], ['Tahmini enerji', QL.fmtWh(wh)], ['En çok açık sekme', fmt(tb.peakOpen)],
   ['TTFB ön yük.', p.n ? Math.round(p.sum / p.n) + ' ms' : '-'], ['TTFB normal', n.n ? Math.round(n.sum / n.n) + ' ms' : '-'],
   ['h3 / h2 / h1.1', `${db.protocols.h3 || 0} / ${db.protocols.h2 || 0} / ${db.protocols['http/1.1'] || 0}`]]
    .forEach(([l, v]) => { const d = el('div', undefined, 'card'); d.append(el('div', v, 'num'), el('div', l, 'lbl')); c.append(d); });
}

async function renderTabsView(v) {
  const bar = el('div', undefined, 'bar'), holder = el('div');
  const b1 = el('button', 'Kuru çalıştırma / yenile'), b2 = el('button', 'Şimdi çalıştır (uyutur)');
  bar.append(b1, b2); v.append(bar, holder);
  const load = async () => {
    holder.replaceChildren(el('p', 'Yükleniyor…', 'hint'));
    const r = await chrome.runtime.sendMessage({ type: 'tabsReport' }).catch(() => null);
    holder.replaceChildren();
    if (!r) { holder.append(el('p', 'Veri alınamadı.')); return; }
    holder.append(el('p', `Açık sekme: ${r.open} · RAM: %${r.usedPct} · Bu turda uyutulacak: ${r.rows.filter(x => x.picked).length}`, 'hint'));
    holder.append(table(['Site', 'Durum', 'Boşta (dk)', 'Bu tur'],
      r.rows.sort((a, b) => b.idleMin - a.idleMin).map(x => [x.host, STATE[x.state] || x.state, x.idleMin, x.picked ? 'Uyutulacak' : ''])));
    const sk = db?.tabs.last.skipped || {};
    holder.append(el('p', 'Son turda atlananlar: ' + (Object.entries(sk).map(([k, n]) => `${k}:${n}`).join(' ') || '-'), 'hint'));
    holder.append(spark(db?.memory || []));
  };
  b1.addEventListener('click', load);
  b2.addEventListener('click', async () => { b2.disabled = true; await chrome.runtime.sendMessage({ type: 'runCycle' }); b2.disabled = false; load(); });
  load();
}

const LOADER = { imgLazy: 'Ertelenen görsel', iframeLazy: 'Ertelenen iframe', videoDeferred: 'Ertelenen video',
  videoPromoted: 'Öne alınan video', preconnect: 'Ön bağlantı (preconnect)', historyWarm: 'Geçmişe dayalı ısınma',
  historyHit: 'Isınma isabeti', fallbackPrefetch: 'rel=prefetch yedeği', cspBlocked: 'Olası CSP engeli' };
function renderLoad(v) {
  const T = db.totals, avg = (s, n) => n ? Math.round(s / n) : '-', P = T.perf;
  const h = t => v.append(el('p', t, 'lbl'));
  h('Ön yükleme karşılaştırması (ilk bayt)');
  v.append(table(['Grup', 'Sayfa', 'Ort. TTFB (ms)'], [
    ['Ön yüklenerek açıldı', T.ttfb.prefetch.n, avg(T.ttfb.prefetch.sum, T.ttfb.prefetch.n)],
    ['Normal', T.ttfb.normal.n, avg(T.ttfb.normal.sum, T.ttfb.normal.n)],
    ['Deney: önceki sayfada ön yükleme kapalıydı', T.ttfb.holdout.n, avg(T.ttfb.holdout.sum, T.ttfb.holdout.n)]]));
  v.append(el('p', 'Deney grubu ile "ön yüklenen"i karşılaştırmak seçim yanlılığını azaltır; "normal" grup site bileşimi nedeniyle yanıltıcı olabilir.', 'hint'));
  h('Sayfanın tamamı (iyileştirmeler açık / deney grubu)');
  v.append(table(['Grup', 'Sayfa', 'Ort. LCP (ms)', 'Ort. yükleme olayı (ms)'], [
    ['İyileştirmeler açık', P.on.n, avg(P.on.lcpSum, P.on.lcpN), avg(P.on.loadSum, P.on.n)],
    ['Deney (kapalı)', P.off.n, avg(P.off.lcpSum, P.off.lcpN), avg(P.off.loadSum, P.off.n)]]));
  h('Aynı sitede ön yüklenen ve normal TTFB (en az 2 + 2 gezinti)');
  const rows = Object.entries(db.sites).filter(([, s]) => s.pTtfbSum !== undefined && s.prefetched >= 2 && s.visits - s.prefetched >= 2)
    .map(([host, s]) => { const pa = s.pTtfbSum / s.prefetched, na = (s.ttfbSum - s.pTtfbSum) / (s.visits - s.prefetched);
      return [host, s.prefetched, Math.round(pa), s.visits - s.prefetched, Math.round(na), Math.round(na - pa)]; })
    .sort((a, b) => b[5] - a[5]).slice(0, 30);
  v.append(rows.length ? table(['Site', 'Ön yük. n', 'Ön yük. ms', 'Normal n', 'Normal ms', 'Fark ms'], rows)
    : el('p', 'Henüz yeterli eşleşmiş veri yok.', 'hint'));
  h('Yükleyici sayaçları');
  v.append(table(['Sayaç', 'Adet'], Object.entries(T.loader).map(([k, n]) => [LOADER[k] || k, n])));
  h('Gezinti giriş türü');
  v.append(table(['Tür', 'Adet'], [['Aynı site içinden', T.origin.same], ['Dışarıdan', T.origin.external], ['Doğrudan / referanssız', T.origin.direct]]));
  h('Ham protokol değerleri');
  v.append(table(['nextHopProtocol', 'Adet'], Object.entries(T.rawProto).sort((a, b) => b[1] - a[1])));
  h('Sekmeye dönüş aralığı (uyutma eşiği için)');
  v.append(table(['Aralık', 'Adet'], Object.entries(db.tabs.revisit)));
  h('Uyutma nedenleri');
  v.append(table(['Neden', 'Adet'], Object.entries(db.tabs.reasons)));
}

function chk(key, label) {
  const d = el('label'), c = el('input');
  c.type = 'checkbox'; c.checked = cfg[key] !== false;
  c.addEventListener('change', () => chrome.storage.sync.set({ [key]: c.checked }));
  d.append(c, document.createTextNode(' ' + label)); d.style.display = 'block'; d.style.margin = '8px 0';
  return d;
}

function renderSettings(v) {
  const ta = el('textarea'); ta.rows = 8; ta.cols = 40; ta.value = (cfg.allowlist || []).join('\n');
  const w = el('input'); w.type = 'number'; w.step = '0.01'; w.min = '0'; w.value = cfg.wattPerTab ?? QL.WATT_PER_TAB;
  const m = el('input'); m.type = 'number'; m.min = '15'; m.value = cfg.reminderMin ?? 60;
  const save = el('button', 'Kaydet');
  save.addEventListener('click', async () => {
    const list = ta.value.split('\n').map(s => s.trim().toLowerCase()).filter(Boolean);
    await chrome.storage.sync.set({ allowlist: list, wattPerTab: Math.max(0, Number(w.value) || 0), reminderMin: Math.max(15, Number(m.value) || 60) });
    say('Kaydedildi');
  });
  const grp = (label, node, hint) => { const d = el('div'); d.style.margin = '10px 0'; d.append(el('div', label, 'lbl'), node); if (hint) d.append(el('div', hint, 'hint')); return d; };
  v.append(
    grp('Uyutulmayacak siteler (satır başına bir alan adı)', ta, 'Örn. mail.google.com — alt alan adları da kapsanır.'),
    grp('Enerji varsayımı: uyuyan sekme başına tasarruf (W)', w, 'Ölçüm değil, kabuldür. Sonuçlar bu değerle orantılı "tahmini" hesaplanır.'),
    grp('Hatırlatıcı aralığı (dk, en az 15)', m),
    chk('historyWarm', 'Geçmişe dayalı sayfa ısınması (sık tıklanan en fazla 2 bağlantı)'),
    chk('holdout', 'Deney grubu: sayfaların %10\'unda iyileştirmeleri kapat (ölçüm için)'), save);
}

function renderView() {
  const v = $('view'); v.replaceChildren();
  if (!db) { v.append(el('p', 'Veri yok.')); return; }
  if (tab === 'load') renderLoad(v);
  else if (tab === 'tabs') renderTabsView(v);
  else if (tab === 'settings') renderSettings(v);
  else if (tab === 'sites') {
    v.append(table(['#', 'Site', 'Ziyaret', 'Ön yük. %', 'Ort. TTFB', 'Protokoller', 'Tıklama', 'Son ziyaret'],
      db.index.topSites.map(([h], i) => {
        const s = db.sites[h] || {};
        return [i + 1, h, s.visits, s.visits ? Math.round(100 * s.prefetched / s.visits) + '%' : '-',
          s.visits ? Math.round(s.ttfbSum / s.visits) + ' ms' : '-',
          Object.entries(s.protocols || {}).map(([k, x]) => `${k}:${x}`).join(' '), s.clicks, when(s.lastVisit)];
      })));
  } else if (tab === 'clicks') {
    v.append(table(['#', 'Kaynak site', 'Hedef (yol veya →host)', 'Tıklama'], db.index.topClicks.map(([h, p, n], i) => [i + 1, h, p, n])));
  } else if (tab === 'days') {
    v.append(table(['Gün', 'Gezinti', 'Ön yüklenen', 'Engellenen', 'Tıklama'],
      Object.entries(db.days).sort().reverse().map(([d, x]) => [d, x.navs, x.prefetched, x.blocked, x.clicks])));
  } else if (tab === 'json') {
    const f = el('input'); f.type = 'text'; f.placeholder = 'Filtre (ör. host adı)'; f.value = filter;
    const pre = el('pre');
    const fill = () => {
      const full = JSON.stringify(db, null, 2);
      pre.textContent = filter ? full.split('\n').filter(l => l.toLowerCase().includes(filter.toLowerCase())).join('\n') : full;
    };
    f.addEventListener('input', () => { filter = f.value; fill(); });
    v.append(f, pre); fill();
  } else if (tab === 'log') {
    const clr = el('button', 'Günlüğü temizle');
    clr.addEventListener('click', () => chrome.storage.local.set({ debugLog: [] }));
    v.append(clr, table(['Zaman', 'Tür', 'Veri'], [...log].reverse().map(l => [when(l.t), l.type, JSON.stringify(l.data)])));
    if (!log.length) v.append(el('p', 'Kayıt yok. "Debug günlüğü"nü açıp gezinin.', 'hint'));
  }
}
function renderTabs() {
  const t = $('tabs'); t.replaceChildren();
  [['load', 'Yükleme'], ['tabs', 'Sekmeler'], ['sites', 'En çok erişilen siteler'], ['clicks', 'Tıklamalar'], ['days', 'Günlük'],
   ['settings', 'Ayarlar'], ['json', 'Ham JSON'], ['log', 'Debug günlüğü']].forEach(([id, label]) => {
    const b = el('button', label, id === tab ? 'on' : '');
    b.addEventListener('click', () => { tab = id; renderTabs(); renderView(); });
    t.append(b);
  });
}

let busy = false;
async function refresh() {
  const s = await chrome.storage.local.get(['db', 'debugLog']);
  db = s.db || null; log = s.debugLog || [];
  cfg = await chrome.storage.sync.get({ debug: false, allowlist: QL.DEFAULT_ALLOW, wattPerTab: QL.WATT_PER_TAB, reminderMin: 60, historyWarm: true, holdout: true });
  dsc = (await chrome.storage.session.get('dsc')).dsc || {};
  renderCards();
  // Form içindeyken ve sekme listesi yüklenirken yeniden çizim yapma (girdiyi kaybettirmesin)
  if (!busy && tab !== 'settings' && tab !== 'tabs') renderView();
  else if (!db || !$('view').firstChild) renderView();
  $('debugMode').textContent = 'Debug günlüğü: ' + (cfg.debug ? 'açık' : 'kapalı');
  $('debugMode').className = cfg.debug ? 'on' : '';
}
const say = t => { $('msg').textContent = t; setTimeout(() => $('msg').textContent = '', 4000); };

$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'db.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('import').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'import', db: JSON.parse(await f.text()) });
    say(res?.ok ? 'İçe aktarıldı' : res?.error || 'Hata');
  } catch (_) { say('Dosya okunamadı'); }
  e.target.value = '';
});
$('reset').addEventListener('click', async () => {
  if (confirm('Tüm istatistikler ve debug günlüğü silinsin mi?')) { await chrome.runtime.sendMessage({ type: 'reset' }); say('Sıfırlandı'); }
});
$('debugMode').addEventListener('click', async () => {
  const { debug } = await chrome.storage.sync.get({ debug: false });
  await chrome.storage.sync.set({ debug: !debug });
});

chrome.storage.onChanged.addListener(refresh);
renderTabs(); refresh();
