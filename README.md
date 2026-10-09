# QuickLoad Hyper-Engine v3.4

## db.json şeması (schema: 3)
Çalışma zamanında `chrome.storage.local["db"]` içinde tutulur; `db.json` boş şablondur.
Debug paneli (popup > "Debug paneli") veriyi görüntüler, `db.json` olarak dışa/içe aktarır.

- totals: navs, prefetched, blocked, clicks, ttfb.{prefetch,normal}.{n,sum}
- protocols: h3 / h2 / http/1.1 / other sayaçları
- sites[host]: visits, prefetched, ttfbSum, lastVisit, protocols, clicks
- clicks[host][yol | →hedefHost]: sayaç (yol normalize: ilk 3 segment, sayısal/uzun segment :id)
- days[YYYY-MM-DD]: navs, prefetched, blocked, clicks (son 30 gün)
- index: topSites [[host, visits]], topClicks [[host, yol, n]] (ilk 20, her yazımda yeniden kurulur)

Sınırlar: 300 site, host başına 40 yol, 30 gün, debug günlüğü 200 kayıt.
Gizlilik: sorgu/parça saklanmaz, gizli sekme kaydedilmez, veri cihaz dışına çıkmaz.

## v3.3 eklentileri (schema 2)
- tabs: discards, restores, restoreTimed/restoreMs (uyanma süresi), discardedHours, peakOpen, last{open,hot,sleeping,skipped}
- memory: son 120 örnek {t, usedPct, availMB, open} (dakikada bir)
- Uyutma politikası: shared.js > QL.POLICY (temkinli/dengeli/agresif). Sayısal değerler başlangıç tahminidir.
- Uyutulmaz: aktif, sabitli, ses çalan, Chrome korumalı, gizli, dahili sayfa, izin listesi, yazı yazılmış (dirty), oynayan medya, probe cevapsız.
- Enerji = uyku saati x varsayılan W (ayarlanabilir). Ölçüm değil, tahmindir.

## v3.4 (schema 3)
- Ölçüm: site başına ön yüklenen TTFB toplamı (pTtfbSum), giriş türü (same/external/direct), ham nextHopProtocol, LCP ve yükleme olayı, %10 deney (holdout) grubu, dönüş aralığı histogramı, uyutma nedenleri.
- Yükleme algoritması: Kademe 1 Speculation Rules, Kademe 2 rel=prefetch (olası CSP engelinde), geçmişe dayalı ısınma (en fazla 2, tam eşleşen, 4g), ekran dışı iframe/görsel ertelemesi, düz kaynaklı preload=auto videolarda erteleme ve ekrana yaklaşınca metadata'ya yükseltme, medya sunucusu için preconnect (en fazla 3).
- Uyutma varsayılanı KAPALI (gerçek veriye göre).
- CSP tespiti sezgiseldir; videolarda blob/MSE kaynaklı oynatıcılara dokunulmaz.
