// QuickLoad v3.3 - ortak sabitler ve yardımcılar (service worker, popup, debug paneli)
globalThis.QL = {
  // Varsayım: uyutulan bir sekmenin arka plan yükünden ortalama tasarruf (W). ÖLÇÜM DEĞİL, ayarlanabilir.
  WATT_PER_TAB: 0.03,
  PHONE_WH: 12, // Eğlenceli karşılaştırma için tipik telefon pil kapasitesi (yaklaşık)
  // Başlangıç değerleri tahmindir; gerçek kullanımdan toplanan veriyle ayarlanmalıdır.
  POLICY: {
    temkinli: { idleMin: 90, maxHot: 60, memPct: 90, batch: 8 },
    dengeli:  { idleMin: 45, maxHot: 30, memPct: 80, batch: 8 },
    agresif:  { idleMin: 15, maxHot: 15, memPct: 75, batch: 8 }
  },
  DEFAULT_ALLOW: ['meet.google.com', 'zoom.us', 'teams.microsoft.com', 'teams.live.com', 'discord.com', 'web.whatsapp.com'],

  hoursSaved(db, dsc) {
    let h = db?.tabs?.discardedHours || 0;
    const now = Date.now();
    for (const e of Object.values(dsc || {})) h += (now - e.t) / 36e5;
    return h;
  },
  fmtWh(wh) { return wh < 1 ? Math.round(wh * 1000) + ' mWh' : wh.toFixed(2) + ' Wh'; },
  message(c) {
    const pool = [];
    if (c.open >= 60) pool.push(`${c.open} sekme açık. Tarayıcın bugün maraton koşuyor 🏃`);
    if (c.sleeping > 0) pool.push(`${c.sleeping} sekme şu an uyuyor 😴 Dönünce kaldığın yerden yüklenir.`);
    if (c.usedPct >= 85) pool.push(`RAM %${c.usedPct} dolu. Çay molası, birkaç sekme kapatma zamanı ☕`);
    if (c.wh >= 0.1) pool.push(`Uyuttuğum sekmeler yaklaşık ${QL.fmtWh(c.wh)} tasarruf etti (tahmini, ≈ telefon şarjının %${(100 * c.wh / QL.PHONE_WH).toFixed(1)}) 🔋`);
    if ((c.prefetched || 0) + (c.blocked || 0) > 0) pool.push(`${c.prefetched || 0} sayfa önceden hazırlandı, ${c.blocked || 0} izleyici engellendi ⚡`);
    if (!pool.length) pool.push('Sekmelerin güvende, ben nöbetteyim 🛡️');
    return pool[Math.floor(Date.now() / 36e5) % pool.length];
  }
};
