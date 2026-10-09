# QuickLoad Hyper-Engine

Chromium tabanlı tarayıcılar için, **ne kazandırdığını ölçüp gösteren** bir performans eklentisi: akıllı sayfa ön yükleme, içerik/video yükleme optimizasyonu, izleyici engelleme ve çok sekmeli kullanımda RAM yönetimi.

> **English summary:** A Chrome/Chromium MV3 extension that speeds up browsing with Speculation Rules prefetching (with a `rel=prefetch` fallback), lazy loading of off-screen iframes/images/videos, a small tracker blocklist, and idle-tab discarding. It records local-only measurements (TTFB, LCP, protocol, tab stats) in a debug panel and includes a built-in 10% holdout group so claimed gains are measured, not assumed.

![Durum: sürüm 3.4.0](https://img.shields.io/badge/s%C3%BCr%C3%BCm-3.4.0-blue)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![Chrome 121+](https://img.shields.io/badge/Chrome-121%2B-orange)

<!-- Ekran görüntüleri: popup.png, debug-yukleme.png, debug-sekmeler.png dosyalarını docs/ klasörüne ekleyip burada gösterin -->

## İçindekiler
- [Neden bu proje?](#neden-bu-proje)
- [Özellikler](#özellikler)
- [Kurulum](#kurulum)
- [Nasıl çalışıyor?](#nasıl-çalışıyor)
- [Ölçüm ve debug paneli](#ölçüm-ve-debug-paneli)
- [Gizlilik](#gizlilik)
- [İzinler ve gerekçeleri](#izinler-ve-gerekçeleri)
- [Bilinen sınırlar](#bilinen-sınırlar)
- [Proje yapısı](#proje-yapısı)
- [Sürüm geçmişi](#sürüm-geçmişi)
- [Yol haritası](#yol-haritası)
- [Katkı ve lisans](#katkı-ve-lisans)

## Neden bu proje?
Hız eklentilerinin çoğu "%X daha hızlı" der ve bunu doğrulamak zordur. QuickLoad iki ilkeye dayanır:

1. **Varsayma, ölç.** Her iyileştirmenin etkisi cihazda ölçülür. Sayfaların %10'unda iyileştirmeler bilerek kapatılır (deney grubu), böylece karşılaştırma seçim yanlılığından arındırılır.
2. **Veriye göre karar ver.** Varsayılanlar gerçek kullanım verisiyle değiştirilir. Örneğin sekme uykusu, uyutulan sekmelere kısa sürede geri dönüldüğü görüldüğü için varsayılan olarak kapalıdır.

## Özellikler

### Sayfa geçişleri
- **Speculation Rules ile akıllı ön yükleme:** Bağlantının üzerine gelince aynı site içindeki sayfa arka planda hazırlanır (`eagerness: moderate`). Çıkış, silme, sepet, ödeme, indirme, `nofollow` ve yeni sekmede açılan bağlantılar hariç tutulur.
- **`rel=prefetch` yedeği:** Sayfanın güvenlik politikası (CSP) speculation script'ini engellerse fare üzerine gelme (65 ms) veya dokunma ile devreye girer. Sayfa başına en fazla 12 adres.
- **Geçmişe dayalı ısınma:** Bu sitede en az 3 kez tıkladığınız, ekranda görünen ve yolu belirsiz olmayan en fazla 2 bağlantı önceden yüklenir. Yalnızca 4g ve Veri Tasarrufu kapalıyken.
- Veri Tasarrufu açıksa veya bağlantı 2g ise ön yükleme kapanır.

### İçerik ve video yükleme
- İlk 4 görselden ve ilk iframe'den sonrakilere `loading="lazy"` verilir. Captcha, ödeme ve giriş çerçeveleri hariç tutulur.
- `preload="auto"` olan, düz kaynaklı ve otomatik oynamayan videolar ekran dışındayken `none`'a çekilir. Ekrana 300 px yaklaşınca `metadata`'ya yükseltilir, oynatma veya üzerine gelme olunca özgün ayara döner.
- Medya sunucusuna en fazla 3 `preconnect` eklenir.
- `blob:` / MSE kaynaklı oynatıcılara (çoğu büyük video sitesi) **dokunulmaz**.

### Gizlilik ve engelleme
- Bilinen reklam ve analitik alan adlarına giden üçüncü taraf istekler `declarativeNetRequest` ile engellenir. Simgede sekme başına engel sayısı rozeti görünür.
- Başlangıç listesi kısadır (3 alan adı) ve `rules.json` içinde genişletilebilir.

### Sekme yönetimi (çok sekmeli kullanım)
- Boşta kalan sekmeleri süre, sıcak sekme üst sınırı ve RAM baskısına göre `chrome.tabs.discard` ile uyutur. Üç mod: temkinli, dengeli, agresif.
- Uyutmadan önce sayfaya sorulur. Yazılmış veri, oynayan medya veya cevapsız sayfa varsa dokunulmaz. Aktif, sabitli, sesli, Chrome korumalı ve izin listesindeki sekmeler (varsayılan: Meet, Zoom, Teams, Discord, WhatsApp Web) korunur.
- **Varsayılan: kapalı.**

| Mod | Boşta süresi | Sıcak sekme sınırı | RAM eşiği |
|---|---|---|---|
| Temkinli | 90 dk | 60 | %90 |
| Dengeli | 45 dk | 30 | %80 |
| Agresif | 15 dk | 15 | %75 |

Bu değerler **başlangıç tahminidir**; kendi kullanımınızdan toplanan verilerle ayarlanmalıdır. Bir turda en fazla 8 sekme uyutulur.

### Farkındalık
- Popup'ta açık/uyuyan sekme, RAM kullanımı, ön yüklenen sayfa, engellenen istek, yükleme özeti ve en çok erişilen siteler.
- İsteğe bağlı, eğlenceli durum mesajları ve saatlik bildirim (varsayılan kapalı).
- **Tahmini enerji tasarrufu:** uyku saati × varsayılan 0,03 W. Bu bir ölçüm değil, ayarlanabilir bir varsayımdır ve arayüzde "tahmini" olarak etiketlenir.

## Kurulum

**Gereksinim:** Chrome veya Chromium tabanlı tarayıcı, sürüm **121 veya üzeri**.

1. Bu depoyu indirin (`Code → Download ZIP`) veya [Releases](../../releases) sayfasından paketi alın ve klasöre çıkarın.
2. `chrome://extensions` adresini açın.
3. Sağ üstten **Geliştirici modu**'nu açın.
4. **Paketlenmemiş öğe yükle**'ye tıklayıp klasörü seçin.
5. Eklenti simgesine tıklayın, ayarları kontrol edin.

Güncelleme sonrası eski veriler otomatik olarak yeni şemaya taşınır.

## Nasıl çalışıyor?

```
background.js (service worker)
 ├─ Sekme bütçe yöneticisi   : politika, probe, discard, uyku muhasebesi
 ├─ Ölçüm kaydı              : gezinti, tıklama, perf, hints
 ├─ declarativeNetRequest    : engelleyici kural seti, sayaç
 └─ db yazımı (sıralı kuyruk)

hyper-core.js (içerik scripti, document_start)
 ├─ Kademe 1: Speculation Rules → Kademe 2: rel=prefetch
 ├─ Geçmişe dayalı ısınma
 ├─ İçerik/video yükleyici
 └─ Ölçüm: TTFB, LCP, yükleme olayı, giriş türü, ham protokol

popup.* / debug.*  → ayarlar ve görünüm
db.json (şema 3)   → şablon; canlı veri chrome.storage.local içinde
```

**Deney grubu:** Sayfaların %10'unda iyileştirmeler kapalı kalır. Ön yükleme için, bir sonraki sayfa o sayfadan geldiyse "deney" grubuna yazılır (sessionStorage işaretiyle). Böylece "ön yüklenen" ile "ön yükleme kapalıyken gelen" aynı koşullarda karşılaştırılır. Debug panelinden kapatılabilir.

## Ölçüm ve debug paneli
Popup'taki **Debug paneli** düğmesi ayrı bir sekmede açılır:

| Sekme | İçerik |
|---|---|
| Yükleme | Ön yükleme karşılaştırması, LCP açık/deney, aynı sitede ön yüklenen ve normal TTFB, yükleyici sayaçları, giriş türü, ham protokol, dönüş aralığı, uyutma nedenleri |
| Sekmeler | Her sekmenin durumu, boşta süresi, kuru çalıştırma, RAM grafiği |
| Siteler / Tıklamalar / Günlük | En çok erişilen siteler, tıklama hedefleri, günlük özet |
| Ayarlar | İzin listesi, watt varsayımı, hatırlatıcı aralığı, deney ve ısınma ayarları |
| Ham JSON / Debug günlüğü | Tüm veri, olay kaydı (isteğe bağlı) |

Veriyi `db.json` olarak dışa/içe aktarabilirsiniz. Dışa aktarma dosyalarını **paylaşmadan önce site listesini gözden geçirin**; gezinti alışkanlıklarınızı içerir.

## Gizlilik
- **Tüm veri cihazda kalır.** Hiçbir veri bir sunucuya gönderilmez.
- Yalnızca **hostname** ve normalize edilmiş yol (ilk 3 segment; sayısal ve uzun segmentler `:id` olur) saklanır. Sorgu dizesi ve `#` parçası saklanmaz.
- Gizli sekmeler kayıt dışı bırakılır.
- Ayarlar `chrome.storage.sync`'te (hesabınızla eşitlenebilir), istatistikler `chrome.storage.local`'de tutulur.
- Sınırlar: 300 site, host başına 40 yol, 30 gün, 120 bellek örneği, 200 debug kaydı.
- Tek tuşla sıfırlama ve dışa aktarma vardır.

Ayrıntılar için [PRIVACY.md](PRIVACY.md).

## İzinler ve gerekçeleri

| İzin | Neden gerekli |
|---|---|
| `storage` | Ayarlar ve yerel istatistikler |
| `alarms` | Periyodik sekme kontrolü, engel sayacı, hatırlatıcı |
| `declarativeNetRequest` | Reklam/izleyici engelleme |
| `declarativeNetRequestFeedback` | Engellenen istek sayısını göstermek |
| `tabs` | Sekme listesi, boşta süresi, uyutma ve izin listesi eşleştirme |
| `system.memory` | RAM kullanım oranına göre politika |
| `notifications` | İsteğe bağlı hatırlatıcılar (varsayılan kapalı) |
| İçerik scripti (`<all_urls>`) | Ön yükleme kuralı, yükleyici ve ölçüm |

## Bilinen sınırlar
Bu bölüm bilerek açık yazıldı.

- **Enerji değeri tahmindir**, ölçüm değildir. Eklenti güç tüketimini ölçemez.
- **RAM kazancı MB olarak ölçülemez.** Chrome sekme başına bellek bilgisi vermez; yalnızca genel RAM kullanım grafiği sunulur.
- **Uyanan sekme yeniden yüklenir**; "anında" geri gelmez. Scroll ve video konumu geri yükleme planlanıyor.
- **Chrome'un yerleşik Memory Saver özelliği** benzer bir iş yapar. QuickLoad'ın farkı özelleştirilebilir politika ve gösterilen ölçümdür.
- **CSP tespiti sezgiseldir:** kendi eklediğimiz script'ten hemen sonra gelen satır içi script ihlali engel sayılır; yanlış alarm olabilir.
- **Video etkisi sınırlıdır:** MSE/blob tabanlı oynatıcılara dokunulmaz. Tarayıcı kaynakları sayfa yüklenirken erken keşfettiği için bazı ertelemeler etkisiz kalabilir. Gerçek etki deney grubu verisiyle değerlendirilmelidir.
- **Ön yükleme kazancı siteye bağlıdır.** Hover'sız gezinmede (klavye, dokunmatik) fayda azalır. Dışarıdan gelen girişler (ör. arama sonucu) ön yüklenemez.
- Yazılmış veri tespiti sezgiseldir; iframe içindeki form ve videoları görmez. Kritik siteleri izin listesine ekleyin.
- Şu an yalnızca **Chromium** için. Firefox ve Safari taşıması planlanıyor (bazı API'ler farklı, ör. `system.memory` yok).

## Proje yapısı
```
manifest.json      MV3 bildirimi
background.js      service worker
hyper-core.js      içerik scripti
shared.js          ortak sabitler (politika, enerji, mesajlar)
popup.html / .js   açılır pencere
debug.html / .js   debug paneli
rules.json         engelleme kuralları
db.json            boş veri şablonu (şema 3)
icons/             16, 48, 128 px
```

### Veri şeması (özet)
`totals` (gezinti, ön yükleme, TTFB grupları, perf, yükleyici sayaçları), `protocols`, `sites`, `clicks`, `days`, `tabs` (uyutma, dönüş aralığı, nedenler), `memory` (RAM örnekleri), `index` (en çok erişilen siteler ve tıklamalar).

### Elle doğrulama
1. Eklentiyi yükleyin, birkaç site gezin.
2. Debug paneli → **Yükleme**: sayaçların arttığını kontrol edin.
3. Debug paneli → **Sekmeler → Kuru çalıştırma**: uyutma kararlarını, hiçbir sekmeye dokunmadan görün.
4. Bir sekme açıkken Service Worker konsolunda (`chrome://extensions` → Service Worker) hata olmadığını kontrol edin.

## Sürüm geçmişi

| Sürüm | Değişiklik |
|---|---|
| 3.4 | İçerik/video yükleyici, `rel=prefetch` yedeği, geçmişe dayalı ısınma, %10 deney grubu, LCP/yükleme ölçümü, giriş türü ve ham protokol, dönüş aralığı histogramı. Uyutma varsayılanı kapatıldı (gerçek veriye göre) |
| 3.3 | Sekme bütçe yöneticisi, RAM grafiği, tahmini enerji, hatırlatıcı mesajlar |
| 3.2 | `db.json` ölçüm veritabanı, en çok erişilen siteler ve tıklama indeksi, debug paneli |
| 3.1 | Service worker, document rules ile prefetch, gerçek durum göstergesi |
| 3.0 | İlk hâl |

## Yol haritası
- [ ] Arka plan sekmelerde video/medya yönetimi
- [ ] Arka plan sekmeler için ağ kısıtlaması (oturum DNR kuralları, izin listesiyle)
- [ ] Scroll ve video konumu geri yükleme
- [ ] Genişletilmiş engelleme listesi ve site bazlı kapatma
- [ ] Ağa uyarlanabilir ön yükleme, `preconnect`, HTTPS yükseltme
- [ ] Tarayıcıdan bağımsız çekirdek, Firefox paketi

## Katkı ve lisans
Hata bildirimi ve öneriler için Issues sayfasını kullanın. Yeni özellik önermeden önce, etkisini nasıl ölçeceğinizi de yazmanız beklenir.

Lisans: **(seçilecek, ör. MIT)** — bkz. [LICENSE](LICENSE).
