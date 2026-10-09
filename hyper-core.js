/**
 * QuickLoad Hyper-Engine v3.4 (içerik scripti)
 *  Kademe 1: Speculation Rules (document rules, moderate)
 *  Kademe 2: rel=prefetch yedeği (CSP engeli / desteksiz tarayıcı)
 *  Geçmişe dayalı ısınma: sık tıklanan, görünür ve tam eşleşen en fazla 2 bağlantı
 *  İçerik/video yükleyici: ekran dışı iframe/görsel/video ertelenir, ekrana yaklaşınca öne alınır
 *  Ölçüm: TTFB, LCP, yükleme olayı, giriş türü, ham protokol, %10 deney (holdout) grubu
 */
(() => {
  if (window.__hyperEngine) return;

  const TOKENS = ['logout', 'signout', 'sign-out', 'log-out', 'delete', 'remove', 'cart', 'checkout',
                  'unsubscribe', 'cikis', 'odeme', 'sepet'];
  const SKIP_RE = new RegExp('(' + TOKENS.join('|') + ')', 'i');
  const FRAME_SKIP_RE = /(recaptcha|captcha|payment|3ds|stripe|paypal|checkout|login|oauth|sso|auth)/i;
  const ST = { imgLazy: 0, iframeLazy: 0, videoDeferred: 0, videoPromoted: 0, preconnect: 0,
               historyWarm: 0, historyHit: 0, fallbackPrefetch: 0, cspBlocked: 0 };
  const cfg = { speculation: true, smartLoad: true, historyWarm: true, holdout: true };
  const supports = !!(HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules'));
  const conn = navigator.connection;
  const slow = () => !!(conn && (conn.saveData || /^(slow-2g|2g)$/.test(conn.effectiveType || '')));
  const good = () => !(conn && (conn.saveData || /^(slow-2g|2g|3g)$/.test(conn.effectiveType || '')));

  let holdout = false, prevHoldout = false, cspBlocked = false;
  let specEl = null, t0 = 0;

  // ---------- yardımcılar ----------
  function norm(p) { // background.js normPath ile aynı mantık
    const seg = (p || '/').split('/').filter(Boolean).slice(0, 3).map(s =>
      /^\d+$/.test(s) || /^[0-9a-f-]{16,}$/i.test(s) || s.length > 24 ? ':id' : s.slice(0, 40));
    return '/' + seg.join('/');
  }
  function okLink(a) {
    if (!a || !a.href) return null;
    let u; try { u = new URL(a.href); } catch (_) { return null; }
    if (!/^https?:$/.test(u.protocol) || u.origin !== location.origin) return null;
    if (u.pathname === location.pathname && u.search === location.search) return null;
    if (a.hasAttribute('download') || a.target === '_blank' || /\bnofollow\b/i.test(a.rel || '')) return null;
    if (SKIP_RE.test(u.pathname + u.search)) return null;
    return u;
  }
  const whenIdle = fn => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 1500));
  const afterDom = fn => (document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', () => whenIdle(fn), { once: true }) : whenIdle(fn));
  function addRules(rules) {
    const s = document.createElement('script');
    s.type = 'speculationrules';
    s.textContent = JSON.stringify(rules);
    t0 = performance.now();
    (document.head || document.documentElement).appendChild(s);
    return s;
  }

  // ---------- Kademe 1: Speculation Rules ----------
  function enableSpec() {
    if (specEl || !supports || cspBlocked) return;
    specEl = addRules({ prefetch: [{ eagerness: 'moderate', where: { and: [
      { href_matches: '/*' },
      { not: { or: [
        ...TOKENS.map(t => ({ href_matches: { pathname: `*${t}*` } })),
        ...TOKENS.map(t => ({ href_matches: { search: `*${t}*` } })),
        { selector_matches: '[download], [rel~=nofollow], [target=_blank]' }
      ] } }
    ] } }] });
  }
  function disableSpec() { specEl?.remove(); specEl = null; }

  // Olası CSP engeli: kendi eklememizden hemen sonra gelen satır içi script ihlali
  document.addEventListener('securitypolicyviolation', e => {
    if (!specEl || cspBlocked) return;
    if (e.blockedURI === 'inline' && /script/.test(e.violatedDirective) && performance.now() - t0 < 150) {
      cspBlocked = true; ST.cspBlocked++;
      disableSpec();
      startFallback();
    }
  }, true);

  // ---------- Kademe 2: rel=prefetch yedeği ----------
  const fbSeen = new Set();
  let fbOn = false, fbTimer = 0;
  function fbPrefetch(href) {
    href = href.split('#')[0];
    if (fbSeen.has(href) || fbSeen.size >= 12) return;
    fbSeen.add(href);
    const l = document.createElement('link');
    l.rel = 'prefetch'; l.as = 'document'; l.href = href;
    (document.head || document.documentElement).appendChild(l);
    ST.fallbackPrefetch++;
  }
  const onOver = e => {
    const u = okLink(e.target?.closest?.('a[href]'));
    if (!u) return;
    clearTimeout(fbTimer);
    fbTimer = setTimeout(() => fbPrefetch(u.href), 65); // niyet gecikmesi
  };
  const onOut = () => clearTimeout(fbTimer);
  const onTouch = e => { const u = okLink(e.target?.closest?.('a[href]')); if (u) fbPrefetch(u.href); };
  function startFallback() {
    if (fbOn || holdout || !cfg.speculation || slow()) return;
    fbOn = true;
    document.addEventListener('pointerover', onOver, { passive: true, capture: true });
    document.addEventListener('pointerout', onOut, { passive: true, capture: true });
    document.addEventListener('touchstart', onTouch, { passive: true, capture: true });
  }
  function stopFallback() {
    fbOn = false;
    document.removeEventListener('pointerover', onOver, true);
    document.removeEventListener('pointerout', onOut, true);
    document.removeEventListener('touchstart', onTouch, true);
  }
  const startPrefetch = () => (supports ? enableSpec() : startFallback());

  // ---------- Geçmişe dayalı ısınma ----------
  async function historyWarm() {
    if (holdout || !cfg.historyWarm || !good()) return;
    let hints;
    try { hints = await chrome.runtime.sendMessage({ type: 'hints' }); } catch (_) { return; }
    if (!Array.isArray(hints) || !hints.length) return;
    const score = new Map(hints);
    const cand = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const u = okLink(a); if (!u) continue;
      const exact = u.pathname.replace(/\/+$/, '') || '/';
      const k = norm(u.pathname);
      if (k !== exact || !score.has(k)) continue; // yalnızca tam ve belirsiz olmayan eşleşme
      const r = a.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight * 1.5)) continue;
      cand.push([u.href.split('#')[0], score.get(k)]);
      if (cand.length > 200) break;
    }
    const urls = [...new Set(cand.sort((a, b) => b[1] - a[1]).map(c => c[0]))].slice(0, 2);
    if (!urls.length) return;
    ST.historyWarm += urls.length;
    try { sessionStorage.setItem('ql_warm', JSON.stringify(urls)); } catch (_) {}
    if (supports && !cspBlocked) addRules({ prefetch: [{ urls }] }); else urls.forEach(fbPrefetch);
  }
  function checkWarmHit() {
    try {
      const w = JSON.parse(sessionStorage.getItem('ql_warm') || '[]');
      if (w.includes(location.href.split('#')[0])) { ST.historyHit++; sessionStorage.removeItem('ql_warm'); }
    } catch (_) {}
  }

  // ---------- İçerik / video yükleyici ----------
  let imgSeen = 0, ifrSeen = 0, processed = 0, mo = null;
  const pre = new Set();
  const vio = new IntersectionObserver(onVideoIO, { rootMargin: '300px 0px' });

  function preconnect(src) {
    try {
      const o = new URL(src, location.href).origin;
      if (!/^https?:/.test(o) || o === location.origin || pre.has(o) || pre.size >= 3) return;
      pre.add(o);
      const l = document.createElement('link');
      l.rel = 'preconnect'; l.href = o; l.crossOrigin = '';
      (document.head || document.documentElement).appendChild(l);
      ST.preconnect++;
    } catch (_) {}
  }
  const mediaSrc = v => v.currentSrc || v.getAttribute('src') || v.querySelector('source')?.getAttribute('src') || '';
  function nudge(v) { // yalnızca henüz hiçbir şey yüklenmemiş, düz kaynaklı videoda
    try { if (v.readyState === 0 && v.paused && !v.currentTime && !mediaSrc(v).startsWith('blob:')) v.load(); } catch (_) {}
  }
  function restore(v) {
    if (!v.__qlDef) return;
    v.__qlDef = 0;
    v.preload = v.__qlOrig || 'auto';
    nudge(v);
  }
  function handleVideo(v) {
    if (v.__ql) return; v.__ql = 1;
    if (v.autoplay || v.getAttribute('preload') === 'none') return;
    vio.observe(v);
    v.addEventListener('play', () => restore(v), { once: true });
    v.addEventListener('pointerenter', () => restore(v), { once: true });
  }
  function onVideoIO(entries) {
    for (const e of entries) {
      const v = e.target;
      const src = mediaSrc(v);
      if (e.isIntersecting) {
        if (src) preconnect(src);
        if (v.__qlDef && !v.__qlProm) {
          v.__qlProm = 1;
          if (good()) { v.preload = 'metadata'; ST.videoPromoted++; nudge(v); }
        }
      } else if (!v.__qlDef && v.getAttribute('preload') === 'auto' && v.readyState === 0 &&
                 src && !src.startsWith('blob:')) {
        v.__qlOrig = 'auto'; v.__qlDef = 1; v.preload = 'none'; ST.videoDeferred++;
      }
    }
  }
  function handleImg(i) {
    if (i.__ql) return; i.__ql = 1;
    if (++imgSeen <= 4) return; // ilk görseller büyük olasılıkla ekranda
    if (i.hasAttribute('loading') || i.fetchPriority === 'high') return;
    i.loading = 'lazy'; ST.imgLazy++;
  }
  function handleFrame(f) {
    if (f.__ql) return; f.__ql = 1;
    if (++ifrSeen <= 1) return;
    const s = f.getAttribute('src') || '';
    if (f.hasAttribute('loading') || !s || /^(about|javascript):/i.test(s) || FRAME_SKIP_RE.test(s)) return;
    f.loading = 'lazy'; ST.iframeLazy++;
  }
  function dispatch(n) {
    if (processed++ > 800) return;
    const t = n.tagName;
    if (t === 'IMG') handleImg(n); else if (t === 'IFRAME') handleFrame(n); else if (t === 'VIDEO') handleVideo(n);
  }
  function scan(root) {
    if (root.nodeType !== 1) return;
    dispatch(root);
    if (root.firstElementChild) root.querySelectorAll('img,iframe,video').forEach(dispatch);
  }
  function startLoader() {
    if (mo || holdout) return;
    mo = new MutationObserver(ms => { for (const m of ms) m.addedNodes.forEach(scan); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    document.querySelectorAll('img,iframe,video').forEach(dispatch);
  }
  function stopLoader() { mo?.disconnect(); mo = null; }

  // ---------- Ölçüm ----------
  let lcp = 0, sent = false;
  try {
    new PerformanceObserver(l => { const e = l.getEntries(); if (e.length) lcp = e[e.length - 1].startTime; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (_) {}
  function viaOf() {
    try {
      if (!document.referrer) return 'direct';
      return new URL(document.referrer).origin === location.origin ? 'same' : 'external';
    } catch (_) { return 'direct'; }
  }
  function report() {
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      if (!nav || nav.type === 'reload' || nav.type === 'back_forward') return;
      const via = viaOf();
      const prefetched = nav.deliveryType === 'navigational-prefetch' || nav.activationStart > 0;
      chrome.runtime.sendMessage({ type: 'nav', prefetched, ttfb: nav.responseStart - nav.startTime,
        protocol: nav.nextHopProtocol, via, prevHoldout: prevHoldout && via === 'same' });
    } catch (_) {}
  }
  function sendPerf() {
    if (sent) return; sent = true;
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      chrome.runtime.sendMessage({ type: 'perf', holdout, lcp,
        load: nav && nav.loadEventEnd > 0 ? nav.loadEventEnd - nav.startTime : 0, loader: ST });
    } catch (_) {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') sendPerf(); });
  addEventListener('pagehide', sendPerf);

  // ---------- Tıklama, sekme uykusu sinyalleri ----------
  document.addEventListener('click', e => {
    const a = e.target?.closest?.('a[href]');
    if (!a) return;
    try {
      const u = new URL(a.href);
      if (!/^https?:$/.test(u.protocol)) return;
      chrome.runtime.sendMessage({ type: 'click', sameOrigin: u.origin === location.origin, path: u.pathname, toHost: u.hostname });
    } catch (_) {}
  }, true);

  let dirty = false;
  addEventListener('input', e => { if (e.isTrusted) dirty = true; }, true);
  addEventListener('submit', () => { dirty = false; }, true);
  function playing() {
    if (document.pictureInPictureElement) return true;
    return [...document.querySelectorAll('video,audio')].some(m =>
      (!m.paused && !m.ended) ||
      (m.srcObject instanceof MediaStream && m.srcObject.getTracks().some(t => t.readyState === 'live')));
  }
  chrome.runtime.onMessage.addListener((m, _s, send) => {
    if (m?.type === 'probe') send({ dirty, playing: playing() });
  });

  // ---------- Başlatma ----------
  const cfgReady = new Promise(res => chrome.storage.sync.get(cfg, res));
  cfgReady.then(c => {
    Object.assign(cfg, c);
    holdout = !!cfg.holdout && Math.random() < 0.1; // %10 deney grubu: iyileştirmeler kapalı
    try {
      prevHoldout = sessionStorage.getItem('ql_hold') === '1';
      sessionStorage.setItem('ql_hold', holdout ? '1' : '0');
    } catch (_) {}
    checkWarmHit();
    if (holdout) return;
    if (cfg.speculation && !slow()) startPrefetch();
    if (cfg.smartLoad) startLoader();
    if (cfg.historyWarm) afterDom(historyWarm);
  });
  const onLoaded = () => cfgReady.then(() => setTimeout(report, 0));
  if (document.readyState === 'complete') onLoaded(); else addEventListener('load', onLoaded, { once: true });

  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'sync' || holdout) return;
    if (c.speculation) {
      cfg.speculation = c.speculation.newValue;
      if (cfg.speculation && !slow()) startPrefetch(); else { disableSpec(); stopFallback(); }
    }
    if (c.smartLoad) { cfg.smartLoad = c.smartLoad.newValue; cfg.smartLoad ? startLoader() : stopLoader(); }
    if (c.historyWarm) cfg.historyWarm = c.historyWarm.newValue;
  });

  window.__hyperEngine = { stats: ST, get holdout() { return holdout; } };
})();
